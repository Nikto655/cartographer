/**
 * Who an MCP request is, and what it may do (v1.7 §2.3).
 *
 * This is the whole of the MCP layer's access control, and it is deliberately
 * one step: a bearer secret resolves to a user id, and from there every call
 * goes down the same `(userId, boardId)` path as a browser session. There is no
 * second tenancy model to keep in step with the first — an agent sees exactly
 * what its token's owner sees, enforced where it has always been enforced.
 */
import type { TokenScope } from '@cartograph/shared';
import { HttpError } from '../../core/errors.js';
import { checkTokenRate, resolveToken, touchToken } from '../tokens/index.js';

export interface McpIdentity {
  userId: string;
  tokenId: string;
  /** The name its owner gave it. It goes in the audit row and on the node glyph. */
  tokenName: string;
  scope: TokenScope;
}

const unauthenticated = () =>
  new HttpError(401, 'unauthenticated', 'Send a Cartographer token as `Authorization: Bearer cart_…`.');

/**
 * Resolves the header, counts the call against the token's ceiling, and marks it
 * used. Throws rather than returning null: there is no anonymous MCP request,
 * and a caller that forgot the header gets the same answer as one holding a
 * revoked token.
 */
export function identify(authorization: string | undefined): McpIdentity {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  if (!match) throw unauthenticated();

  const resolved = resolveToken(match[1]);
  if (!resolved) throw unauthenticated();

  // Rate limit after resolution so an unknown secret cannot fill the map, and
  // before any work is done so a looping agent is refused cheaply.
  checkTokenRate(resolved.tokenId);
  touchToken(resolved.tokenId);
  return resolved;
}
