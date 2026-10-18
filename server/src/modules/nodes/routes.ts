import type { FastifyInstance } from 'fastify';
import type { BoardNode, CreateNodePayload, NodeData, PatchNodePayload } from '@cartograph/shared';
import { safeId } from '../../core/storage.js';
import { workspaceOf, writableWorkspaceOf } from '../auth/index.js';
import * as service from './service.js';

interface Params {
  id: string;
  nodeId: string;
}

export async function nodesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/boards/:id/nodes', async (req, reply) => {
    const { id } = req.params as Params;
    const node = await service.createNode(writableWorkspaceOf(req), safeId(id), req.body as CreateNodePayload);
    reply.code(201);
    return node;
  });

  app.get('/boards/:id/nodes/:nodeId', async (req) => {
    const { id, nodeId } = req.params as Params;
    return service.getNodeContent(workspaceOf(req), safeId(id), safeId(nodeId));
  });

  app.put('/boards/:id/nodes/:nodeId/body', async (req) => {
    const { id, nodeId } = req.params as Params;
    const { body } = req.body as { body: string };
    return service.putBody(writableWorkspaceOf(req), safeId(id), safeId(nodeId), body ?? '');
  });

  app.put('/boards/:id/nodes/:nodeId/data', async (req) => {
    const { id, nodeId } = req.params as Params;
    return service.putData(writableWorkspaceOf(req), safeId(id), safeId(nodeId), (req.body ?? {}) as NodeData);
  });

  app.patch('/boards/:id/nodes/:nodeId', async (req) => {
    const { id, nodeId } = req.params as Params;
    return service.patchNode(writableWorkspaceOf(req), safeId(id), safeId(nodeId), req.body as PatchNodePayload);
  });

  app.get('/boards/:id/nodes/:nodeId/raw', async (req, reply) => {
    const { id, nodeId } = req.params as Params;
    const raw = await service.getRaw(workspaceOf(req), safeId(id), safeId(nodeId));
    reply.type('application/json');
    return { raw };
  });

  app.put('/boards/:id/nodes/:nodeId/raw', async (req) => {
    const { id, nodeId } = req.params as Params;
    const { raw } = req.body as { raw: string };
    return service.putRaw(writableWorkspaceOf(req), safeId(id), safeId(nodeId), raw ?? '');
  });

  app.post('/boards/:id/nodes/:nodeId/subboards/link', async (req) => {
    const { id, nodeId } = req.params as Params;
    const { boardId } = req.body as { boardId: string };
    return service.linkSubBoard(writableWorkspaceOf(req), safeId(id), safeId(nodeId), safeId(boardId));
  });

  app.post('/boards/:id/nodes/:nodeId/subboards/unlink', async (req) => {
    const { id, nodeId } = req.params as Params;
    const { boardId } = req.body as { boardId: string };
    return service.unlinkSubBoard(writableWorkspaceOf(req), safeId(id), safeId(nodeId), safeId(boardId));
  });

  app.post('/boards/:id/nodes/:nodeId/restore', async (req) => {
    const { id, nodeId } = req.params as Params;
    return service.restoreNode(writableWorkspaceOf(req), safeId(id), safeId(nodeId), (req.body ?? {}) as Partial<BoardNode>);
  });

  app.post('/boards/:id/nodes/:nodeId/archive', async (req) => {
    const { id, nodeId } = req.params as Params;
    return service.archiveNode(writableWorkspaceOf(req), safeId(id), safeId(nodeId));
  });
}
