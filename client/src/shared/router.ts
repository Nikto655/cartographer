import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function navigate(to: string, replace = false): void {
  if (to === window.location.pathname) return;
  if (replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  emit();
}

window.addEventListener('popstate', emit);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return window.location.pathname;
}

/** The dashboard's five tabs, in the URL so the back button can return to one. */
export type DashboardTab = 'recent' | 'all' | 'folders' | 'shared' | 'archive';

export type Route =
  /**
   * Which tab, and which folder is open inside Folders.
   *
   * These used to be React state, which meant the URL was `/` for all of them —
   * so leaving the dashboard and pressing back landed you on Recent with
   * nothing open, wherever you had actually been. The browser can only return
   * you somewhere it has a name for.
   *
   * `folderId` is a folder id, the string 'unfiled' for the tray, or null for
   * the shelf itself.
   */
  | { name: 'dashboard'; tab: DashboardTab; folderId: string | null }
  /**
   * `ownerId` is set only on `/u/:userId/b/:boardId` — somebody else's board,
   * opened read-only (v1.6 §3, §5). The URL carries it because the whole viewer
   * hangs off it: which workspace the API addresses, and whether anything on
   * screen may write.
   */
  | { name: 'board'; boardId: string; ownerId: string | null }
  | { name: 'unknown' };

const BOARD_ID = '[a-z0-9][a-z0-9-]*';
const USER_ID = '[0-9a-f-]{8,}';
const FOLDER_ID = '[A-Za-z0-9-]+';
const ownBoard = new RegExp(`^/b/(${BOARD_ID})/?$`);
const otherBoard = new RegExp(`^/u/(${USER_ID})/b/(${BOARD_ID})/?$`);
const foldersTab = new RegExp(`^/folders(?:/(${FOLDER_ID}))?/?$`);

export function useRoute(): Route {
  return parse(useSyncExternalStore(subscribe, getSnapshot, getSnapshot));
}

/**
 * The same answer outside React. Anything that fetches has to know whose
 * workspace it is addressing, and the URL is the only thing that knows —
 * reading it at the moment of the call is what stops a request that was queued
 * before a navigation from being answered as if it came after one.
 */
export function currentRoute(): Route {
  return parse(getSnapshot());
}

/** Whose workspace the current URL addresses; null is your own. */
export function currentOwner(): string | null {
  const route = currentRoute();
  return route.name === 'board' ? route.ownerId : null;
}

function parse(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'dashboard', tab: 'recent', folderId: null };
  if (pathname === '/all' || pathname === '/all/') {
    return { name: 'dashboard', tab: 'all', folderId: null };
  }
  if (pathname === '/archive' || pathname === '/archive/') {
    return { name: 'dashboard', tab: 'archive', folderId: null };
  }
  if (pathname === '/shared' || pathname === '/shared/') {
    return { name: 'dashboard', tab: 'shared', folderId: null };
  }
  const folders = foldersTab.exec(pathname);
  if (folders) return { name: 'dashboard', tab: 'folders', folderId: folders[1] ?? null };
  const own = ownBoard.exec(pathname);
  if (own) return { name: 'board', boardId: own[1], ownerId: null };
  const other = otherBoard.exec(pathname);
  if (other) return { name: 'board', boardId: other[2], ownerId: other[1] };
  return { name: 'unknown' };
}

export const routes = {
  dashboard: () => '/',
  /** One address per tab, so each is somewhere the browser can go back to. */
  tab: (tab: DashboardTab) => (tab === 'recent' ? '/' : `/${tab}`),
  /** A folder open inside the Folders tab; 'unfiled' is the tray. */
  folder: (folderId: string | null) => (folderId ? `/folders/${folderId}` : '/folders'),
  board: (id: string) => `/b/${id}`,
  /** The same board viewer, pointed at a workspace that is not yours. */
  userBoard: (ownerId: string, id: string) => `/u/${ownerId}/b/${id}`,
};

/**
 * Where another board sits *from where you are now*. Drilling into a sub-board,
 * or walking back up the breadcrumb, must stay inside the workspace you are
 * browsing — a bare `/b/:id` there would silently mean "the same slug, in my
 * own boards", which is a different board entirely.
 */
export function boardHref(boardId: string): string {
  const match = otherBoard.exec(window.location.pathname);
  return match ? routes.userBoard(match[1], boardId) : routes.board(boardId);
}
