import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SessionUser } from '@cartograph/shared';
import { HttpError, notFound } from '../../core/errors.js';
import {
  type Workspace,
  ensureWorkspace,
  exists,
  safeId,
  readOnlyWorkspaceFor,
  workspaceFor,
} from '../../core/storage.js';
import { SESSION_COOKIE, authenticate } from './service.js';

/**
 * How the caller reached the workspace they are looking at (v1.6 §5). `own` is
 * the ordinary case; `readonly` is every other way in — admin view today,
 * shares tomorrow — and is the single thing every write checks. There is no
 * third mode: an access the resolver cannot name never gets a workspace at all,
 * and the request 404s rather than confirming that a board exists.
 */
export type AccessMode = 'own' | 'readonly';

/**
 * Which rung of §5's ladder let the request in — your own workspace, a share
 * row, or Admin View. `access` answers "may this write"; `grant` answers "how
 * did it get here", which is a different question and has exactly two readers:
 * the audit log (admin opens are events, shares are not) and nothing else.
 */
export type AccessGrant = 'own' | 'share' | 'admin';

declare module 'fastify' {
  interface FastifyRequest {
    /** Filled by `requireSession`; every guarded route can rely on it. */
    user: SessionUser | null;
    sessionToken: string | null;
    /** The workspace this request is looking at (v1.6 §4). Filled by `requireAuth`. */
    ws: Workspace | null;
    /** How it was reached. Only ever narrowed after the fact, never widened. */
    access: AccessMode | null;
    grant: AccessGrant | null;
    /**
     * The boards this request may see at all, or null for "every board in the
     * workspace". A share names one board and covers its sub-board tree (§5), so
     * a recipient's request carries the tree and nothing else is addressable.
     */
    visible: ReadonlySet<string> | null;
  }
}

/**
 * Adds the request fields the hooks below write. Called on the `/api` scope, so
 * both the auth routes and the guarded ones inherit them.
 */
export function installAuth(app: FastifyInstance): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);
  app.decorateRequest('ws', null);
  app.decorateRequest('access', null);
  app.decorateRequest('grant', null);
  app.decorateRequest('visible', null);
}

/** A valid session, nothing more — what logout and change-password need. */
export async function requireSession(req: FastifyRequest): Promise<void> {
  const token = req.cookies[SESSION_COOKIE] ?? null;
  const user = token ? authenticate(token) : null;
  if (!user) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  req.user = user;
  req.sessionToken = token;
}

/**
 * The wall in front of every other `/api/*` route. A temp password reaches
 * nothing but the change-password screen — the client enforces the flow, this
 * makes it true (§2).
 */
export async function requireAuth(req: FastifyRequest): Promise<void> {
  await requireSession(req);
  if (req.user?.mustChangePassword) {
    throw new HttpError(
      403,
      'password_change_required',
      'Change your password before continuing.',
    );
  }
  // The one place a user id becomes a set of paths: from here on the request
  // carries a root, and no route has to remember whose files it is looking at.
  req.ws = workspaceFor(req.user!.id);
  req.access = 'own';
  req.grant = 'own';
  req.visible = null;
  await ensureWorkspace(req.ws);
}

/**
 * Re-points the request at somebody else's workspace, read-only (§5). The only
 * producer of a non-`own` access there is; both ways in — a share row and Admin
 * View — come through here, and the caller says which so the audit log can tell
 * them apart.
 *
 * Deliberately does not shape the target root: browsing is not a reason to write
 * directories into another person's workspace.
 */
export function enterReadOnly(
  req: FastifyRequest,
  ownerId: string,
  grant: Exclude<AccessGrant, 'own'>,
): void {
  req.ws = readOnlyWorkspaceFor(ownerId);
  req.access = 'readonly';
  req.grant = grant;
}

/**
 * Narrows what the request may address to a named set of boards. Separate from
 * `enterReadOnly` because the two facts are separate: a share is read-only *and*
 * partial, Admin View is read-only and whole.
 */
export function restrictToBoards(req: FastifyRequest, boardIds: ReadonlySet<string>): void {
  req.visible = boardIds;
}

/** Whether one board id is addressable on this request. */
export function isBoardVisible(req: FastifyRequest, boardId: string): boolean {
  return req.visible === null || req.visible.has(boardId);
}

/**
 * The caller's workspace, for reads. Never falls back to anything — a request
 * that reached a content route without one is a bug, not an anonymous read.
 */
export function workspaceOf(req: FastifyRequest): Workspace {
  if (!req.ws) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  return req.ws;
}

const readOnlyError = () =>
  new HttpError(403, 'read_only', 'This board is open read-only — it is not yours to change.');

/**
 * The workspace, for writes. Every mutating route asks for it by this name, so
 * "which routes can write" is a grep and not a memory: `workspaceOf` reads,
 * `writableWorkspaceOf` writes, and read-only access never gets past here.
 */
export function writableWorkspaceOf(req: FastifyRequest): Workspace {
  const ws = workspaceOf(req);
  if (req.access !== 'own') throw readOnlyError();
  return ws;
}

/**
 * Export is the one non-GET read (§5: export works on a board you can only
 * view). Everything else that is not a GET changes something.
 */
const READ_SAFE_NON_GET = /\/export$/;

/**
 * Belt to the braces above: on a read-only scope, nothing but a read may run at
 * all. Default-deny by method, so a mutating route added later that forgets to
 * ask for a *writable* workspace is still refused rather than quietly allowed.
 */
export async function denyMutations(req: FastifyRequest): Promise<void> {
  // Your own workspace reached through the shared prefix is still your own (§5,
  // first rung); the hook is here for every other way in.
  if (req.access === 'own') return;
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (READ_SAFE_NON_GET.test(req.routeOptions?.url ?? '')) return;
  throw readOnlyError();
}

/**
 * Resolves `:id` — always a board id — against the workspace the request ended
 * up with, before any handler runs. A board you cannot see is then a 404 on
 * every sub-route alike, instead of each route deciding for itself and
 * `…/snapshots` cheerfully answering `[]` for a board that isn't yours.
 */
export async function assertBoardVisible(req: FastifyRequest): Promise<void> {
  const { id } = (req.params ?? {}) as { id?: string };
  if (typeof id !== 'string') return;
  const ws = workspaceOf(req);
  // safeId first: a crafted id is a bad request, and never a path.
  const boardId = safeId(id);
  // A board outside the shared tree is missing in exactly the way a board that
  // does not exist is missing — the recipient learns nothing either way (§5).
  if (!isBoardVisible(req, boardId)) throw notFound(`Board not found: ${id}`);
  if (!(await exists(ws.boardFile(boardId)))) throw notFound(`Board not found: ${id}`);
}

/** Admin-only routes (§3). A plain user gets the same 403 whatever they asked for. */
export async function requireSuperAdmin(req: FastifyRequest): Promise<void> {
  if (!req.user?.isSuperAdmin) {
    throw new HttpError(403, 'forbidden', 'This is a Super Admin action.');
  }
}
