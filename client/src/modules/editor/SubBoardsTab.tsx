import { useMemo, useState } from 'react';
import { ArrowUpRight, Link2, Plus, Unlink, X } from 'lucide-react';
import type { BoardSummary } from '@cartograph/shared';
import { api } from '@/shared/api';
import { resolveBoardType } from '@/board-types';
import { isCard, useStore } from '@/shared/store';
import { boardHref, navigate } from '@/shared/router';
import { createSubBoard, NewSubBoardMenu } from '@/shared/subBoards';
import { Button, Modal, StatusStrip } from '@/shared/ui';
import { toast } from '@/shared/ui/toast';
import { relativeTime } from '@/shared/hooks';

/** The world a board belongs to, said in one quiet mark (§3.4). */
function WorldMark({ summary }: { summary: BoardSummary }) {
  const world = resolveBoardType(summary.boardType);
  return (
    <span className="cg-subboard__world" title={world.label}>
      <world.Icon size={13} />
    </span>
  );
}

/** Sub-boards attached to this node: create, link an existing one, unlink or delete. */
export function SubBoardsTab({
  nodeId,
  title,
  readOnly,
}: {
  nodeId: string;
  title: string;
  /** Viewing someone else's tree (v1.6 §5): the list stays, the wiring goes. */
  readOnly: boolean;
}) {
  const board = useStore((s) => s.board);
  const config = useStore((s) => s.config);
  const summaries = useStore((s) => s.summaries);
  const loadSummaries = useStore((s) => s.loadSummaries);
  const linkSubBoard = useStore((s) => s.linkSubBoard);
  const unlinkSubBoard = useStore((s) => s.unlinkSubBoard);
  const node = useStore((s) => {
    const found = s.nodes.find((n) => n.id === nodeId);
    return found && isCard(found) ? found : undefined;
  });

  const [linking, setLinking] = useState(false);
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState<BoardSummary | null>(null);
  const [busy, setBusy] = useState(false);
  /** Where the Map-or-Graph choice opens; null when nothing is being made (§3.1). */
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);

  const childIds = useMemo(() => node?.data.childBoards ?? [], [node]);

  const children = useMemo(
    () =>
      childIds.map(
        (id) =>
          summaries.find((s) => s.id === id) ?? {
            id,
            name: id,
            boardType: 'map' as const,
            nodeCount: 0,
            statusCounts: {},
            updatedAt: '',
          },
      ),
    [childIds, summaries],
  );

  /** Anything that isn't this board, already linked here, or an ancestor of it. */
  const candidates = useMemo(() => {
    if (!board) return [];
    const ancestors = new Set<string>([board.id]);
    let cursor = board.parentBoard;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      ancestors.add(cursor);
      cursor = summaries.find((s) => s.id === cursor)?.parentBoard;
    }
    const q = query.trim().toLowerCase();
    return summaries
      .filter((s) => !ancestors.has(s.id) && !childIds.includes(s.id))
      .filter((s) => !q || s.name.toLowerCase().includes(q));
  }, [board, summaries, childIds, query]);

  if (!board || !node) return null;

  // No save first: leaving a board flushes it (`openBoard` in the store).
  const open = (id: string) => {
    // Stays inside whichever workspace this board came from.
    navigate(boardHref(id));
  };

  const create = async (world: Parameters<typeof createSubBoard>[1]) => {
    setBusy(true);
    const childId = await createSubBoard(nodeId, world, childIds.length ? `${title} detail` : title);
    setBusy(false);
    if (childId) await loadSummaries();
  };

  const remove = async (summary: BoardSummary, mode: 'unlink' | 'delete') => {
    setRemoving(null);
    if (mode === 'unlink') {
      await unlinkSubBoard(nodeId, summary.id);
      return;
    }
    try {
      // Reopening this board below rereads it from disk, so what the canvas
      // has not saved yet must be there first.
      await useStore.getState().saveNow();
      await api.archiveBoard(summary.id);
      await useStore.getState().openBoard(board.id);
      toast('Sub-board deleted · files moved to /data/archive');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <div className="cg-subboards">
      <section className="cg-settings__section">
        <div className="cg-overview__head">
          <span className="label">Linked sub-boards</span>
          <span className="cg-data__count mono">{children.length}</span>
        </div>

        {children.length === 0 ? (
          <p className="cg-data__empty muted">
            {readOnly
              ? 'No sub-boards.'
              : "None yet. A sub-board is where this node's detail lives — a map to lay it out, or a graph to see how it connects."}
          </p>
        ) : (
          <ul className="cg-subboards__list">
            {children.map((summary) => (
              <li key={summary.id} className="cg-subboard">
                <button type="button" className="cg-subboard__main" onClick={() => void open(summary.id)}>
                  <span className="cg-subboard__name">
                    <WorldMark summary={summary} />
                    {summary.name}
                  </span>
                  <span className="cg-subboard__meta mono">
                    {summary.nodeCount} node{summary.nodeCount === 1 ? '' : 's'}
                    {summary.updatedAt && ` · ${relativeTime(summary.updatedAt)}`}
                  </span>
                  {config && (
                    <span className="cg-subboard__strip">
                      <StatusStrip counts={summary.statusCounts} statuses={config.statuses} height={3} />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="cg-subboard__action"
                  onClick={() => void open(summary.id)}
                  aria-label="Open sub-board"
                  title="Open"
                >
                  <ArrowUpRight size={15} />
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    className="cg-subboard__action cg-subboard__action--danger"
                    onClick={() => setRemoving(summary)}
                    aria-label="Remove sub-board"
                    title="Unlink or delete"
                  >
                    <X size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!readOnly && (
          <div className="cg-settings__actions">
            <Button
              disabled={busy}
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setNewMenu({ x: rect.left, y: rect.bottom + 6 });
              }}
            >
              <Plus size={14} /> New sub-board
            </Button>
            <Button onClick={() => setLinking(true)}>
              <Link2 size={14} /> Link existing
            </Button>
          </div>
        )}
      </section>

      {newMenu && (
        <NewSubBoardMenu
          anchor={newMenu}
          onClose={() => setNewMenu(null)}
          onPick={(world) => void create(world)}
        />
      )}

      {linking && (
        <Modal
          title="Link an existing board"
          onClose={() => {
            setLinking(false);
            setQuery('');
          }}
          width={520}
        >
          <input
            className="input"
            autoFocus
            placeholder="Search boards…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="cg-subboards__list cg-subboards__list--picker">
            {candidates.map((summary) => (
              <li key={summary.id} className="cg-subboard">
                <button
                  type="button"
                  className="cg-subboard__main"
                  onClick={async () => {
                    setLinking(false);
                    setQuery('');
                    await linkSubBoard(nodeId, summary.id);
                  }}
                >
                  <span className="cg-subboard__name">
                    <WorldMark summary={summary} />
                    {summary.name}
                  </span>
                  <span className="cg-subboard__meta mono">
                    {summary.nodeCount} node{summary.nodeCount === 1 ? '' : 's'}
                    {summary.parentBoard && ' · currently a sub-board'}
                  </span>
                </button>
              </li>
            ))}
            {!candidates.length && <p className="cg-data__empty muted">No boards available to link.</p>}
          </ul>
          <p className="cg-data__empty muted">
            Either kind can hang under this node. Linking moves the board here — a board has one
            parent, so it leaves its current one.
          </p>
        </Modal>
      )}

      {removing && (
        <Modal
          title={`Remove “${removing.name}”?`}
          onClose={() => setRemoving(null)}
          width={520}
          footer={
            <>
              <Button onClick={() => setRemoving(null)}>Cancel</Button>
              <div className="spacer" />
              <Button onClick={() => void remove(removing, 'unlink')}>
                <Unlink size={14} /> Unlink only
              </Button>
              <Button variant="danger" onClick={() => void remove(removing, 'delete')}>
                Delete sub-board
              </Button>
            </>
          }
        >
          <p className="muted" style={{ marginTop: 0 }}>
            <strong>Unlink</strong> keeps the board — it detaches from this node and returns to the
            dashboard as a top-level board.
          </p>
          <p className="muted">
            <strong>Delete</strong> archives the whole board, its {removing.nodeCount} node
            {removing.nodeCount === 1 ? '' : 's'} and their files to <span className="mono">/data/archive</span>.
            Nothing is erased from disk, but it leaves the app.
          </p>
        </Modal>
      )}
    </div>
  );
}
