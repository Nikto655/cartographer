import type { FastifyInstance } from 'fastify';
import { workspaceOf, writableWorkspaceOf } from '../auth/index.js';
import * as service from './service.js';

/**
 * Folders, assignments and favourites (v1.8 §7). Two routes and no more: the
 * file is one small object, so the client reads it whole and writes it whole —
 * per-folder CRUD would be four endpoints and a merge conflict apiece.
 *
 * Under the guarded `/api` scope, so auth is inherited. The read takes
 * `workspaceOf` because Admin View browses someone else's organisation
 * read-only (§7); the write takes `writableWorkspaceOf`, always.
 */
export async function foldersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/folders', async (req) => service.readFolders(workspaceOf(req)));

  app.put('/folders', async (req) => service.writeFolders(writableWorkspaceOf(req), req.body));
}
