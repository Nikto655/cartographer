import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BoardShares, CreateSharePayload, ShareCandidate } from '@cartograph/shared';
import { HttpError, badRequest, notFound } from '../../core/errors.js';
import { safeId, workspaceFor } from '../../core/storage.js';
import {
  enterReadOnly,
  getUser,
  listUsers,
  restrictToBoards,
  writableWorkspaceOf,
} from '../auth/index.js';
import * as service from './service.js';

/**
 * Someone who does not exist, is disabled, or is you is not a recipient. The
 * message is the same for all three: the picker is a list of names, not a probe.
 */
function requireRecipient(req: FastifyRequest, userId: unknown): string {
  if (typeof userId !== 'string' || !userId) throw badRequest('Pick someone to share with.');
  const user = getUser(userId);
  if (!user || user.isDisabled || user.id === req.user!.id) {
    throw badRequest('That is not someone you can share with.');
  }
  return user.id;
}

export async function sharesRoutes(app: FastifyInstance): Promise<void> {
  /*
   * The dialog's whole vocabulary in one read: who this board is shared with,
   * and who else is on the instance. The candidate list is deliberately here
   * rather than on a general user directory — display names are what "pick
   * existing users by name" needs (§5), and this is the only screen that needs them.
   */
  app.get('/boards/:id/shares', async (req): Promise<BoardShares> => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const candidates: ShareCandidate[] = listUsers()
      .filter((user) => user.id !== me && !user.isDisabled)
      .map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        // Still a candidate — hiding an admin from the *list* is a dialog
        // decision, not an access rule, and sharing with one stays allowed.
        isSuperAdmin: user.isSuperAdmin || undefined,
      }));
    return { shares: service.recipientsOf(me, safeId(id)), candidates };
  });

  app.post('/boards/:id/shares', async (req, reply) => {
    // A share is a write about a board of yours, so it is refused on any board
    // you are only looking at — same rule as every other write.
    writableWorkspaceOf(req);
    const { id } = req.params as { id: string };
    const { userId, canDuplicate, includeChildren, canExport } =
      (req.body ?? {}) as Partial<CreateSharePayload>;
    const recipient = requireRecipient(req, userId);
    // Sub-boards came with the board before this was a choice, so an omitted
    // flag keeps that behaviour rather than silently narrowing the share.
    service.putShare(
      req.user!.id,
      safeId(id),
      recipient,
      canDuplicate === true,
      includeChildren !== false,
      // Withheld unless asked for, the opposite of sub-boards above: an export
      // is the whole board's text leaving as files, so it is granted, never
      // inherited from an older call that did not know about it.
      canExport === true,
    );
    reply.code(201);
    return { shares: service.recipientsOf(req.user!.id, safeId(id)) };
  });

  /**
   * Revoke. The recipient's dashboard loses the board on their next read and
   * their open view 404s — no files move, because a share never was a file.
   */
  app.delete('/boards/:id/shares', async (req) => {
    writableWorkspaceOf(req);
    const { id } = req.params as { id: string };
    const { userId } = req.query as { userId?: string };
    if (!userId) throw badRequest('Which share? Pass ?userId=.');
    service.removeShare(req.user!.id, safeId(id), userId);
    return { shares: service.recipientsOf(req.user!.id, safeId(id)) };
  });

  app.get('/shared-with-me', async (req) => service.sharedWithMe(req.user!.id));

  /** The other direction: which of your own boards you have given away, and to whom. */
  app.get('/my-shares', async (req) => service.shareNamesByBoard(req.user!.id));

  /**
   * Duplicate to my workspace (§5). The flag is checked here, on the row, and
   * nowhere else matters: a recipient without it can craft this request all day.
   */
  app.post('/shared/:boardId/duplicate', async (req, reply) => {
    const target = writableWorkspaceOf(req);
    const { boardId } = req.params as { boardId: string };
    const share = service.shareOfRecipient(req.user!.id, safeId(boardId));
    if (!share) throw notFound(`Board not found: ${boardId}`);
    if (share.can_duplicate !== 1) {
      throw new HttpError(
        403,
        'duplicate_not_allowed',
        'This board was shared to read, not to copy.',
      );
    }
    const board = await service.duplicateSharedTree(
      share.owner_id,
      share.board_id,
      target,
      share.include_children === 1,
    );
    reply.code(201);
    return board;
  });
}

/**
 * §5's access-resolution order, in one place, for every request under
 * `/api/u/:ownerId` — the prefix the client uses for any workspace that is not
 * the one the session owns:
 *
 *   own board  → full            (your own id: nothing is narrowed)
 *   admin view → read, whole workspace, audited
 *   share row  → read, tree only (+ duplicate if the row says so)
 *   otherwise  → 404, never 403  — a stranger learns nothing about who exists
 *                                  or what they have.
 *
 * The ladder runs widest-first, which puts Admin View above shares rather than
 * below as §5 lists them. It only ever matters for a Super Admin who has *also*
 * been shared one board in a workspace they can already read whole: taking the
 * share rung there would narrow Admin View to that one tree — the ladder would
 * take access away — and the open would go unaudited. Nobody gains anything
 * either way; an admin can read the workspace regardless. Duplicate permission
 * is unaffected: it is read off the share row, never off the rung.
 */
/**
 * Stamps the share row when a recipient opens a shared board, so the owner's
 * dialog can say when each person last looked.
 *
 * Only the board read itself — the one request that *is* an act of opening.
 * The canvas makes many requests per visit (nodes, events, exports), and any
 * of them would do as a signal, but one write per open is a record where one
 * write per request is churn. Admin View is deliberately not recorded here:
 * that is the audit log's job, and an admin passing through is not the person
 * the owner shared with.
 */
export async function recordShareAccess(req: FastifyRequest): Promise<void> {
  if (req.grant !== 'share') return;
  if (req.method !== 'GET') return;
  if (!(req.routeOptions?.url ?? '').endsWith('/boards/:id')) return;
  const { ownerId, id } = (req.params ?? {}) as { ownerId?: string; id?: string };
  if (!ownerId || typeof id !== 'string') return;
  service.touchShareAccess(req.user!.id, ownerId, safeId(id));
}

export async function workspaceAccess(req: FastifyRequest): Promise<void> {
  const { ownerId } = req.params as { ownerId?: string };
  const missing = () => notFound('No such workspace.');
  if (typeof ownerId !== 'string' || !ownerId) throw missing();
  if (ownerId === req.user!.id) return; // requireAuth already put us in our own root

  const owner = getUser(ownerId);
  if (!owner) throw missing();

  if (req.user!.isSuperAdmin) {
    enterReadOnly(req, ownerId, 'admin');
    return;
  }

  const visible = await service.visibleBoardIds(workspaceFor(ownerId), req.user!.id);
  if (!visible) throw missing();
  enterReadOnly(req, ownerId, 'share');
  restrictToBoards(req, visible);
}
