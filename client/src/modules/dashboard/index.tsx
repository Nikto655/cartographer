import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ArrowUpDown, Check, Star, Users } from 'lucide-react';
import type { BoardSummary, BoardType } from '@cartograph/shared';
import { api } from '@/shared/api';
import { listBoardTypes, resolveBoardType } from '@/board-types';
import { useStore } from '@/shared/store';
import { navigate, routes, useRoute } from '@/shared/router';
import { isTypingTarget, relativeTime, useLocalStorage } from '@/shared/hooks';
import { overlayOwnsKeyboard } from '@/shared/overlay';
import { ProfileMenu, useAuth } from '@/modules/auth';
import { AdminPanel, AdminToggle, useAdminView } from '@/modules/admin';
import { ShareDialog, SharedWithMe } from '@/modules/share';
import { boardDragProps, FoldersTab, MoveToFolderItems, NewFolderDialog } from '@/modules/folders';
import { ArchiveTab } from './ArchiveTab';
import {
  Button,
  Chip,
  InlineEdit,
  Kbd,
  Logo,
  Menu,
  MenuItem,
  MenuSeparator,
  Modal,
  StatusStrip,
  Tabs,
} from '@/shared/ui';
import { toast } from '@/shared/ui/toast';
import './dashboard.css';

/** The four orders the shelf can be read in (v1.8 §4). */
type SortKey = 'newest' | 'oldest' | 'az' | 'nodes';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'az', label: 'A–Z' },
  { id: 'nodes', label: 'Most nodes' },
];

/**
 * The chosen order, with starred boards ahead of it (§3): favourites are an
 * emphasis rather than a place, so they lead whichever sort is on rather than
 * living in a tab of their own.
 *
 * `favoritesFirst: false` is for Recent, which draws a Pinned row above the
 * grid — leading the grid with the same boards would say it twice.
 */
function compareBy(
  sort: SortKey,
  favoritesFirst = true,
): (a: BoardSummary, b: BoardSummary) => number {
  return (a, b) => {
    if (favoritesFirst && !!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    switch (sort) {
      case 'oldest':
        return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
      case 'az':
        return a.name.localeCompare(b.name);
      case 'nodes':
        return b.nodeCount - a.nodeCount || a.name.localeCompare(b.name);
      default:
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    }
  };
}

/** Long enough not to fire on a click, short enough to feel like a press (§6). */
const LONG_PRESS_MS = 450;

/** How long the shelf waits for a burst of writes to stop before re-reading. */
const SHELF_SETTLE_MS = 900;

export function Dashboard() {
  const summaries = useStore((s) => s.summaries);
  const shared = useStore((s) => s.shared);
  const config = useStore((s) => s.config);
  const loadSummaries = useStore((s) => s.loadSummaries);
  const loadShared = useStore((s) => s.loadShared);
  const loadFolders = useStore((s) => s.loadFolders);
  const sharedByMe = useStore((s) => s.sharedByMe);
  const folders = useStore((s) => s.folders);
  const assignBoards = useStore((s) => s.assignBoards);
  const setFavorite = useStore((s) => s.setFavorite);
  const user = useAuth((s) => s.user);
  const adminOn = useAdminView((s) => s.on);
  const [menu, setMenu] = useState<{ id: string; card: string; x: number; y: number } | null>(null);
  /*
   * Which *card* is being renamed — `scope:boardId`, not a board id.
   *
   * The title used to open its own editor on click, which fought the card: the
   * name is the most obvious thing to click when you mean "open this board",
   * and clicking it put you in a text field instead. Renaming is a deliberate
   * act now, and it starts from the ⋯ menu where the other deliberate acts are.
   *
   * Keyed per card because one board can be on screen twice: a starred board is
   * drawn in Recent's Pinned row *and* in the grid below it. Keyed on the board
   * id, both copies turned into inputs at once, both carrying `autoFocus` — the
   * second stole focus, the first fired `onBlur`, and blur commits and closes.
   * The rename appeared and vanished inside one frame, which reads exactly like
   * a button that does nothing.
   */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Which board's share dialog is open, by id — null when none is. */
  const [sharing, setSharing] = useState<string | null>(null);
  // In All, sub-maps show by default — that is what the view is for. Individual
  // parents can still be folded away, and that choice is remembered.
  const [collapsed, setCollapsed] = useLocalStorage<string[]>('cartograph.collapsedParents', []);
  /** Which world the pending board belongs to, or null when nothing is being made. */
  const [creating, setCreating] = useState<string | null>(null);
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  /** The New folder dialog, which is the folders module's to draw (§2). */
  const [newFolder, setNewFolder] = useState(false);
  const [draft, setDraft] = useState('');
  // Core offers whatever worlds exist without knowing what any of them are (§3.4).
  const worlds = useMemo(() => listBoardTypes(), []);
  /*
   * 'recent' is a flat list, newest first, sub-boards included — what you were
   * last working on, wherever it lives. 'all' is the shelf: top-level boards
   * with their children nested under them.
   *
   * Recent replaced a 'main' view that listed only boards standing on their own,
   * which meant the thing you had touched five minutes ago was invisible if it
   * happened to be a sub-board. Not persisted — the dashboard always opens on
   * Recent, because "what was I doing" is the question you arrive with.
   *
   * 'folders' is the third of those and the only one that arranges rather than
   * lists: Recent and All keep showing every board, foldered or not (v1.8 §1).
   */
  /*
   * Which tab, read from the URL rather than held here.
   *
   * As component state the address was `/` whichever tab you were on, so
   * leaving for a board and pressing back returned you to Recent — the default,
   * not where you were. The browser can only take you back somewhere that had
   * a name.
   */
  const route = useRoute();
  const view = route.name === 'dashboard' ? route.tab : 'recent';
  const setView = (next: 'recent' | 'all' | 'folders' | 'shared' | 'archive') =>
    navigate(routes.tab(next));
  /** Recent is flat; All and a folder's contents nest children under parents. */
  const nested = view === 'all' || view === 'folders';

  /** Dashboard-level filtering only — in-board search is `Ctrl+K`'s (§4). */
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Which order the nested views are read in. Persisted, because it is a way of
  // working rather than a thing you set per visit (§4).
  const [sort, setSort] = useLocalStorage<SortKey>('cartograph.boardSort', 'newest');
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);

  /** The bulk selection, by board id. Empty means select mode is off (§6). */
  const [selected, setSelected] = useState<string[]>([]);
  const pressTimer = useRef<number | undefined>(undefined);
  /** A long press ends in a click too; that click must not open the board. */
  const pressed = useRef(false);
  const [moveMenu, setMoveMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // Every tab selects. Recent was excluded on the reading that it is a log
  // rather than a shelf, but the boards you want to file are exactly the ones
  // you were just working on — and a modifier-click that works on one tab and
  // silently does nothing on another reads as broken, not as a rule.
  const selectMode = selected.length > 0;

  useEffect(() => {
    void loadSummaries();
    // Re-read on every visit: a share revoked while you were elsewhere should be
    // gone when you come back, and there is no channel to tell us (§5).
    void loadShared();
    void loadFolders();
  }, [loadSummaries, loadShared, loadFolders]);

  /*
   * The shelf, live (v1.9). A board an agent creates arrives while nothing on
   * this screen is open on it, so the canvas's own stream never hears about it —
   * the dashboard needs one of its own or the board simply is not there until
   * the page is reloaded.
   *
   * Coalesced, because the events are per write: an agent building a board of
   * thirty nodes emits thirty of them, and re-listing the shelf is a scan of
   * every board directory in the workspace. One reload a second after the last
   * one is what a person perceives as "it appeared" anyway.
   */
  useEffect(() => {
    let timer: number | undefined;
    const stream = api.shelfEvents();
    stream.addEventListener('shelf', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void loadSummaries();
        void loadFolders();
      }, SHELF_SETTLE_MS);
    });
    return () => {
      window.clearTimeout(timer);
      stream.close();
    };
  }, [loadSummaries, loadFolders]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      /*
       * A dialog or a menu owns the keyboard while it is up: Escape is its close,
       * and `/` must not yank focus out of a form the person is filling in.
       * `event` matters as well — the menu closes on Escape before this runs.
       */
      if (overlayOwnsKeyboard(event)) return;
      if (event.key === 'Escape') {
        setSelected([]);
        return;
      }
      if (event.key === '/') {
        // Before default, or the slash lands in the field it just focused.
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        // The shortcut stays what it always was — a new board in the first world.
        setCreating(worlds[0]?.id ?? null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [worlds]);

  const compare = useMemo(() => compareBy(sort), [sort]);
  /** Recent's own order — the same choice, minus the favourites lead (§4). */
  const compareFlat = useMemo(() => compareBy(sort, false), [sort]);

  const { roots, childrenOf } = useMemo(() => {
    const byParent = new Map<string, BoardSummary[]>();
    for (const summary of summaries) {
      if (!summary.parentBoard) continue;
      const list = byParent.get(summary.parentBoard) ?? [];
      list.push(summary);
      byParent.set(summary.parentBoard, list);
    }
    const known = new Set(summaries.map((s) => s.id));
    const standalone = summaries.filter((s) => !s.parentBoard || !known.has(s.parentBoard));
    // Recent draws a flat list off `summaries` rather than this tree, so it
    // sorts where it is rendered; nothing here needs ordering for it.
    if (!nested) return { roots: standalone, childrenOf: byParent };
    for (const [, list] of byParent) list.sort(compare);
    return { roots: [...standalone].sort(compare), childrenOf: byParent };
  }, [summaries, nested, compare]);

  const needle = query.trim().toLowerCase();

  /*
   * What the search leaves standing. Two sets, because a flat list and a tree
   * cannot be filtered the same way.
   *
   * `selfMatch` is the boards whose own name matches — all Recent needs, since
   * every board is listed there in its own right.
   *
   * `treeKeep` is what the nested views draw, and it is how filtering avoids
   * orphaning a child: a match takes its ancestors with it, so a sub-board whose
   * parent does not match is still reachable under that parent rather than
   * vanishing with it. It takes its descendants too, so searching a parent's
   * name shows the parent *with* what is inside it. A card drawn only because a
   * descendant matched is context, not a result, which is why the count beside
   * the tabs reports `selfMatch` and not this.
   */
  const { selfMatch, treeKeep } = useMemo(() => {
    if (!needle) return { selfMatch: null, treeKeep: null };
    const byId = new Map(summaries.map((s) => [s.id, s]));
    const self = new Set<string>();
    for (const summary of summaries) {
      if (summary.name.toLowerCase().includes(needle)) self.add(summary.id);
    }
    const keep = new Set(self);
    const walked = new Set<string>();
    const descend = (id: string) => {
      if (walked.has(id)) return;
      walked.add(id);
      for (const child of childrenOf.get(id) ?? []) {
        keep.add(child.id);
        descend(child.id);
      }
    };
    for (const id of self) {
      descend(id);
      let current = byId.get(id);
      const seen = new Set<string>([id]);
      while (current?.parentBoard && !seen.has(current.parentBoard)) {
        seen.add(current.parentBoard);
        const parent = byId.get(current.parentBoard);
        if (!parent) break;
        keep.add(parent.id);
        current = parent;
      }
    }
    return { selfMatch: self, treeKeep: keep };
  }, [summaries, childrenOf, needle]);

  /** Whether a card survives the current query in a nested view. */
  const kept = (summary: BoardSummary) => !treeKeep || treeKeep.has(summary.id);

  const create = async (name: string, boardType: string) => {
    const trimmed = name.trim();
    setCreating(null);
    setDraft('');
    if (!trimmed) return;
    try {
      const board = await api.createBoard({ name: trimmed, boardType: boardType as BoardType });
      navigate(routes.board(board.id));
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const act = async (id: string, action: 'rename' | 'duplicate' | 'archive', value?: string) => {
    try {
      if (action === 'duplicate') {
        await api.duplicateBoard(id);
        toast('Board duplicated');
      } else if (action === 'archive') {
        await api.archiveBoard(id);
        toast('Board archived · restore it from the Archive tab');
      } else if (action === 'rename' && value) {
        await api.renameBoard(id, value);
      }
      await loadSummaries();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  // ---- selection (§6) ----

  const toggleOne = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  const onCardClick = (event: ReactMouseEvent, id: string) => {
    // The click that ends a long press has already done its work.
    if (pressed.current) {
      pressed.current = false;
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      toggleOne(id);
      return;
    }
    // With a selection on screen a plain click keeps selecting; with nothing
    // selected it opens the board, which is what a card has always done (§6).
    if (selectMode) {
      toggleOne(id);
      return;
    }
    navigate(routes.board(id));
  };

  const endPress = () => {
    if (pressTimer.current !== undefined) window.clearTimeout(pressTimer.current);
    pressTimer.current = undefined;
  };

  const startPress = (event: ReactPointerEvent, id: string) => {
    if (event.button !== 0) return;
    pressed.current = false;
    endPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = undefined;
      pressed.current = true;
      toggleOne(id);
    }, LONG_PRESS_MS);
  };

  /** Sub-boards are filed by their parent and never moved on their own (§1). */
  const movable = useMemo(
    () => selected.filter((id) => !summaries.find((s) => s.id === id)?.parentBoard),
    [selected, summaries],
  );

  const bulkMove = (folderId: string | null) => {
    const ids = movable;
    setSelected([]);
    if (ids.length === 0) {
      toast('Sub-boards are filed with their parent');
      return;
    }
    // One write, one undo toast — the action already raises it (§6).
    void assignBoards(ids, folderId);
  };

  const bulkFavorite = async () => {
    const ids = [...selected];
    // Undo puts back only what this changed: a board that was already starred
    // before the bulk action stays starred.
    const added = ids.filter((id) => !summaries.find((s) => s.id === id)?.favorite);
    setSelected([]);
    await setFavorite(ids, true);
    toast(
      `Starred ${ids.length} board${ids.length === 1 ? '' : 's'}`,
      added.length > 0 ? { label: 'Undo', run: () => void setFavorite(added, false) } : undefined,
    );
  };

  const bulkArchive = async () => {
    const ids = [...selected];
    setConfirmArchive(false);
    setSelected([]);
    let done = 0;
    for (const id of ids) {
      try {
        await api.archiveBoard(id);
        done += 1;
      } catch {
        // A parent takes its sub-boards with it, so one already gone is not a
        // failure — only a board nothing archived would be.
      }
    }
    await loadSummaries();
    // No Undo button, but no longer because it is impossible: archiving is
    // reversible from the Archive tab now, and pointing there is more useful
    // than a toast action that vanishes in 2.5 seconds.
    toast(`Archived ${done} board${done === 1 ? '' : 's'} · restore them from the Archive tab`);
  };

  /** The board the context menu is open on — its own summary, not just its id. */
  const menuBoard = menu ? summaries.find((s) => s.id === menu.id) : undefined;

  /**
   * `scope` distinguishes the copies of one board on screen — see `renaming`.
   * Anything that must address a single card rather than a board keys on it.
   */
  const renderCard = (summary: BoardSummary, depth = 0, scope = 'grid') => {
    const cardKey = `${scope}:${summary.id}`;
    // A filtered view is expanded: a parent folded away while its child is the
    // very thing being searched for would hide the only result (§4).
    const children = nested
      ? (childrenOf.get(summary.id) ?? []).filter(kept)
      : [];
    const subCount = (childrenOf.get(summary.id) ?? []).length;
    const sharedWith = sharedByMe[summary.id] ?? [];
    const isCollapsed = !needle && collapsed.includes(summary.id);
    const isSelected = selected.includes(summary.id);
    // Only in Recent: All already says it by indenting the card under its parent.
    const parent =
      view === 'recent' && summary.parentBoard
        ? summaries.find((s) => s.id === summary.parentBoard)
        : undefined;
    // Each world draws its own mark; the browser only asks for it (§3.4).
    const world = resolveBoardType(summary.boardType);
    // Only where there is a folder card to drop it on (v1.8 §2). Sub-boards
    // decline: they are in a folder because their parent is, never on their own.
    const drag = view === 'folders' ? boardDragProps(summary) : {};
    return (
      <div key={summary.id} className="cg-board-group" style={{ marginLeft: depth ? 20 : 0 }}>
        <article
          className={`cg-board-card${isSelected ? ' cg-board-card--selected' : ''}`}
          data-board-id={summary.id}
          {...drag}
          onClick={(e) => onCardClick(e, summary.id)}
          onPointerDown={(e) => startPress(e, summary.id)}
          onPointerUp={endPress}
          onPointerLeave={endPress}
          onPointerCancel={endPress}
          onKeyDown={(e) => e.key === 'Enter' && navigate(routes.board(summary.id))}
          tabIndex={0}
          role="button"
        >
          <div className="cg-board-card__head">
            {selectMode ? (
              <span
                className={`cg-board-card__check${isSelected ? ' cg-board-card__check--on' : ''}`}
                aria-hidden
              >
                {isSelected && <Check size={13} />}
              </span>
            ) : (
              <span className="cg-board-card__world" title={world.label} aria-label={world.label}>
                <world.Icon size={15} />
              </span>
            )}
            {/*
              * Title and, for a sub-board in Recent, what it lives inside —
              * stacked, so the parent reads as a subtitle of the name rather
              * than as another statistic in the metadata line. It sits inside
              * the height the head already reserves for two lines of title, so
              * a sub-board card is no taller than any other.
              */}
            <div className="cg-board-card__title">
              <InlineEdit
                className="cg-board-card__name"
                value={summary.name}
                editing={renaming === cardKey}
                onEditingChange={(on) => setRenaming(on ? cardKey : null)}
                ariaLabel="Rename board"
                onCommit={(next) => void act(summary.id, 'rename', next)}
              />
              {parent && (
                <span className="cg-board-card__parent" title={`Inside ${parent.name}`}>
                  in {parent.name}
                </span>
              )}
            </div>
            {/*
              * The actions, as one fixed-width cluster. Both are always in the
              * DOM — only their opacity changes — so the title's right edge is
              * the same on every card, which is the whole point of grouping
              * them: anything conditional in this row moves the title.
              */}
            <div className="cg-board-card__actions">
            {/* Top-right of the card, on hover — and staying put once it is on,
                because a favourite you cannot see is not an emphasis (§3). */}
            <button
              type="button"
              className={`cg-board-card__star${summary.favorite ? ' cg-board-card__star--on' : ''}`}
              aria-label={summary.favorite ? 'Remove star' : 'Star board'}
              aria-pressed={!!summary.favorite}
              title={summary.favorite ? 'Remove star' : 'Star board'}
              // The card navigates on click and on Enter; a control inside it
              // must do neither.
              onKeyDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void setFavorite([summary.id], !summary.favorite);
              }}
            >
              <Star size={13} fill={summary.favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              className="cg-board-card__more"
              aria-label="Board actions"
              // The card navigates on Enter; a control inside it must not. Only
              // Enter: stopping every key kept Escape from the menu it opens.
              onKeyDown={(e) => e.key === 'Enter' && e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.target as HTMLElement).getBoundingClientRect();
                setMenu({ id: summary.id, card: cardKey, x: rect.left - 140, y: rect.bottom + 6 });
              }}
            >
              ⋯
            </button>
            </div>
          </div>

          <div className="cg-board-card__meta mono">
            {/*
             * You gave this one out. It leads the metadata line rather than
             * sitting in the title row, where it was the one thing that came
             * and went — so a shared board's name wrapped in a different place
             * from an unshared one's, on a line already short of room. Here it
             * costs the title nothing, and first in the row it reads as a mark
             * on the card rather than as a footnote to the node count.
             */}
            {sharedWith.length > 0 && (
              <span
                className="cg-board-card__shared"
                title={`Shared with ${sharedWith.join(', ')}`}
                aria-label={`Shared with ${sharedWith.join(', ')}`}
              >
                <Users size={11} />
              </span>
            )}
            <span>
              {summary.nodeCount} node{summary.nodeCount === 1 ? '' : 's'}
            </span>
            {subCount > 0 && <span className="cg-board-card__dot">·</span>}
            {subCount > 0 &&
              (nested ? (
                <button
                  type="button"
                  className="cg-board-card__children"
                  onKeyDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCollapsed(
                      isCollapsed ? collapsed.filter((c) => c !== summary.id) : [...collapsed, summary.id],
                    );
                  }}
                >
                  {isCollapsed ? '▸' : '▾'} {subCount} sub-board{subCount === 1 ? '' : 's'}
                </button>
              ) : (
                <span className="cg-board-card__children cg-board-card__children--static">
                  {subCount} sub-board{subCount === 1 ? '' : 's'}
                </span>
              ))}
            <span className="cg-board-card__time">{relativeTime(summary.updatedAt)}</span>
          </div>

          {config && <StatusStrip counts={summary.statusCounts} statuses={config.statuses} height={4} />}
        </article>

        {!isCollapsed && children.map((child) => renderCard(child, depth + 1, scope))}
      </div>
    );
  };

  /** Recent's own list and All's, after the search has had its say. */
  const shown =
    view === 'recent'
      ? [...summaries.filter((s) => !selfMatch || selfMatch.has(s.id))].sort(compareFlat)
      : roots.filter(kept);
  /** The Pinned row, above the grid and only when there is one (§3). */
  const pinned = summaries
    .filter((s) => s.favorite && (!selfMatch || selfMatch.has(s.id)))
    .sort(compareFlat);

  /** Recent's grid below the Pinned and Shared sections — everything else. */
  const rest = view === 'recent' ? shown.filter((s) => !s.favorite) : shown;

  const count = needle
    ? `${selfMatch?.size ?? 0} match${selfMatch?.size === 1 ? '' : 'es'}`
    : view === 'recent'
      ? `${summaries.length} board${summaries.length === 1 ? '' : 's'}`
      : view === 'all'
        ? `${roots.length} top-level · ${summaries.length} in all`
        : view === 'folders'
          ? `${folders.length} folder${folders.length === 1 ? '' : 's'}`
          : view === 'shared'
            ? `${shared.length} shared with you`
            : 'archived';

  return (
    <div className="cg-dashboard">
      <header className="cg-dashboard__head">
        {/* Who you are sits with the wordmark; what you can make sits with the maps. */}
        <div className="cg-dashboard__topline">
          <div className="cg-dashboard__brand">
            <Logo size={30} />
            <p className="cg-dashboard__wordmark">Cartographer</p>
          </div>
          <div className="spacer" />
          <AdminToggle />
          <ProfileMenu />
        </div>
      </header>

      {/* The tab row carries search, the count, the order and Create: what you
          are looking at, how much of it there is, how it is arranged, and how to
          add to it, all on one line. */}
      <div className="cg-dashboard__tabline">
        <Tabs
          tabs={[
            { id: 'recent', label: 'Recent' },
            { id: 'all', label: 'All' },
            { id: 'folders', label: 'Folders' },
            { id: 'shared', label: 'Shared with me' },
            { id: 'archive', label: 'Archive' },
          ]}
          active={view}
          onChange={(id) => {
            setView(id as 'recent' | 'all' | 'folders' | 'shared' | 'archive');
            // A selection is of cards on screen; a tab away from them ends it.
            setSelected([]);
          }}
        />
        <input
          ref={searchRef}
          className="input cg-dashboard__search"
          type="text"
          placeholder="Search  /"
          aria-label="Search boards"
          data-testid="dashboard-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            // Clear, then hand the keyboard back to the shelf.
            setQuery('');
            e.currentTarget.blur();
          }}
        />
        <div className="spacer" />
        <p className="label cg-dashboard__count">{count}</p>
        {/* Every tab, Recent included. It was hidden there on the reading that
            "Recent" fixes the order at newest-first, which left the control
            missing from the tab the dashboard opens on — so the app looked to
            have no sort at all. The icon and the "Sort" label are the other half
            of that: a bare "Newest ▾" beside a Create button did not read as a
            control you could change. */}
        {/* Not on Shared: that list is other people's boards in the order they
            arrived, and a sort control that changes nothing reads as broken. */}
        {view !== 'shared' && (
          <Button
            variant="ghost"
            className="cg-dashboard__sort"
            data-testid="sort-control"
            title="Change the order"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setSortMenu({ x: rect.right - 160, y: rect.bottom + 6 });
            }}
          >
            <ArrowUpDown size={13} />
            Sort: {SORTS.find((s) => s.id === sort)?.label ?? 'Newest'} ▾
          </Button>
        )}
        {creating ? (
          <input
            className="input cg-dashboard__new"
            autoFocus
            placeholder={`${worlds.find((w) => w.id === creating)?.label ?? 'Board'} name`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void create(draft, creating)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create(draft, creating);
              if (e.key === 'Escape') {
                setCreating(null);
                setDraft('');
              }
            }}
          />
        ) : (
          <Button
            variant="primary"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setNewMenu({ x: rect.right - 160, y: rect.bottom + 6 });
            }}
          >
            Create <Kbd>N</Kbd>
          </Button>
        )}
      </div>

      {/* Folders arrange the same cards the other tabs list — the folder view
          draws the dashboard's own `renderCard`, never one of its own. */}
      {view === 'archive' ? (
        <ArchiveTab query={query} />
      ) : view === 'folders' ? (
        <FoldersTab
          renderCard={(summary) => renderCard(summary, 0, 'folder')}
          query={needle}
          keeps={kept}
          sortBoards={compare}
        />
      ) : view === 'shared' ? (
        shared.length === 0 ? (
          <div className="empty-state">
            <p>Nothing has been shared with you yet.</p>
          </div>
        ) : (
          <div className="cg-dashboard__sections">
            <SharedWithMe bare filter={query} />
          </div>
        )
      ) : summaries.length === 0 ? (
        <div className="empty-state">
          <p>
            No maps yet. Press <Kbd>N</Kbd> or click Create to start mapping.
          </p>
        </div>
      ) : view === 'recent' ? (
        /*
         * Recent reads top-down: what you keep close, what others have handed
         * you, then everything else — each its own section, divided the same
         * way, so the shelf has a shape rather than one long grid. Pinned
         * boards live in their section only; repeating them below said the
         * same thing twice.
         */
        <div className="cg-dashboard__sections">
          {pinned.length > 0 && (
            <section className="cg-dashboard__pinned" data-testid="pinned-row">
              <h2 className="cg-dashboard__grouptitle">
                <Star size={15} /> Pinned
              </h2>
              <div className="cg-board-grid">
                {pinned.map((summary) => renderCard(summary, 0, 'pinned'))}
              </div>
            </section>
          )}
          <SharedWithMe bare filter={query} />
          {(rest.length > 0 || !!needle) && (
            <section data-testid="boards-section">
              <h2 className="cg-dashboard__grouptitle">Recent</h2>
              {rest.length === 0 ? (
                <p className="cg-dashboard__nomatch muted">Nothing matches “{query.trim()}”.</p>
              ) : (
                <div className="cg-board-grid">{rest.map((summary) => renderCard(summary))}</div>
              )}
            </section>
          )}
        </div>
      ) : shown.length === 0 ? (
        <p className="cg-dashboard__nomatch muted">Nothing matches “{query.trim()}”.</p>
      ) : (
        <div className="cg-board-grid">{shown.map((summary) => renderCard(summary))}</div>
      )}

      {/*
        * The selection gestures, said once and quietly. Nothing on a card
        * advertises that it can be picked rather than opened, and a modifier is
        * not a thing anyone tries on a hunch. It stands down while a selection
        * is up — by then you know, and the toolbar is where the eye should be.
        */}
      {/* Not on Shared: those cards are other people's boards and cannot be
          picked up by a selection that acts on your own. */}
      {!selectMode && summaries.length > 0 && view !== 'shared' && (
        <p className="cg-dashboard__hint label" data-testid="selection-hint">
          <Kbd>⌘</Kbd> click to select
        </p>
      )}

      {/* Off by default; a Super Admin's own preference, not the app's shape (§3). */}
      {adminOn && user?.isSuperAdmin && <AdminPanel />}

      {selectMode && (
        <div className="cg-selection" role="toolbar" aria-label="Selection actions" data-testid="selection-bar">
          <Chip>
            {selected.length} selected
          </Chip>
          <Button
            disabled={folders.length === 0}
            title={folders.length === 0 ? 'No folders yet' : undefined}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              // Upwards: the bar sits at the foot of the window, so a menu hung
              // below it would be clamped back over the button that opened it.
              setMoveMenu({ x: rect.left, y: rect.top - 12 - (folders.length + 1) * 32 - 24 });
            }}
          >
            Move to folder
          </Button>
          <Button onClick={() => void bulkFavorite()}>Favorite</Button>
          <Button
            variant="danger"
            onClick={() => {
              // One board is the action you already have; more than one is worth
              // asking about, because nothing here can put them back (§5).
              if (selected.length > 1) setConfirmArchive(true);
              else void bulkArchive();
            }}
          >
            Archive
          </Button>
          <Button variant="ghost" onClick={() => setSelected([])}>
            Cancel
          </Button>
        </div>
      )}

      {moveMenu && (
        <Menu anchor={moveMenu} onClose={() => setMoveMenu(null)}>
          <div className="label chrome-menu-label">Move to folder</div>
          {folders.map((folder) => (
            <MenuItem
              key={folder.id}
              onClick={() => {
                setMoveMenu(null);
                bulkMove(folder.id);
              }}
            >
              {folder.name}
            </MenuItem>
          ))}
          <MenuItem
            onClick={() => {
              setMoveMenu(null);
              bulkMove(null);
            }}
          >
            Unfiled
          </MenuItem>
        </Menu>
      )}

      {confirmArchive && (
        <Modal
          title="Archive boards"
          width={420}
          onClose={() => setConfirmArchive(false)}
          footer={
            <>
              <div className="spacer" />
              <Button onClick={() => setConfirmArchive(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => void bulkArchive()}>
                Archive {selected.length} boards
              </Button>
            </>
          }
        >
          <p className="cg-dashboard__confirm">
            {selected.length} boards leave Recent, All, Folders and search. Nothing is lost — they
            move to the <strong>Archive</strong> tab, where you can restore any of them.
          </p>
        </Modal>
      )}

      {sortMenu && (
        <Menu anchor={sortMenu} onClose={() => setSortMenu(null)}>
          {SORTS.map((option) => (
            <MenuItem
              key={option.id}
              onClick={() => {
                setSort(option.id);
                setSortMenu(null);
              }}
            >
              {option.id === sort ? `✓ ${option.label}` : option.label}
            </MenuItem>
          ))}
        </Menu>
      )}

      {newMenu && (
        <Menu anchor={newMenu} onClose={() => setNewMenu(null)}>
          {worlds.map((world) => (
            <MenuItem
              key={world.id}
              onClick={() => {
                setNewMenu(null);
                setCreating(world.id);
              }}
            >
              New {world.label}
            </MenuItem>
          ))}
          {/* The Create button splits in this tab rather than being replaced (§2). */}
          {view === 'folders' && (
            <>
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  setNewMenu(null);
                  setNewFolder(true);
                }}
              >
                New folder
              </MenuItem>
            </>
          )}
        </Menu>
      )}

      {newFolder && <NewFolderDialog onClose={() => setNewFolder(false)} />}

      {menu && (
        <Menu anchor={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)}>
          <MenuItem
            onClick={() => {
              navigate(routes.board(menu.id));
              setMenu(null);
            }}
          >
            Open
          </MenuItem>
          <MenuItem
            onClick={() => {
              // The card the menu was opened from, not every card for this board.
              setRenaming(menu.card);
              setMenu(null);
            }}
          >
            Rename
          </MenuItem>
          {/* The same toggle as the corner star, for the keyboard path (§3). */}
          {menuBoard && (
            <MenuItem
              onClick={() => {
                void setFavorite([menuBoard.id], !menuBoard.favorite);
                setMenu(null);
              }}
            >
              {menuBoard.favorite ? 'Remove star' : 'Star board'}
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              void act(menu.id, 'duplicate');
              setMenu(null);
            }}
          >
            Duplicate
          </MenuItem>
          <MenuItem
            onClick={() => {
              setSharing(menu.id);
              setMenu(null);
            }}
          >
            Share…
          </MenuItem>
          {/* Filing, from any tab (§2). The section knows to say nothing for a
              sub-board, which is filed by its parent and never on its own. */}
          {menuBoard && <MoveToFolderItems board={menuBoard} onDone={() => setMenu(null)} />}
          <MenuSeparator />
          <MenuItem
            danger
            onClick={() => {
              void act(menu.id, 'archive');
              setMenu(null);
            }}
          >
            Archive
          </MenuItem>
        </Menu>
      )}

      {sharing && (
        <ShareDialog
          boardId={sharing}
          boardName={summaries.find((s) => s.id === sharing)?.name ?? sharing}
          onClose={() => {
            setSharing(null);
            // Sharing or revoking in there changes the mark out here.
            void loadShared();
          }}
        />
      )}
    </div>
  );
}
