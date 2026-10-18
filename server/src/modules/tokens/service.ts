import { createHash, randomBytes } from 'node:crypto';
import type { ApiToken, CreatedToken, TokenScope } from '@cartograph/shared';
import { execute, newId, queryAll, queryOne } from '../../core/db.js';
import { nowIso } from '../../core/storage.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';

interface TokenRow {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  scope: TokenScope;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** `cart_` so a leaked secret is recognisable on sight — in a log, a paste, a scanner. */
const SECRET_PREFIX = 'cart_';

const MAX_NAME_LENGTH = 60;

/**
 * A ceiling, not a quota. Nobody needs two dozen connectors; a list that grows
 * without bound is a list nobody revokes from, which is how a forgotten token
 * outlives the machine it was made for.
 */
const MAX_TOKENS_PER_USER = 25;

const SCOPES: readonly TokenScope[] = ['read', 'write'];

/**
 * The client keeps the secret; the row keeps its SHA-256, exactly as sessions do.
 * A copy of app.db therefore hands over no live token, and the secret itself is
 * never written anywhere.
 */
const tokenKey = (secret: string) => createHash('sha256').update(secret).digest('hex');

const toApiToken = (row: TokenRow): ApiToken => ({
  id: row.id,
  name: row.name,
  scope: row.scope,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

export function createToken(userId: string, name: string, scope: TokenScope): CreatedToken {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw badRequest('Give the token a name — it is how you tell them apart later.');
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw badRequest(`A token name is at most ${MAX_NAME_LENGTH} characters.`);
  }
  if (!SCOPES.includes(scope)) throw badRequest('Scope must be “read” or “write”.');

  const active =
    queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM tokens WHERE user_id = @user_id AND revoked_at IS NULL',
      { user_id: userId },
    )?.n ?? 0;
  if (active >= MAX_TOKENS_PER_USER) {
    throw conflict(
      `You already have ${MAX_TOKENS_PER_USER} active tokens — revoke one you no longer use.`,
    );
  }

  const secret = SECRET_PREFIX + randomBytes(32).toString('base64url');
  const row: TokenRow = {
    id: newId(),
    user_id: userId,
    name: trimmed,
    token_hash: tokenKey(secret),
    scope,
    created_at: nowIso(),
    last_used_at: null,
    revoked_at: null,
  };
  execute(
    `INSERT INTO tokens (id, user_id, name, token_hash, scope, created_at, last_used_at, revoked_at)
     VALUES (@id, @user_id, @name, @token_hash, @scope, @created_at, @last_used_at, @revoked_at)`,
    { ...row },
  );
  return { token: toApiToken(row), secret };
}

/** Revoked tokens stay in the table but not in the list — the list is a control panel. */
export function listTokens(userId: string): ApiToken[] {
  return queryAll<TokenRow>(
    `SELECT * FROM tokens
      WHERE user_id = @user_id AND revoked_at IS NULL
      ORDER BY created_at DESC, id`,
    { user_id: userId },
  ).map(toApiToken);
}

/**
 * Scoped by `user_id` in the WHERE clause rather than by a check afterwards, so
 * revoking somebody else's token is not a thing this function can be asked to
 * do. A token that isn't yours reads as one that isn't there — 404, never 403.
 */
export function revokeToken(userId: string, tokenId: string): void {
  const changed = execute(
    `UPDATE tokens SET revoked_at = @now
      WHERE id = @id AND user_id = @user_id AND revoked_at IS NULL`,
    { id: tokenId, user_id: userId, now: nowIso() },
  );
  if (changed === 0) throw notFound('No such token.');
}

/**
 * Resolves a bearer secret to its owner (§2.3). Returns null for everything that
 * is not currently usable — malformed, unknown, revoked, or owned by an account
 * that has since been disabled. One null rather than a reason: the caller is an
 * agent holding a string, and telling it *which* of those it is only helps a
 * probe. The user join is what makes disabling an account cut off its agents too.
 */
export function resolveToken(
  secret: string,
): { userId: string; tokenId: string; tokenName: string; scope: TokenScope } | null {
  if (typeof secret !== 'string' || !secret.startsWith(SECRET_PREFIX)) return null;
  const row = queryOne<TokenRow>(
    `SELECT t.* FROM tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = @hash AND t.revoked_at IS NULL AND u.is_disabled = 0`,
    { hash: tokenKey(secret) },
  );
  if (!row) return null;
  return { userId: row.user_id, tokenId: row.id, tokenName: row.name, scope: row.scope };
}

/**
 * `last_used_at` is read by a human deciding whether a token is still in use, so
 * a minute of drift costs nothing — and an agent in a loop would otherwise write
 * a row per tool call. Same trade, and the same window, as a session touch.
 */
const TOUCH_AFTER_MS = 60_000;
const lastTouched = new Map<string, number>();

export function touchToken(tokenId: string): void {
  const now = Date.now();
  const previous = lastTouched.get(tokenId);
  if (previous !== undefined && now - previous < TOUCH_AFTER_MS) return;
  lastTouched.set(tokenId, now);
  execute('UPDATE tokens SET last_used_at = @now WHERE id = @id', {
    id: tokenId,
    now: new Date(now).toISOString(),
  });
}
