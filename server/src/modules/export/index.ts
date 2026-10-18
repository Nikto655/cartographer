import type { FastifyInstance } from 'fastify';
import type { ExportPayload } from '@cartograph/shared';
import { HttpError } from '../../core/errors.js';
import { safeId } from '../../core/storage.js';
import { isBoardVisible, workspaceOf } from '../auth/index.js';
import { exportableBoardIds } from '../shares/service.js';
import * as service from './service.js';

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/boards/:id/export', async (req) => {
    const { id } = req.params as { id: string };
    const boardId = safeId(id);
    const ws = workspaceOf(req);

    /*
     * A share is permission to read a board, not to walk off with it (§5).
     * Checked on the share row and nowhere else matters: hiding the button is
     * for the person who is not trying, and this is for the one who is.
     *
     * Only the share rung is narrowed. Your own workspace is yours, and Admin
     * View already reads every word of every node — an owner cannot withhold
     * anything from it, and pretending otherwise would be theatre.
     */
    if (req.grant === 'share') {
      const allowed = await exportableBoardIds(ws.userId, req.user!.id);
      if (!allowed.has(boardId)) {
        throw new HttpError(
          403,
          'export_not_allowed',
          'This board was shared to read, not to download.',
        );
      }
    }

    return service.exportPath(
      ws,
      boardId,
      (req.body ?? { nodeIds: [] }) as ExportPayload,
      (childId) => isBoardVisible(req, childId),
    );
  });
}

export { exportPath } from './service.js';
