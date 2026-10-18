/**
 * Folders, client side (v1.8 §2). Organisation metadata and nothing else: no
 * directory moves, and no board is ever hidden — Recent and All keep listing
 * everything, foldered or not (§1).
 *
 * Two rules shape most of what follows. Membership is read off
 * `BoardSummary.folderId`, which the server merges during the scan, so a card
 * and the file can never disagree about where a board lives. And a sub-board is
 * never filed on its own: it is inside a folder because its root board is, which
 * is why a folder lists roots and counts descendants.
 *
 * The board card is deliberately not reimplemented here. The dashboard hands its
 * own `renderCard` in, so a folder's contents are the same cards as All — same
 * rename, same menu, same strip — and there is exactly one board card in the
 * codebase.
 */
import React, { useMemo, useState } from 'react';
import { Folder as FolderGlyph, Inbox } from 'lucide-react';
import type { BoardSummary, Folder } from '@cartograph/shared';
import { useStore } from '@/shared/store';
import { navigate, routes, useRoute } from '@/shared/router';
import { isTypingTarget } from '@/shared/hooks';
import { Button, InlineEdit, Menu, MenuItem, MenuSeparator, Modal, StatusStrip } from '@/shared/ui';
import { ColorSwatches } from '@/shared/ui/ColorSwatches';
import './folders.css';

/**
 * Our own type rather than `text/plain`: `dragover` may only read `types`, never
 * the payload, so the question "is this one of my board cards" has to be
 * answerable from the type alone — otherwise a file dragged in from the desktop
 * lights up every folder.
 */
export const BOARD_MIME = 'application/x-cartograph-board';

/** The Unfiled pseudo-folder's drop key. It is not a folder and has no id. */
const UNFILED = 'unfiled';

/** An uncoloured folder is not a colourless one — it wears the neutral inset. */
const NEUTRAL = '--bg-inset';

/**
 * What makes a board card draggable onto a folder card (§2). A sub-board gets
 * nothing: it follows its parent, and offering to file it separately would
 * promise something the model cannot store (§1).
 */
export function boardDragProps(summary: BoardSummary): {
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLElement>;
} {
  if (summary.parentBoard) return {};
  return {
    draggable: true,
    onDragStart: (event) => {
      // Renaming in place is a text drag inside a draggable card; let it be one.
      if (isTypingTarget(event.target)) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData(BOARD_MIME, summary.id);
      event.dataTransfer.effectAllowed = 'move';
    },
  };
}

/**
 * The "Move to folder" section for a board card's context menu (§2), in every
 * tab. `Menu` has no submenu and is not getting one for this — a labelled
 * section says the same thing with the keyboard path already working.
 */
export function MoveToFolderItems({
  board,
  onDone,
}: {
  board: BoardSummary;
  onDone: () => void;
}) {
  const folders = useStore((s) => s.folders);
  const assignBoards = useStore((s) => s.assignBoards);

  // Sub-boards are filed by their parent (§1); with no folders there is nowhere
  // to move anything, and "Unfiled" alone would be a menu about nothing.
  if (board.parentBoard || folders.length === 0) return null;

  const move = (folderId: string | null) => {
    onDone();
    // The action writes the file, refreshes the summaries and raises the undo
    // toast — this is a menu, not a second implementation of assignment.
    void assignBoards([board.id], folderId);
  };

  return (
    <>
      <MenuSeparator />
      <div className="label chrome-menu-label">Move to folder</div>
      {folders
        .filter((folder) => folder.id !== board.folderId)
        .map((folder) => (
          <MenuItem key={folder.id} onClick={() => move(folder.id)}>
            {folder.name}
          </MenuItem>
        ))}
      {board.folderId && <MenuItem onClick={() => move(null)}>Unfiled</MenuItem>}
    </>
  );
}

/** Name and colour together, because a folder is easier to make than to find. */
export function NewFolderDialog({ onClose }: { onClose: () => void }) {
  const config = useStore((s) => s.config);
  const createFolder = useStore((s) => s.createFolder);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | undefined>(undefined);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onClose();
    void createFolder(trimmed, color);
  };

  return (
    <Modal title="New folder" width={380} onClose={onClose}>
      <form className="cg-folders__form" onSubmit={submit}>
        <label className="cg-folders__field">
          <span className="label">Name</span>
          <input
            className="input"
            autoFocus
            autoComplete="off"
            placeholder="Client Work"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {config && (
          <div className="cg-folders__field">
            <span className="label">Colour</span>
            <ColorSwatches
              colors={config.colors}
              selected={color}
              onPick={(token) => setColor(token === '--node-clear' ? undefined : token)}
              labelPrefix="Folder colour "
            />
          </div>
        )}
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Create folder
        </Button>
      </form>
    </Modal>
  );
}

/**
 * What a folder holds. `roots` is what it lists — the boards assigned to it —
 * while `total` and `counts` include their descendants, because a sub-board is
 * in the folder whether or not it is shown as an entry of its own (§1).
 */
interface Bucket {
  roots: BoardSummary[];
  total: number;
  counts: Record<string, number>;
}

const emptyBucket = (): Bucket => ({ roots: [], total: 0, counts: {} });

function ConfirmDelete({
  folder,
  boards,
  onCancel,
  onConfirm,
}: {
  folder: Folder;
  boards: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      title="Delete folder"
      width={420}
      onClose={onCancel}
      footer={
        <>
          <div className="spacer" />
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>
            Delete folder
          </Button>
        </>
      }
    >
      {/* Say what happens, not what is being confirmed: a folder is a mapping,
          and deleting one has never touched a board (§2). */}
      <p className="cg-folders__confirm">
        <strong>{folder.name}</strong> is only a way of arranging boards. Deleting it deletes no
        boards and moves nothing on disk —{' '}
        {boards === 0
          ? 'it holds none.'
          : `the ${boards} board${boards === 1 ? '' : 's'} inside ${
              boards === 1 ? 'it returns' : 'it return'
            } to Unfiled.`}
      </p>
    </Modal>
  );
}

export function FoldersTab({
  renderCard,
  query,
  keeps,
  sortBoards,
}: {
  /** The dashboard's own card — the only board card there is. */
  renderCard: (summary: BoardSummary) => React.ReactNode;
  /** The dashboard's search, trimmed and lower-cased; '' when it is off (§4). */
  query: string;
  /** Whether a board survives that search — a match takes its parent with it. */
  keeps: (summary: BoardSummary) => boolean;
  /** The chosen order. It governs a folder's contents as well as All (§4). */
  sortBoards: (a: BoardSummary, b: BoardSummary) => number;
}) {
  const summaries = useStore((s) => s.summaries);
  const folders = useStore((s) => s.folders);
  const config = useStore((s) => s.config);
  const assignBoards = useStore((s) => s.assignBoards);
  const renameFolder = useStore((s) => s.renameFolder);
  const recolorFolder = useStore((s) => s.recolorFolder);
  const deleteFolder = useStore((s) => s.deleteFolder);

  /*
   * Which folder is open: a folder id, `UNFILED` for the tray, or null for
   * none — and null is where the tab starts.
   *
   * `null` used to mean the Unfiled tray, which made it impossible to express
   * "nothing is open" and meant arriving on this tab immediately opened
   * something the person had not asked for. The shelf is the thing you came to
   * look at; contents belong to a folder you chose.
   *
   * It lives in the URL (`/folders/:id`) rather than here, so opening a folder
   * is somewhere the back button can return to — including after a trip into
   * one of its boards.
   */
  const route = useRoute();
  const openId = route.name === 'dashboard' && route.tab === 'folders' ? route.folderId : null;
  const setOpenId = (next: string | null | ((current: string | null) => string | null)) => {
    const value = typeof next === 'function' ? next(openId) : next;
    navigate(routes.folder(value));
  };
  /** Which card a drag is currently over, by folder id or `UNFILED`. */
  const [dropId, setDropId] = useState<string | null>(null);
  /*
   * The card's ⋯ menu and its delete confirmation, both keyed on a folder id
   * rather than on the open folder: recolouring and deleting live on the card
   * now, which is reachable without opening anything.
   */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { byFolder, unfiled } = useMemo(() => {
    const childrenOf = new Map<string, BoardSummary[]>();
    for (const summary of summaries) {
      if (!summary.parentBoard) continue;
      const list = childrenOf.get(summary.parentBoard) ?? [];
      list.push(summary);
      childrenOf.set(summary.parentBoard, list);
    }
    // Same rule the dashboard uses: a board whose parent is not on the shelf
    // stands on its own, or an orphan would be filed nowhere at all.
    const known = new Set(summaries.map((s) => s.id));
    const live = new Set(folders.map((f) => f.id));

    const add = (bucket: Bucket, summary: BoardSummary, seen: Set<string>) => {
      if (seen.has(summary.id)) return;
      seen.add(summary.id);
      bucket.total += 1;
      for (const [status, value] of Object.entries(summary.statusCounts ?? {})) {
        bucket.counts[status] = (bucket.counts[status] ?? 0) + value;
      }
      for (const child of childrenOf.get(summary.id) ?? []) add(bucket, child, seen);
    };

    const buckets = new Map<string, Bucket>(folders.map((f) => [f.id, emptyBucket()]));
    const loose = emptyBucket();

    for (const summary of summaries) {
      if (summary.parentBoard && known.has(summary.parentBoard)) continue;
      // An assignment naming a folder that is gone reads as unfiled; the server
      // prunes the file, and the shelf must not wait for the next read to agree.
      const bucket =
        (summary.folderId && live.has(summary.folderId) ? buckets.get(summary.folderId) : null) ??
        loose;
      bucket.roots.push(summary);
      add(bucket, summary, new Set());
    }

    for (const bucket of [...buckets.values(), loose]) bucket.roots.sort(sortBoards);

    return { byFolder: buckets, unfiled: loose };
  }, [summaries, folders, sortBoards]);

  const open = folders.find((f) => f.id === openId) ?? null;
  const openBucket = (open && byFolder.get(open.id)) ?? emptyBucket();
  /** Resolved rather than stored, so a rename lands in the menu that is up. */
  const menuFolder = menu ? folders.find((f) => f.id === menu.id) : undefined;
  const confirmFolder = confirmId ? folders.find((f) => f.id === confirmId) : undefined;

  /*
   * The search reaches folder names as well as board names (§4), and the two
   * answers differ: a folder named for what you typed is itself the result, so
   * it opens with everything it holds, while any other folder shows only the
   * boards that matched. Without that a search for a folder's name would find
   * the folder and then show it empty.
   */
  const named = (folder: Folder) => query !== '' && folder.name.toLowerCase().includes(query);
  const contents = (folder: Folder | null, bucket: Bucket) =>
    !query || (folder && named(folder)) ? bucket.roots : bucket.roots.filter(keeps);

  const shownFolders = folders.filter(
    (folder) => !query || named(folder) || (byFolder.get(folder.id)?.roots ?? []).some(keeps),
  );
  const shownUnfiled = contents(null, unfiled);
  const openRoots = contents(open, openBucket);

  const over = (event: React.DragEvent, key: string) => {
    if (!event.dataTransfer.types.includes(BOARD_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropId !== key) setDropId(key);
  };

  const drop = (event: React.DragEvent, folderId: string | null) => {
    event.preventDefault();
    setDropId(null);
    const boardId = event.dataTransfer.getData(BOARD_MIME);
    if (!boardId) return;
    void assignBoards([boardId], folderId);
  };

  const card = (
    key: string,
    folder: Folder | null,
    bucket: Bucket,
    onOpen: () => void,
  ) => {
    const active = folder ? openId === folder.id : openId === UNFILED;
    const classes = [
      'cg-board-card',
      'cg-folder-card',
      folder ? '' : 'cg-folder-card--unfiled',
      dropId === key ? 'cg-folder-card--drop' : '',
      active ? 'cg-folder-card--open' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <article
        key={key}
        className={classes}
        data-testid={folder ? 'folder-card' : 'unfiled-card'}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        onDragOver={(e) => over(e, key)}
        onDragLeave={() => setDropId((current) => (current === key ? null : current))}
        onDrop={(e) => drop(e, folder ? folder.id : null)}
      >
        <div className="cg-board-card__head">
          <span
            className="cg-folder-card__glyph"
            style={{ background: `var(${folder?.color ?? NEUTRAL})` }}
            aria-hidden
          >
            {folder ? <FolderGlyph size={15} /> : <Inbox size={15} />}
          </span>
          <div className="cg-board-card__title">
            <span className="cg-board-card__name">{folder ? folder.name : 'Unfiled'}</span>
          </div>
          <div className="spacer" />
          {/* Same corner, same glyph and same hover as a board card's menu —
              Unfiled has none, because it is a tally rather than a folder and
              there is nothing to recolour or delete. */}
          {folder && (
            <button
              type="button"
              className="cg-board-card__more"
              aria-label={`Actions for ${folder.name}`}
              // The card opens the folder on click and on Enter; a control
              // inside it must do neither. Only Enter: stopping every key kept
              // Escape from the menu it opens.
              onKeyDown={(e) => e.key === 'Enter' && e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMenu({ id: folder.id, x: rect.right - 200, y: rect.bottom + 6 });
              }}
            >
              ⋯
            </button>
          )}
        </div>
        <div className="cg-board-card__meta mono">
          <span>
            {bucket.total} board{bucket.total === 1 ? '' : 's'}
          </span>
        </div>
        {/* The signature element at a fourth scale (§2): every status in the
            folder, descendants included, summed into one bar. */}
        {config && <StatusStrip counts={bucket.counts} statuses={config.statuses} height={4} />}
      </article>
    );
  };

  return (
    <section className="cg-folders" data-testid="folders-tab">
      {(shownFolders.length > 0 || shownUnfiled.length > 0) && (
        <div className="cg-board-grid">
          {shownFolders.map((folder) =>
            card(folder.id, folder, byFolder.get(folder.id) ?? emptyBucket(), () =>
              setOpenId(folder.id),
            ),
          )}
          {/* Last, and only when there is something in it (§2). It is a
              destination and a tally, never a folder: nothing renames,
              recolours or deletes it. */}
          {shownUnfiled.length > 0 && card(UNFILED, null, unfiled, () => setOpenId(UNFILED))}
        </div>
      )}

      {/* A search that matches nothing would otherwise leave the tab blank with
          no explanation — every other tab says so, and silence reads as broken. */}
      {folders.length > 0 && query !== '' && shownFolders.length === 0 && shownUnfiled.length === 0 && (
        <p className="cg-folders__empty muted">Nothing here matches your search.</p>
      )}

      {/* Said with an Unfiled card already on screen as well as without one:
          with no folder to file anything into, the tab is otherwise a dead end. */}
      {folders.length === 0 && (
        <p className="cg-folders__empty muted">
          No folders yet. Create → New folder, then drag a board onto it or file it from a
          card’s ⋯ menu.
        </p>
      )}

      {open ? (
        <div className="cg-folders__open" data-testid="folder-open">
          <div className="cg-folders__head">
            <nav className="cg-folders__crumbs" aria-label="Breadcrumb">
              <button type="button" className="cg-folders__crumb" onClick={() => setOpenId(null)}>
                Folders
              </button>
              <span className="cg-folders__slash">/</span>
              <InlineEdit
                className="cg-folders__name"
                value={open.name}
                ariaLabel="Rename folder"
                onCommit={(next) => void renameFolder(open.id, next)}
              />
            </nav>
            <div className="spacer" />
            {/* Colour and delete are the card's ⋯ menu now, not this header —
                one place for them, and reachable without opening the folder.
                Renaming stays here because the breadcrumb is where the name is. */}
          </div>

          {openRoots.length === 0 ? (
            <p className="cg-folders__empty muted">
              {query && openBucket.roots.length > 0
                ? 'Nothing in this folder matches your search.'
                : 'Nothing filed here yet — drag a board onto the folder, or use a card’s ⋯ menu.'}
            </p>
          ) : (
            <div className="cg-board-grid">{openRoots.map((summary) => renderCard(summary))}</div>
          )}
        </div>
      ) : openId === UNFILED ? (
        // What has not been filed, shown only once the tray is chosen — it is a
        // destination like any other card here, not the default view.
        shownUnfiled.length > 0 && (
          <div className="cg-folders__open" data-testid="folder-open">
            <div className="cg-folders__head">
              {/* The same crumb the folder view has, so there is a way back to
                  the shelf from here too rather than only from a real folder. */}
              <nav className="cg-folders__crumbs" aria-label="Breadcrumb">
                <button type="button" className="cg-folders__crumb" onClick={() => setOpenId(null)}>
                  Folders
                </button>
                <span className="cg-folders__slash">/</span>
                <span className="cg-folders__name">Unfiled</span>
              </nav>
            </div>
            <div className="cg-board-grid">{shownUnfiled.map((summary) => renderCard(summary))}</div>
          </div>
        )
      ) : null}

      {menuFolder && menu && (
        <Menu anchor={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)}>
          {/* The swatch row rather than a submenu: `Menu` has none, and picking
              a colour is a thing you do by looking, not by reading a list. It
              writes on click and leaves the menu up, so trying two is one
              gesture. */}
          {config && (
            <>
              <div className="label chrome-menu-label">Colour</div>
              <div className="cg-folders__menu-colors">
                <ColorSwatches
                  colors={config.colors}
                  selected={menuFolder.color}
                  labelPrefix="Folder colour "
                  onPick={(token) =>
                    void recolorFolder(menuFolder.id, token === '--node-clear' ? undefined : token)
                  }
                />
              </div>
              <MenuSeparator />
            </>
          )}
          <MenuItem
            danger
            onClick={() => {
              setMenu(null);
              setConfirmId(menuFolder.id);
            }}
          >
            Delete folder
          </MenuItem>
        </Menu>
      )}

      {confirmFolder && (
        <ConfirmDelete
          folder={confirmFolder}
          boards={byFolder.get(confirmFolder.id)?.total ?? 0}
          onCancel={() => setConfirmId(null)}
          onConfirm={() => {
            const id = confirmFolder.id;
            setConfirmId(null);
            // Only close the shelf if the folder being deleted is the open one.
            setOpenId((current) => (current === id ? null : current));
            void deleteFolder(id);
          }}
        />
      )}
    </section>
  );
}
