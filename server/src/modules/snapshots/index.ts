import type { FastifyInstance } from 'fastify';
import { safeId } from '../../core/storage.js';
import { workspaceOf, writableWorkspaceOf } from '../auth/index.js';
import * as service from './service.js';

export async function snapshotsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/boards/:id/snapshots', async (req, reply) => {
    const { id } = req.params as { id: string };
    const snapshot = await service.createSnapshot(writableWorkspaceOf(req), safeId(id));
    reply.code(201);
    return snapshot;
  });

  app.get('/boards/:id/snapshots', async (req) => {
    const { id } = req.params as { id: string };
    return service.listSnapshots(workspaceOf(req), safeId(id));
  });

  app.post('/boards/:id/snapshots/:ts/restore', async (req) => {
    const { id, ts } = req.params as { id: string; ts: string };
    return service.restoreSnapshot(writableWorkspaceOf(req), safeId(id), ts);
  });
}

export { createSnapshot, listSnapshots, restoreSnapshot } from './service.js';
