/** Typed fetch client mirroring §5. The only place that knows about URLs. */
import type {
  AdminUser,
  ApiToken,
  AppConfig,
  Board,
  BoardNode,
  BoardShares,
  BoardSummary,
  ClipboardSelection,
  CopyResult,
  CreateBoardPayload,
  CreateNodePayload,
  CreatedToken,
  ExportPayload,
  ExportResult,
  FoldersFile,
  GraphPayload,
  NodeContent,
  NodeData,
  PastePayload,
  PatchNodePayload,
  PromoteFrameResult,
  SessionResponse,
  ShareRecipient,
  SharedBoardSummary,
  ShelvedBoard,
  SnapshotInfo,
  TempPasswordResponse,
  TokenScope,
} from '@cartograph/shared';

const BASE = '/api';

/**
 * Whose boards the board routes address (v1.6 §5). Empty is the ordinary case —
 * your own workspace. Viewing anybody else's — a board shared with you, or an
 * Admin View browse — sets it to the owner, and every board URL below is then
 * the same route under `/u/:ownerId`. One prefix for both, because the server
 * decides which of them you are on one ladder; that is what makes "the normal
 * viewer, read-only" one code path rather than a second client.
 */
let scope = '';

export function setBoardScope(ownerId: string | null): void {
  scope = ownerId ? `/u/${ownerId}` : '';
}

/** Every board-addressed URL goes through here, so nothing can forget the scope. */
const b = (path: string) => `${scope}/boards${path}`;

let unauthorized: () => void = () => {};

/**
 * Every route but login sits behind the session (v1.6 §2), so a 401 anywhere
 * means the session ended — the app installs one handler and drops back to the
 * login screen. The auth routes answer for themselves, so they're exempt.
 */
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorized = handler;
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init?.headers } : init?.headers,
    });
  } catch (err) {
    throw new ApiError(0, 'offline', (err as Error).message);
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) unauthorized();
    let code = 'error';
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: { code: string; message: string } };
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const body = (value: unknown) => JSON.stringify(value);

export const api = {
  getConfig: () => request<AppConfig>('/config'),

  // auth (v1.6 §7) — the session lives in an httpOnly cookie, so nothing is passed here
  me: () => request<SessionResponse>('/auth/me'),
  login: (username: string, password: string) =>
    request<SessionResponse>('/auth/login', { method: 'POST', body: body({ username, password }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<SessionResponse>('/auth/change-password', {
      method: 'POST',
      body: body({ currentPassword, newPassword }),
    }),

  // boards
  /**
   * Scoped explicitly rather than through `b()`, and it is the one board call
   * that is. The ambient scope is set by an effect, and the dashboard asks for
   * summaries from an effect of its own — so leaving a shared board fired two
   * of these either side of the scope changing, and whichever answered last
   * won. That is why the shelf sometimes showed only the boards shared with
   * you until a refresh. The caller passes the owner it means, taken from the
   * URL at the moment of the call, and neither answer can be mistaken for the
   * other.
   */
  listBoards: (ownerId: string | null = null) =>
    request<BoardSummary[]>(`${ownerId ? `/u/${ownerId}` : ''}/boards`),
  // Creating is never scoped: a new board is always yours.
  createBoard: (payload: CreateBoardPayload) =>
    request<Board>('/boards', { method: 'POST', body: body(payload) }),
  getBoard: (id: string) => request<Board>(b(`/${id}`)),
  /**
   * Live changes to one board, as Server-Sent Events. Goes through `b()` like
   * every other board URL, so a shared board watches the *owner's* stream and
   * not a same-slug board of your own. The cookie rides along because
   * `EventSource` is same-origin here; there is nothing to authenticate by hand.
   */
  /* ---- the shelf below the shelf (v1.9) ---- */
  /** Never scoped: an archive belongs to whoever is signed in, not to a board. */
  listArchived: () => request<ShelvedBoard[]>('/boards/archived'),
  restoreArchived: (entry: string) =>
    request<Board>(`/boards/archived/${encodeURIComponent(entry)}/restore`, { method: 'POST' }),
  /** Moves it out of the owner's world; only a Super Admin sees it after this. */
  deleteArchived: (entry: string) =>
    request<{ deleted: string }>(`/boards/archived/${encodeURIComponent(entry)}/delete`, {
      method: 'POST',
    }),
  adminDeletedBoards: (userId: string) =>
    request<ShelvedBoard[]>(`/admin/users/${userId}/deleted`),
  /** The only call in the app that destroys anything. */
  adminPurgeBoard: (userId: string, entry: string) =>
    request<{ purged: string }>(
      `/admin/users/${userId}/deleted/${encodeURIComponent(entry)}`,
      { method: 'DELETE' },
    ),

  boardEvents: (id: string) => new EventSource(`/api${b(`/${id}/events`)}`),
  /**
   * Changes anywhere on your own shelf — a board created, renamed, archived, or
   * written to. Never scoped: the dashboard shows your workspace, and somebody
   * else's shelf is not a thing you are ever looking at.
   */
  shelfEvents: () => new EventSource('/api/boards/events'),
  renameBoard: (id: string, name: string) =>
    request<Board>(b(`/${id}`), { method: 'PATCH', body: body({ name }) }),
  /**
   * Takes its workspace explicitly, not from the ambient scope. A save is often
   * the last thing a board does on the way out, and by the time a queued one
   * goes on the wire the app may already be pointed at another workspace — a
   * shared board's owner, or back at your own — where the same slug is a
   * different board. The store binds the owner when the board opens.
   *
   * `keepalive` is for the save made as the tab goes away: the browser aborts an
   * ordinary fetch on unload, and finishes a keepalive one. `sendBeacon` cannot
   * do this job — it only POSTs, and this route is a PUT.
   */
  saveGraph: (id: string, payload: GraphPayload, ownerId: string | null, keepalive = false) =>
    request<Board>(`${ownerId ? `/u/${ownerId}` : ''}/boards/${id}/graph`, {
      method: 'PUT',
      body: body(payload),
      keepalive,
    }),
  duplicateBoard: (id: string) => request<Board>(b(`/${id}/duplicate`), { method: 'POST' }),
  archiveBoard: (id: string) => request<{ archived: string }>(b(`/${id}/archive`), { method: 'POST' }),

  // nodes
  createNode: (boardId: string, payload: CreateNodePayload) =>
    request<BoardNode>(b(`/${boardId}/nodes`), { method: 'POST', body: body(payload) }),
  getNode: (boardId: string, nodeId: string) =>
    request<NodeContent>(b(`/${boardId}/nodes/${nodeId}`)),
  putBody: (boardId: string, nodeId: string, value: string) =>
    request<NodeContent>(b(`/${boardId}/nodes/${nodeId}/body`), {
      method: 'PUT',
      body: body({ body: value }),
    }),
  putData: (boardId: string, nodeId: string, data: NodeData) =>
    request<NodeContent>(b(`/${boardId}/nodes/${nodeId}/data`), { method: 'PUT', body: body(data) }),
  patchNode: (boardId: string, nodeId: string, patch: PatchNodePayload) =>
    request<{ node: BoardNode; content: NodeContent; renamedFrom?: string }>(
      b(`/${boardId}/nodes/${nodeId}`),
      { method: 'PATCH', body: body(patch) },
    ),
  getRaw: (boardId: string, nodeId: string) =>
    request<{ raw: string }>(b(`/${boardId}/nodes/${nodeId}/raw`)),
  putRaw: (boardId: string, nodeId: string, raw: string) =>
    request<NodeContent>(b(`/${boardId}/nodes/${nodeId}/raw`), { method: 'PUT', body: body({ raw }) }),
  // clipboard (v1.6 §6) — one selection, duplicated in place or pasted elsewhere
  duplicateSelection: (boardId: string, selection: ClipboardSelection) =>
    request<CopyResult>(b(`/${boardId}/duplicate-selection`), {
      method: 'POST',
      body: body(selection),
    }),
  /** Never scoped: the board being pasted *into* is always your own (§6.2). */
  paste: (boardId: string, payload: PastePayload) =>
    request<CopyResult>(`/boards/${boardId}/paste`, { method: 'POST', body: body(payload) }),
  linkSubBoard: (boardId: string, nodeId: string, childId: string) =>
    request<BoardNode>(b(`/${boardId}/nodes/${nodeId}/subboards/link`), {
      method: 'POST',
      body: body({ boardId: childId }),
    }),
  unlinkSubBoard: (boardId: string, nodeId: string, childId: string) =>
    request<BoardNode>(b(`/${boardId}/nodes/${nodeId}/subboards/unlink`), {
      method: 'POST',
      body: body({ boardId: childId }),
    }),
  restoreNode: (boardId: string, nodeId: string, placement?: Partial<BoardNode>) =>
    request<BoardNode>(b(`/${boardId}/nodes/${nodeId}/restore`), {
      method: 'POST',
      body: body(placement ?? {}),
    }),
  archiveNode: (boardId: string, nodeId: string) =>
    request<{ archived: string }>(b(`/${boardId}/nodes/${nodeId}/archive`), { method: 'POST' }),

  // snapshots & export
  createSnapshot: (boardId: string) =>
    request<SnapshotInfo>(b(`/${boardId}/snapshots`), { method: 'POST' }),
  listSnapshots: (boardId: string) => request<SnapshotInfo[]>(b(`/${boardId}/snapshots`)),
  restoreSnapshot: (boardId: string, ts: string) =>
    request<{ restored: string; backup: string }>(b(`/${boardId}/snapshots/${ts}/restore`), {
      method: 'POST',
    }),
  promoteFrame: (boardId: string, frameId: string) =>
    request<PromoteFrameResult>(b(`/${boardId}/frames/${frameId}/promote`), { method: 'POST' }),
  exportPath: (boardId: string, payload: ExportPayload) =>
    request<ExportResult>(b(`/${boardId}/export`), { method: 'POST', body: body(payload) }),

  // admin (v1.6 §3, §7) — Super Admin only; the server says so, not the client
  adminUsers: () => request<AdminUser[]>('/admin/users'),
  adminCreateUser: (username: string, displayName: string) =>
    request<TempPasswordResponse>('/admin/users', {
      method: 'POST',
      body: body({ username, displayName }),
    }),
  adminResetPassword: (userId: string) =>
    request<TempPasswordResponse>(`/admin/users/${userId}/reset-password`, { method: 'POST' }),
  adminRenameUser: (userId: string, username: string, displayName: string) =>
    request<{ user: AdminUser }>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: body({ username, displayName }),
    }),
  adminSetDisabled: (userId: string, disabled: boolean) =>
    request<{ user: AdminUser }>(`/admin/users/${userId}/${disabled ? 'disable' : 'enable'}`, {
      method: 'POST',
    }),
  adminSetSuperAdmin: (userId: string, value: boolean) =>
    request<{ user: AdminUser }>(`/admin/users/${userId}/super-admin`, {
      method: 'POST',
      body: body({ value }),
    }),
  /** Someone else's board list, read-only. Explicit rather than scoped — the
   *  admin panel asks about a user without changing what the app is looking at. */
  adminUserBoards: (userId: string) => request<BoardSummary[]>(`/u/${userId}/boards`),

  // sharing (v1.6 §5, §7) — never scoped: you administer shares on your own boards
  boardShares: (boardId: string) => request<BoardShares>(`/boards/${boardId}/shares`),
  shareBoard: (
    boardId: string,
    userId: string,
    canDuplicate: boolean,
    includeChildren: boolean,
    canExport: boolean,
  ) =>
    request<{ shares: ShareRecipient[] }>(`/boards/${boardId}/shares`, {
      method: 'POST',
      body: body({ userId, canDuplicate, includeChildren, canExport }),
    }),
  unshareBoard: (boardId: string, userId: string) =>
    request<{ shares: ShareRecipient[] }>(
      `/boards/${boardId}/shares?userId=${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ),
  sharedWithMe: () => request<SharedBoardSummary[]>('/shared-with-me'),
  /** Which of your own boards you have shared, and with whom (display names). */
  myShares: () => request<Record<string, string[]>>('/my-shares'),
  /** Takes a copy of a whole shared tree into your own root (§5). */
  duplicateShared: (boardId: string) =>
    request<Board>(`/shared/${boardId}/duplicate`, { method: 'POST' }),

  // personal access tokens (v1.7 §2) — never scoped: a token is yours, and it
  // reaches your workspace only. Like share administration, it is about the
  // account rather than about whichever board is open.
  listTokens: () => request<ApiToken[]>('/tokens'),
  /** The secret comes back exactly once, here, and is never retrievable again (§2.2). */
  createToken: (name: string, scope: TokenScope) =>
    request<CreatedToken>('/tokens', { method: 'POST', body: body({ name, scope }) }),
  revokeToken: (tokenId: string) => request<{ ok: true }>(`/tokens/${tokenId}`, { method: 'DELETE' }),

  /*
   * Folders (v1.8 §7). Never scoped: how your own shelf is arranged is a fact
   * about your workspace, like sharing and tokens. Read and written whole — it is
   * one small file, and per-folder CRUD would be ceremony around a JSON blob.
   */
  getFolders: () => request<FoldersFile>('/folders'),
  putFolders: (file: FoldersFile) =>
    request<FoldersFile>('/folders', { method: 'PUT', body: body(file) }),
};
