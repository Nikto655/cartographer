import type { FastifyInstance } from 'fastify';
import { safeId } from '../../core/storage.js';
import { writableWorkspaceOf } from '../auth/index.js';
import * as service from './service.js';

export async function framesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/boards/:id/frames/:frameId/promote', async (req) => {
    const { id, frameId } = req.params as { id: string; frameId: string };
    return service.promoteFrame(writableWorkspaceOf(req), safeId(id), safeId(frameId));
  });
}

export { createFrame, promoteFrame, setFrameMembership, updateFrame } from './service.js';
