import { createHash, randomBytes } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import type { AdminUser, SessionUser } from '@cartograph/shared';
import { execute, newId, queryAll, queryOne } from '../../core/db.js';
import { nowIso } from '../../core/storage.js';
import { HttpError, badRequest, conflict, notFound } from '../../core/errors.js';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  is_super_admin: number;
  is_disabled: number;
  must_change_password: number;
  created_at: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

export const SESSION_COOKIE = 'cg_session';
const SESSION_DAYS = 30;
export const SESSION_MAX_AGE_S = SESSION_DAYS * 24 * 60 * 60;
/**
 * A session refreshes on use (§2, sliding), but writing a row on every request
 * would be a write per keystroke-autosave. A minute of drift on a 30-day window
 * is invisible.
 */
const TOUCH_AFTER_MS = 60_000;

const MIN_PASSWORD_LENGTH = 8;

const invalidCredentials = () =>
  new HttpError(401, 'invalid_credentials', 'Wrong username or password.');

const toSessionUser = (row: UserRow): SessionUser => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  isSuperAdmin: row.is_super_admin === 1,
  mustChangePassword: row.must_change_password === 1,
});

/** Usernames are matched case-insensitively; the stored form is the lowercase one. */
export function normalizeUsername(input: string): string {
  return (input ?? '').trim().toLowerCase();
}

function assertPasswordPolicy(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

/** argon2id at the library defaults (m=19MiB, t=2, p=1) — OWASP's current floor. */
const hashPassword = (password: string) => argonHash(password);

async function passwordMatches(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    // A malformed hash is a mismatch, not a 500.
    return false;
  }
}

/**
 * Verified against when no such user exists, so a miss costs the same as a
 * wrong password and the response time stops enumerating usernames.
 */
let decoyHash: string | null = null;
async function burnVerifyTime(): Promise<void> {
  decoyHash ??= await hashPassword(randomBytes(16).toString('hex'));
  await passwordMatches(decoyHash, 'not-the-password');
}

// ---- users ----

const findByUsername = (username: string) =>
  queryOne<UserRow>('SELECT * FROM users WHERE username = @username', { username });

const findById = (id: string) => queryOne<UserRow>('SELECT * FROM users WHERE id = @id', { id });

export function userCount(): number {
  return queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
}

/**
 * Who owns everything that predates accounts (v1.6 §8.1): the first Super Admin
 * created. Ordered rather than "any admin", so re-running the migration on a
 * volume with several admins can never pick a different owner.
 */
export function bootstrapAdminId(): string | null {
  const row = queryOne<{ id: string }>(
    'SELECT id FROM users WHERE is_super_admin = 1 ORDER BY created_at, id LIMIT 1',
  );
  return row?.id ?? null;
}

async function insertUser(input: {
  username: string;
  displayName: string;
  password: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
}): Promise<SessionUser> {
  const row: UserRow = {
    id: newId(),
    username: normalizeUsername(input.username),
    display_name: input.displayName,
    password_hash: await hashPassword(input.password),
    is_super_admin: input.isSuperAdmin ? 1 : 0,
    is_disabled: 0,
    must_change_password: input.mustChangePassword ? 1 : 0,
    created_at: nowIso(),
  };
  execute(
    `INSERT INTO users (id, username, display_name, password_hash, is_super_admin, is_disabled,
                        must_change_password, created_at)
     VALUES (@id, @username, @display_name, @password_hash, @is_super_admin, @is_disabled,
             @must_change_password, @created_at)`,
    { ...row },
  );
  return toSessionUser(row);
}

/**
 * First boot only (§2). Refuses to start an app nobody can log into rather than
 * inventing a password or leaving the door open.
 */
export async function bootstrapAdmin(log: (message: string) => void): Promise<void> {
  if (userCount() > 0) return;

  const username = normalizeUsername(process.env.ADMIN_USERNAME ?? '');
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!username || !password) {
    throw new Error(
      'No users exist yet and ADMIN_USERNAME / ADMIN_PASSWORD are not set. ' +
        'Set both (copy .env.example to .env) and start again — without them nobody could sign in.',
    );
  }

  await insertUser({
    username,
    displayName: process.env.ADMIN_DISPLAY_NAME?.trim() || username,
    password,
    isSuperAdmin: true,
    mustChangePassword: true,
  });
  log(`Bootstrap Super Admin created: ${username} — must change password at first sign-in.`);
}

// ---- sessions ----

/**
 * The cookie carries the token; the row is keyed by its SHA-256. A copy of
 * app.db therefore hands over no live session, and the token itself is never
 * written anywhere.
 */
const sessionKey = (token: string) => createHash('sha256').update(token).digest('hex');

function createSession(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  execute(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
     VALUES (@id, @user_id, @created_at, @expires_at, @last_seen_at)`,
    {
      id: sessionKey(token),
      user_id: userId,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + SESSION_MAX_AGE_S * 1000).toISOString(),
      last_seen_at: now.toISOString(),
    },
  );
  return token;
}

export async function login(
  username: string,
  password: string,
): Promise<{ user: SessionUser; token: string }> {
  const row = findByUsername(normalizeUsername(username));
  if (!row) {
    await burnVerifyTime();
    throw invalidCredentials();
  }
  if (!(await passwordMatches(row.password_hash, password))) throw invalidCredentials();
  if (row.is_disabled === 1) {
    throw new HttpError(403, 'account_disabled', 'This account is disabled.');
  }
  return { user: toSessionUser(row), token: createSession(row.id) };
}

/**
 * Resolves a cookie to a user, sliding the expiry forward as it goes. Returns
 * null for anything not currently valid — expired, revoked, or disabled since.
 */
export function authenticate(token: string): SessionUser | null {
  const session = queryOne<SessionRow>('SELECT * FROM sessions WHERE id = @id', {
    id: sessionKey(token),
  });
  if (!session) return null;

  const now = new Date();
  if (new Date(session.expires_at).getTime() <= now.getTime()) {
    execute('DELETE FROM sessions WHERE id = @id', { id: session.id });
    return null;
  }

  const user = findById(session.user_id);
  if (!user || user.is_disabled === 1) return null;

  if (now.getTime() - new Date(session.last_seen_at).getTime() > TOUCH_AFTER_MS) {
    execute(
      'UPDATE sessions SET last_seen_at = @now, expires_at = @expires WHERE id = @id',
      {
        id: session.id,
        now: now.toISOString(),
        expires: new Date(now.getTime() + SESSION_MAX_AGE_S * 1000).toISOString(),
      },
    );
  }
  return toSessionUser(user);
}

export function logout(token: string | null): void {
  if (!token) return;
  execute('DELETE FROM sessions WHERE id = @id', { id: sessionKey(token) });
}

// ---- password change (§2) ----

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepToken: string | null,
): Promise<SessionUser> {
  const row = findById(userId);
  if (!row) throw invalidCredentials();
  if (!(await passwordMatches(row.password_hash, currentPassword))) {
    throw new HttpError(401, 'invalid_credentials', 'Current password is wrong.');
  }
  assertPasswordPolicy(newPassword);
  if (newPassword === currentPassword) {
    throw badRequest('The new password must be different from the current one.');
  }

  execute(
    `UPDATE users SET password_hash = @hash, must_change_password = 0 WHERE id = @id`,
    { id: userId, hash: await hashPassword(newPassword) },
  );
  // A changed password ends every other session — the point of changing it.
  execute('DELETE FROM sessions WHERE user_id = @user_id AND id <> @keep', {
    user_id: userId,
    keep: keepToken ? sessionKey(keepToken) : '',
  });

  const updated = findById(userId);
  return toSessionUser(updated ?? row);
}

// ---- user administration (v1.6 §3) ----

/**
 * A username has to be typeable, unambiguous and never mistakable for a path —
 * it is what one person types to reach another's account, and what an admin
 * reads in the audit log.
 */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/;

interface AdminUserRow extends UserRow {
  last_seen_at: string | null;
}

const toAdminUser = (row: AdminUserRow): AdminUser => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  isSuperAdmin: row.is_super_admin === 1,
  isDisabled: row.is_disabled === 1,
  mustChangePassword: row.must_change_password === 1,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
});

/**
 * Last seen is the newest session touch, not a column on the user: sessions
 * already record it, and a second place to keep the same fact is a second place
 * to get it wrong.
 */
export function listUsers(): AdminUser[] {
  return queryAll<AdminUserRow>(
    `SELECT u.*, (SELECT MAX(last_seen_at) FROM sessions WHERE user_id = u.id) AS last_seen_at
       FROM users u
      ORDER BY u.created_at, u.username`,
  ).map(toAdminUser);
}

export function getUser(userId: string): AdminUser | null {
  const row = queryOne<AdminUserRow>(
    `SELECT u.*, (SELECT MAX(last_seen_at) FROM sessions WHERE user_id = u.id) AS last_seen_at
       FROM users u WHERE u.id = @id`,
    { id: userId },
  );
  return row ? toAdminUser(row) : null;
}

/** Throws rather than returning null: every admin route needs a user to act on. */
function requireUser(userId: string): AdminUserRow {
  const row = queryOne<AdminUserRow>(
    `SELECT u.*, (SELECT MAX(last_seen_at) FROM sessions WHERE user_id = u.id) AS last_seen_at
       FROM users u WHERE u.id = @id`,
    { id: userId },
  );
  if (!row) throw notFound('No such user.');
  return row;
}

const enabledSuperAdmins = (): number =>
  queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM users WHERE is_super_admin = 1 AND is_disabled = 0',
  )?.n ?? 0;

/** Ends every session a user holds — what disabling and a reset both need. */
export function killSessions(userId: string): number {
  return execute('DELETE FROM sessions WHERE user_id = @user_id', { user_id: userId });
}

export async function createUser(input: {
  username: string;
  displayName: string;
  tempPassword: string;
}): Promise<AdminUser> {
  const username = normalizeUsername(input.username);
  if (!USERNAME_RE.test(username)) {
    throw badRequest(
      'A username is 2–40 characters: letters, digits, dot, dash or underscore, starting with a letter or digit.',
    );
  }
  if (findByUsername(username)) throw conflict(`The username “${username}” is taken.`);
  const displayName = (input.displayName ?? '').trim() || username;

  const created = await insertUser({
    username,
    displayName,
    password: input.tempPassword,
    isSuperAdmin: false,
    // The account exists to be handed over; the holder picks the real password (§2).
    mustChangePassword: true,
  });
  return toAdminUser(requireUser(created.id));
}

/**
 * Admin reset (§3): a new temp password, the forced-change flag back on, and
 * every session the user had ended — a password they no longer know must not
 * leave a browser signed in.
 */
export async function resetPassword(userId: string, tempPassword: string): Promise<AdminUser> {
  const row = requireUser(userId);
  execute(
    'UPDATE users SET password_hash = @hash, must_change_password = 1 WHERE id = @id',
    { id: row.id, hash: await hashPassword(tempPassword) },
  );
  killSessions(row.id);
  return toAdminUser(requireUser(row.id));
}

/**
 * Disable / enable (§3). Files are never touched — a disabled account is a door
 * that stops opening, not data that goes away.
 */
/**
 * Rename an account (§3). Nothing on the volume moves: workspaces are keyed by
 * user id, so a username is only ever a login handle and a label. Existing
 * sessions survive for the same reason — they point at the id, not the name.
 *
 * Both fields are optional; an omitted one is left alone, so the two edits are
 * independent even though they share a route.
 */
export function renameUser(
  userId: string,
  changes: { username?: string; displayName?: string },
): AdminUser {
  const row = requireUser(userId);

  if (changes.username !== undefined) {
    const username = normalizeUsername(changes.username);
    if (!USERNAME_RE.test(username)) {
      throw badRequest(
        'A username is 2–40 characters: letters, digits, dot, dash or underscore, starting with a letter or digit.',
      );
    }
    const clash = findByUsername(username);
    if (clash && clash.id !== row.id) throw conflict(`The username “${username}” is taken.`);
    execute('UPDATE users SET username = @username WHERE id = @id', { id: row.id, username });
  }

  if (changes.displayName !== undefined) {
    // A blank display name falls back to the handle rather than rendering as an
    // empty row in every list that shows it.
    const displayName = changes.displayName.trim() || requireUser(row.id).username;
    execute('UPDATE users SET display_name = @displayName WHERE id = @id', {
      id: row.id,
      displayName,
    });
  }

  return toAdminUser(requireUser(row.id));
}

export function setDisabled(userId: string, disabled: boolean): AdminUser {
  const row = requireUser(userId);
  if (disabled && row.is_super_admin === 1 && row.is_disabled === 0 && enabledSuperAdmins() <= 1) {
    throw conflict('This is the last active Super Admin — disabling them would lock everyone out.');
  }
  execute('UPDATE users SET is_disabled = @flag WHERE id = @id', {
    id: row.id,
    flag: disabled ? 1 : 0,
  });
  // Being disabled takes effect now, not when the cookie happens to expire.
  if (disabled) killSessions(row.id);
  return toAdminUser(requireUser(row.id));
}

/**
 * Grant / revoke Super Admin (§3). The guard is on the *last* one rather than on
 * "yourself": an instance with nobody who can add users is an instance nobody
 * can fix from inside.
 */
export function setSuperAdmin(userId: string, value: boolean): AdminUser {
  const row = requireUser(userId);
  if (!value && row.is_super_admin === 1 && row.is_disabled === 0 && enabledSuperAdmins() <= 1) {
    throw conflict('This is the last Super Admin — someone has to be able to administer the instance.');
  }
  execute('UPDATE users SET is_super_admin = @flag WHERE id = @id', {
    id: row.id,
    flag: value ? 1 : 0,
  });
  return toAdminUser(requireUser(row.id));
}
