import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  Copy,
  Download,
  MoreHorizontal,
  PanelRight,
  Play,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { BoardSummary, SnapshotInfo } from '@cartograph/shared';
import { api } from '@/shared/api';
import { isKnownBoardType } from '@/board-types';
import { useStore } from '@/shared/store';
import { boardHref, navigate, routes, useRoute } from '@/shared/router';
import { ShareDialog } from '@/modules/share';
import { InlineEdit, Menu, MenuItem, MenuSeparator, Tooltip } from '@/shared/ui';
import { toast } from '@/shared/ui/toast';
import './chrome.css';

function SaveDot() {
  const status = useStore((s) => s.saveStatus);
  const label =
    status === 'saving'
      ? 'Saving'
      : status === 'error'
        ? 'Offline — retrying'
        : status === 'conflict'
          ? 'Not saved'
          : status === 'dirty'
            ? 'Unsaved'
            : 'Saved';
  return (
    <span className={`save-dot save-dot--${status}`} title={label}>
      <span className="save-dot__mark" />
      {label}
    </span>
  );
}

/** Top-left: back chevron + breadcrumb trail + inline-renamable board title (§5.1). */
function BoardPill({ summaries, readOnly }: { summaries: BoardSummary[]; readOnly: boolean }) {
  const route = useRoute();
  const board = useStore((s) => s.board);
  const shared = useStore((s) => s.shared);
  const openBoard = useStore((s) => s.openBoard);
  const loadSummaries = useStore((s) => s.loadSummaries);
  const saveNow = useStore((s) => s.saveNow);
  const ownerId = route.name === 'board' ? route.ownerId : null;
  if (!board) return null;

  const trail: BoardSummary[] = [];
  let cursor = summaries.find((s) => s.id === board.parentBoard);
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id);
    trail.unshift(cursor);
    cursor = summaries.find((s) => s.id === cursor?.parentBoard);
  }

  // No save first: leaving a board flushes it (`openBoard`/`closeBoard` in the store).
  const go = (to: string) => navigate(to);

  const parent = trail[trail.length - 1];
  // Which share brought us here, for the label only. Admin View matches nothing
  // and stays the anonymous "Read-only", which is honest: no one shared it.
  const ownerName = shared.find(
    (s) => s.ownerId === ownerId && board && s.boardIds.includes(board.id),
  )?.ownerName;

  return (
    <div className="pill crumb-pill">
      <Tooltip label={parent ? `Back to ${parent.name}` : 'Back to dashboard'}>
        <button
          type="button"
          className="pill__btn"
          onClick={() => void go(parent ? boardHref(parent.id) : routes.dashboard())}
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </button>
      </Tooltip>

      <div className="crumb-pill__trail">
        <button type="button" className="crumb" onClick={() => void go(routes.dashboard())}>
          Dashboard
        </button>
        {trail.map((crumb) => (
          <span key={crumb.id} className="crumb-pill__trail">
            <span className="crumb__sep">/</span>
            <button type="button" className="crumb" onClick={() => void go(boardHref(crumb.id))}>
              {crumb.name}
            </button>
          </span>
        ))}
        <span className="crumb__sep">/</span>
        {/* A name you cannot change is a label, not a field (§5). */}
        {readOnly ? (
          <span className="crumb crumb--current">{board.name}</span>
        ) : (
          <InlineEdit
            className="crumb crumb--current"
            value={board.name}
            ariaLabel="Board name"
            onCommit={async (next) => {
              try {
                // Renaming can re-slug the board, and a save still owed to the
                // old id would have nowhere to land.
                await saveNow();
                const updated = await api.renameBoard(board.id, next);
                await loadSummaries();
                if (updated.id !== board.id) navigate(routes.board(updated.id), true);
                await openBoard(updated.id);
              } catch (err) {
                toast((err as Error).message);
              }
            }}
          />
        )}
      </div>

      {/* Where a copied tree came from (§5). A note about the board's history,
          with nothing behind it: the copy is wholly yours. */}
      {board.duplicatedFrom && (
        <span
          className="crumb__fallback"
          data-testid="duplicated-from"
          title={`Copied from ${board.duplicatedFrom.ownerName}’s “${board.duplicatedFrom.boardName}” on ${board.duplicatedFrom.date}`}
        >
          copy · {board.duplicatedFrom.ownerName}
        </span>
      )}

      {/* A world we don't have yet still opens — as a map, said quietly rather than as an error. */}
      {!isKnownBoardType(board.boardType) && (
        <span className="crumb__fallback mono" title={`No “${board.boardType}” world yet · shown as a map`}>
          {board.boardType}
        </span>
      )}

      <span className="pill__sep" />
      {/* Nothing is ever saved from here, so there is no save state to report.
          Whose board it is belongs here too: it is a fact about the thing named
          to its left, not a control, and it was being said twice when it had a
          banner of its own. */}
      {readOnly ? (
        <span className="save-dot save-dot--readonly">
          Read-only{ownerName ? ` · ${ownerName}’s board` : ''}
        </span>
      ) : (
        <SaveDot />
      )}
    </div>
  );
}

/**
 * Shown when the server refused a save because the board changed elsewhere.
 *
 * A banner rather than a modal, and deliberately not dismissible: the person
 * needs the canvas reachable to rescue what is only in this tab, so nothing may
 * cover it — but the warning must not be something you can wave away and then
 * keep editing into a copy that can never be written.
 *
 * It does not offer to reload for you. Reloading is what discards the unsaved
 * half, so it is the one action that should cost a deliberate click of the
 * browser's own button rather than one of ours sitting under a stray return key.
 */
function ConflictBanner() {
  const status = useStore((s) => s.saveStatus);
  const ref = useRef<HTMLDivElement>(null);

  /*
   * Publish the banner's height so the chrome can sit below it. Measured rather
   * than assumed: the text wraps, so it is four lines on a wide window and ten
   * on a narrow one, and any constant is wrong at some width — a guessed 96px
   * left the board pill 23px underneath it.
   */
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty('--conflict-height');
      return;
    }
    const publish = () => root.style.setProperty('--conflict-height', `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--conflict-height');
    };
  }, [status]);

  if (status !== 'conflict') return null;
  return (
    <div className="cg-conflict" role="alert" ref={ref}>
      <strong className="cg-conflict__title">This board changed somewhere else.</strong>{' '}
      Your last edits were <strong>not saved</strong> and cannot be — an agent or another tab
      wrote to it while you had it open.
      <ul className="cg-conflict__list">
        <li>
          <strong>Nodes you created are safe.</strong> They were saved as you made them and will
          still be here.
        </li>
        <li>
          <strong>Links, frames, text and anything you moved</strong> since are not. Note them
          down or screenshot them now.
        </li>
      </ul>
      Then reload the page to pick up what changed.
    </div>
  );
}

/**
 * The two things to do with somebody else's board that are not reading it: see
 * it as it is now, and take a copy. They used to be a pill of their own in the
 * middle of the chrome, which said "Read-only" a second time and put a Leave
 * button beside a Dashboard breadcrumb that already left. They are icons in the
 * actions pill now, where every other verb on this screen lives.
 *
 * **Refresh, as well as live.** A shared view follows the owner's writes over
 * the board's event stream; this re-reads it in place for when that stream has
 * dropped, without the browser reload that would throw away the viewport and
 * the open panel.
 */
function SharedActions() {
  const route = useRoute();
  const board = useStore((s) => s.board);
  const shared = useStore((s) => s.shared);
  const openBoard = useStore((s) => s.openBoard);
  const loadShared = useStore((s) => s.loadShared);
  const [busy, setBusy] = useState(false);

  const ownerId = route.name === 'board' ? route.ownerId : null;
  const share = shared.find((s) => s.ownerId === ownerId && board && s.boardIds.includes(board.id));

  const refresh = async () => {
    if (!board) return;
    setBusy(true);
    try {
      await openBoard(board.id);
      await loadShared();
      toast('Refreshed');
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    if (!share) return;
    setBusy(true);
    try {
      const copy = await api.duplicateShared(share.id);
      toast(`Copied to your workspace · ${copy.name}`);
      navigate(routes.board(copy.id));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip label="Refresh">
        <button
          type="button"
          className="pill__btn"
          data-testid="refresh-shared"
          disabled={busy}
          onClick={() => void refresh()}
          aria-label="Refresh"
        >
          <RefreshCw size={17} />
        </button>
      </Tooltip>
      {share?.canDuplicate && (
        <Tooltip label="Duplicate to my workspace">
          <button
            type="button"
            className="pill__btn"
            data-testid="duplicate-shared"
            disabled={busy}
            onClick={() => void duplicate()}
            aria-label="Duplicate to my workspace"
          >
            <Copy size={17} />
          </button>
        </Tooltip>
      )}
    </>
  );
}

/** Top-right: palette, walkthrough, export, snapshot, editor toggle, board menu. */
function ActionsPill({
  onExport,
  canExport,
  onPalette,
  onWalk,
  canWalk,
  showWalk,
  editorOpen,
  onToggleEditor,
  minimap,
  onToggleMinimap,
  snapToGrid,
  onToggleSnap,
  readOnly,
}: ChromeProps & { editorOpen: boolean; onToggleEditor: () => void }) {
  const board = useStore((s) => s.board);
  const openBoard = useStore((s) => s.openBoard);
  const saveNow = useStore((s) => s.saveNow);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);

  useEffect(() => {
    if (!menu || !board || readOnly) return;
    api
      .listSnapshots(board.id)
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
  }, [menu, board, readOnly]);

  if (!board) return null;

  const takeSnapshot = async () => {
    await saveNow();
    try {
      const snapshot = await api.createSnapshot(board.id);
      toast(`Snapshot saved · ${snapshot.timestamp.slice(11, 16).replace('-', ':')}`);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const restore = async (ts: string) => {
    setMenu(null);
    try {
      // The restore snapshots the current state first; make that the canvas
      // as you left it, not as it was a second ago. Saving after the restore
      // instead would write the old canvas over the one just brought back.
      await saveNow();
      await api.restoreSnapshot(board.id, ts);
      await openBoard(board.id);
      toast('Snapshot restored · previous state snapshotted first');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <>
      <div className="pill">
        {/* Leading the pill, because on somebody else's board they are the only
            two verbs that do anything and the rest read. */}
        {readOnly && <SharedActions />}
        <Tooltip label="Find" keys={['⌘K']}>
          <button type="button" className="pill__btn" onClick={onPalette} aria-label="Command palette">
            <Search size={17} />
          </button>
        </Tooltip>
        {/* A world whose nodes form no path has nothing to walk (§7.5). */}
        {showWalk && (
          <Tooltip label="Walk from selection">
            <button
              type="button"
              className="pill__btn"
              onClick={onWalk}
              disabled={!canWalk}
              aria-label="Walkthrough"
            >
              <Play size={17} />
            </button>
          </Tooltip>
        )}
        {/* Absent, not disabled, when a share withholds it: a greyed button
            invites a question the recipient cannot act on (§5). */}
        {canExport && (
          <Tooltip label="Export" keys={['⌘E']}>
            <button type="button" className="pill__btn" onClick={onExport} aria-label="Export">
              <Download size={17} />
            </button>
          </Tooltip>
        )}
        {/* Taking one writes to the volume; restoring one rewrites it (§5). */}
        {!readOnly && (
          <Tooltip label="Snapshot">
            <button
              type="button"
              className="pill__btn"
              onClick={() => void takeSnapshot()}
              aria-label="Snapshot"
            >
              <Camera size={17} />
            </button>
          </Tooltip>
        )}
        <span className="pill__sep" />
        <Tooltip label={editorOpen ? 'Hide editor' : 'Show editor'}>
          <button
            type="button"
            className={`pill__btn${editorOpen ? ' is-active' : ''}`}
            onClick={onToggleEditor}
            aria-label="Toggle editor"
          >
            <PanelRight size={17} />
          </button>
        </Tooltip>
        <button
          type="button"
          className="pill__btn"
          aria-label="Board menu"
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({ x: rect.right - 190, y: rect.bottom + 8 });
          }}
        >
          <MoreHorizontal size={17} />
        </button>
      </div>

      {menu && (
        <Menu anchor={menu} onClose={() => setMenu(null)}>
          <MenuItem
            onClick={() => {
              onToggleMinimap();
              setMenu(null);
            }}
          >
            {minimap ? 'Hide minimap' : 'Show minimap'}
          </MenuItem>
          <MenuItem
            onClick={() => {
              onToggleSnap();
              setMenu(null);
            }}
          >
            {snapToGrid ? 'Snap to grid: on' : 'Snap to grid: off'}
          </MenuItem>
          {!readOnly && (
            <>
              <MenuSeparator />
              {/* §5's entry point: the board menu, on a board that is yours. */}
              <MenuItem
                onClick={() => {
                  setSharing(true);
                  setMenu(null);
                }}
              >
                Share…
              </MenuItem>
              <MenuSeparator />
              <div className="label chrome-menu-label">Snapshots</div>
              {snapshots.length === 0 && <div className="chrome-menu-empty muted">None yet</div>}
              {snapshots.slice(0, 8).map((snapshot) => (
                <MenuItem key={snapshot.timestamp} onClick={() => void restore(snapshot.timestamp)}>
                  <span className="mono">
                    {snapshot.timestamp.replace('T', ' ').replace(/-(\d\d)-(\d\d)$/, ':$1:$2')}
                  </span>
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
      )}

      {sharing && (
        <ShareDialog boardId={board.id} boardName={board.name} onClose={() => setSharing(false)} />
      )}
    </>
  );
}

export interface ChromeProps {
  onExport: () => void;
  canExport: boolean;
  onPalette: () => void;
  onWalk: () => void;
  canWalk: boolean;
  /** False in a world the walkthrough doesn't apply to — the control isn't shown. */
  showWalk: boolean;
  minimap: boolean;
  onToggleMinimap: () => void;
  snapToGrid: boolean;
  onToggleSnap: () => void;
  /** Somebody else's board (v1.6 §5): every write affordance in the chrome goes. */
  readOnly: boolean;
}

export function Chrome(props: ChromeProps & { editorOpen: boolean; onToggleEditor: () => void }) {
  const summaries = useStore((s) => s.summaries);
  return (
    <>
      {/* Above everything: it is the one thing on screen that says the work in
          front of you is not going to be kept. */}
      <ConflictBanner />
      <div className="chrome-top-left">
        <BoardPill summaries={summaries} readOnly={props.readOnly} />
      </div>
      <div className="chrome-top-right">
        <ActionsPill {...props} />
      </div>
    </>
  );
}
