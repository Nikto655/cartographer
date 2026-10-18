import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PastePayload } from '@cartograph/shared';
import { HttpError, notFound } from '../../core/errors.js';
import { exists, safeId, workspaceFor } from '../../core/storage.js';
import { writableWorkspaceOf } from '../auth/index.js';
import { copyableBoardIds } from '../shares/index.js';
import * as service from './service.js';

/**
 * Where the copy is read from (§6.2). Two cases and no third: a board of your
 * own, or a board somebody shared with you *and* ticked "may duplicate" — the
 * same permission the whole-board copy asks for, read off the same rows. Admin
 * View is not on this list: browsing somebody's workspace is not a licence to
 * take their work, and a Super Admin who wants a copy can ask for a share.
 *
 * Not the export flag. Export is about the node files leaving as markdown;
 * pasting into a board of your own is a copy, and a copy is what "may
 * duplicate" already answers for.
 */
async function sourceSide(
  req: FastifyRequest,
  payload: PastePayload,
): Promise<service.CopySide> {
  const boardId = safeId(payload?.sourceBoardId ?? '');
  const me = req.user!.id;
  const ownerId = payload.sourceOwnerId ? safeId(payload.sourceOwnerId) : me;

  const ws = workspaceFor(ownerId);
  if (ownerId !== me) {
    const copyable = await copyableBoardIds(ownerId, me);
    if (!copyable.has(boardId)) {
      // Distinguishing "not shared" from "shared but not copyable" would leak
      // the first; both are the one refusal the recipient can act on.
      throw new HttpError(
        403,
        'duplicate_not_allowed',
        'That board was shared to read, not to copy.',
      );
    }
  }
  if (!(await exists(ws.boardFile(boardId)))) throw notFound(`Board not found: ${boardId}`);
  return { ws, boardId };
}

export async function clipboardRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Duplicate in place (§6.1). Source and target are the same board, so the only
   * workspace involved is one you can write — nothing else needs checking.
   */
  app.post('/boards/:id/duplicate-selection', async (req, reply) => {
    const ws = writableWorkspaceOf(req);
    const { id } = req.params as { id: string };
    const side = { ws, boardId: safeId(id) };
    const result = await service.copySelection(side, side, service.readSelection(req.body), {
      kind: 'offset',
      dx: service.DUPLICATE_OFFSET,
      dy: service.DUPLICATE_OFFSET,
    });
    reply.code(201);
    return result;
  });

  /**
   * Paste (§6.2). The target is always a board of your own — `writableWorkspaceOf`
   * is what makes that true, and the read-only scope's default-deny hook refuses
   * this route before it is even reached.
   */
  app.post('/boards/:id/paste', async (req, reply) => {
    const target = writableWorkspaceOf(req);
    const { id } = req.params as { id: string };
    const payload = (req.body ?? {}) as PastePayload;
    const position = payload.position ?? { x: 0, y: 0 };
    const result = await service.copySelection(
      await sourceSide(req, payload),
      { ws: target, boardId: safeId(id) },
      service.readSelection(payload),
      { kind: 'centre', x: Number(position.x) || 0, y: Number(position.y) || 0 },
    );
    reply.code(201);
    return result;
  });
}
