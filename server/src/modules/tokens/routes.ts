import type { FastifyInstance } from 'fastify';
import type { CreateTokenPayload } from '@cartograph/shared';
import { badRequest } from '../../core/errors.js';
import { recordAudit } from '../admin/index.js';
import * as service from './service.js';

/**
 * Token management (v1.7 §2.2). Your own tokens only — every route is scoped to
 * `req.user!.id`, so there is nothing here an admin route would have to guard.
 *
 * The secret is returned by the route that mints it and nowhere else: shown
 * once, never logged, never readable again — same rule as an admin temp
 * password. A lost token is revoked and replaced, not recovered.
 */
export async function tokensRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tokens', async (req) => service.listTokens(req.user!.id));

  app.post('/tokens', async (req, reply) => {
    const { name, scope } = (req.body ?? {}) as Partial<CreateTokenPayload>;
    if (typeof name !== 'string') throw badRequest('A token name is required.');
    if (scope !== 'read' && scope !== 'write') {
      throw badRequest('`scope` must be “read” or “write”.');
    }
    const created = service.createToken(req.user!.id, name, scope);
    // The name, not the id: it is what the owner recognises, and the id is on
    // the row anyway. A token is a standing grant, so minting one is an event.
    recordAudit(req.user!.id, 'token.create', `${created.token.id} (${created.token.name})`);
    reply.code(201);
    return created;
  });

  app.delete('/tokens/:tokenId', async (req) => {
    const { tokenId } = req.params as { tokenId: string };
    // Read the name before it goes: the audit row is worthless as "revoked
    // 6f2a…" and the list stops showing it a moment later.
    const name = service.listTokens(req.user!.id).find((t) => t.id === tokenId)?.name;
    service.revokeToken(req.user!.id, tokenId);
    recordAudit(req.user!.id, 'token.revoke', name ? `${tokenId} (${name})` : tokenId);
    return { ok: true };
  });
}
