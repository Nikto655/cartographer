import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CreateUserPayload } from '@cartograph/shared';
import { badRequest } from '../../core/errors.js';
import * as auth from '../auth/index.js';
import * as boards from '../boards/index.js';
import { workspaceFor } from '../../core/storage.js';
import { generateTempPassword, recordAudit } from './service.js';

interface UserParams {
  userId: string;
}

const actor = (req: FastifyRequest): string => req.user!.id;

/**
 * Admin View, server side (v1.6 §3). Everything here is behind
 * `requireSuperAdmin`, and every route that changes anything writes exactly one
 * audit row — the log is the record that these powers were used.
 *
 * Temp passwords are returned by the two routes that mint them and nowhere else:
 * they are shown once, never logged, and never readable again (§3).
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/users', async () => auth.listUsers());

  /*
   * Boards their owner deleted from the Archive (v1.9). Nothing in the owner's
   * own API surface reads `deleted/` — this is the only window onto it, and it
   * is behind `requireSuperAdmin` like everything else in this file.
   */
  app.get('/admin/users/:userId/deleted', async (req) => {
    const { userId } = req.params as UserParams;
    // Checked first: `workspaceFor` would happily mint a workspace object for a
    // typo, and listing it would answer 200 with an empty array as though the
    // account existed.
    if (!auth.getUser(userId)) throw badRequest('No such user.');
    return boards.listDeletedBoards(workspaceFor(userId));
  });

  /*
   * The one route in the system that destroys data.
   *
   * Everything else in Cartographer moves files — that is invariant 6, and this
   * is its single sanctioned exception. It exists because "we never delete
   * anything" is not a promise a person can keep on someone else's behalf: a
   * board deleted in error has to be recoverable, and a board deleted on
   * purpose has to actually go. Audited like every other admin power, and the
   * row is the only trace that will remain.
   */
  app.delete('/admin/users/:userId/deleted/:entry', async (req) => {
    const { userId, entry } = req.params as UserParams & { entry: string };
    if (!auth.getUser(userId)) throw badRequest('No such user.');
    const result = await boards.purgeDeletedBoard(workspaceFor(userId), entry);
    recordAudit(actor(req), 'board.purge', `${userId}/${result.purged}`);
    return result;
  });

  app.post('/admin/users', async (req, reply) => {
    const { username, displayName } = (req.body ?? {}) as Partial<CreateUserPayload>;
    if (typeof username !== 'string' || typeof displayName !== 'string') {
      throw badRequest('A username and a display name are required.');
    }
    const tempPassword = generateTempPassword();
    const user = await auth.createUser({ username, displayName, tempPassword });
    // Their first screen should explain the app rather than be an empty shelf.
    // Best-effort inside the service: an account is worth having even without.
    await boards.seedStarterWorkspace(workspaceFor(user.id));
    recordAudit(actor(req), 'user.create', `${user.id} (${user.username})`);
    reply.code(201);
    return { user, tempPassword };
  });

  app.post('/admin/users/:userId/reset-password', async (req) => {
    const { userId } = req.params as UserParams;
    const tempPassword = generateTempPassword();
    const user = await auth.resetPassword(userId, tempPassword);
    recordAudit(actor(req), 'user.reset_password', `${user.id} (${user.username})`);
    return { user, tempPassword };
  });

  app.patch('/admin/users/:userId', async (req) => {
    const { userId } = req.params as UserParams;
    const { username, displayName } = (req.body ?? {}) as {
      username?: unknown;
      displayName?: unknown;
    };
    if (username !== undefined && typeof username !== 'string') {
      throw badRequest('`username` must be text.');
    }
    if (displayName !== undefined && typeof displayName !== 'string') {
      throw badRequest('`displayName` must be text.');
    }
    if (username === undefined && displayName === undefined) {
      throw badRequest('Nothing to change — pass a username, a display name, or both.');
    }
    const before = auth.getUser(userId);
    const user = auth.renameUser(userId, { username, displayName });
    // The old handle is the useful half of this record: the new one is on the row.
    recordAudit(actor(req), 'user.rename', `${user.id} (${before?.username} → ${user.username})`);
    return { user };
  });

  app.post('/admin/users/:userId/disable', async (req) => {
    const { userId } = req.params as UserParams;
    const user = auth.setDisabled(userId, true);
    recordAudit(actor(req), 'user.disable', `${user.id} (${user.username})`);
    return { user };
  });

  app.post('/admin/users/:userId/enable', async (req) => {
    const { userId } = req.params as UserParams;
    const user = auth.setDisabled(userId, false);
    recordAudit(actor(req), 'user.enable', `${user.id} (${user.username})`);
    return { user };
  });

  app.post('/admin/users/:userId/super-admin', async (req) => {
    const { userId } = req.params as UserParams;
    const { value } = (req.body ?? {}) as { value?: unknown };
    if (typeof value !== 'boolean') throw badRequest('`value` must be true or false.');
    const user = auth.setSuperAdmin(userId, value);
    recordAudit(
      actor(req),
      value ? 'user.grant_super_admin' : 'user.revoke_super_admin',
      `${user.id} (${user.username})`,
    );
    return { user };
  });
}

/**
 * One audit row per board an admin opens (§3). A `preHandler`, so it runs after
 * the board has been resolved: opening something that isn't there is not an
 * event worth recording.
 *
 * Browsing itself is no longer this module's to arrange — since v1.6 §5 every
 * way into somebody else's workspace goes through one resolver, and this reads
 * the rung it chose. A board opened because its owner shared it is not an
 * administrative act and writes nothing.
 */
export async function auditBoardOpen(req: FastifyRequest): Promise<void> {
  if (req.grant !== 'admin') return;

  /*
   * Anything reached on an admin grant is recorded, not just opening a board.
   * Reading one note, dumping a whole board to markdown and listing the shelf
   * are all the same power being used, and auditing only the board route left
   * `POST …/export` — which reads every word of every node — invisible.
   *
   * Deduplicated per board per session: a canvas makes many requests for one
   * act of looking, and a log nobody can read is not a record.
   */
  const { ownerId, id } = (req.params ?? {}) as { ownerId?: string; id?: string };
  if (!ownerId) return;
  const target = id ? `${ownerId}/${id}` : `${ownerId}/(board list)`;
  const key = `${req.sessionToken ?? actor(req)}|${target}`;
  if (seenThisSession.has(key)) return;
  seenThisSession.add(key);
  recordAudit(actor(req), 'board.open', target);
}

/**
 * One row per admin per board per session. In memory: the log records that the
 * power was used, and a restart starting a fresh page is the right trade for
 * not writing a row per canvas request.
 */
const seenThisSession = new Set<string>();
