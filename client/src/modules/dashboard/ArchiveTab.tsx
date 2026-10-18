/**
 * The Archive tab (v1.9) — boards their owner took off the shelf.
 *
 * Rows rather than the board cards the other tabs draw, and deliberately so: a
 * card is a thing you open, and nothing here can be opened. What matters about
 * an archived board is its name, how much is in it, and the two things you can
 * do to it, which is a list.
 *
 * "Delete" here reads as permanent and is not, quite: the board moves out of
 * this workspace's view and the files stay under `deleted/`, where only a Super
 * Admin can see or finally remove them. That gap is deliberate — it is a safety
 * net for the operator, not a feature for the person clicking the button, and
 * the copy deliberately does not mention it. Nothing reachable from this
 * account can bring the board back, so "deleted" is what it means here.
 */
import { useCallback, useEffect, useState } from 'react';
import { Archive, RotateCcw, Trash2 } from 'lucide-react';
import type { ShelvedBoard } from '@cartograph/shared';
import { api } from '@/shared/api';
import { useStore } from '@/shared/store';
import { navigate, routes } from '@/shared/router';
import { relativeTime } from '@/shared/hooks';
import { Button, Modal } from '@/shared/ui';
import { toast } from '@/shared/ui/toast';

function ConfirmDelete({
  board,
  onCancel,
  onConfirm,
}: {
  board: ShelvedBoard;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      title="Delete from Archive"
      width={440}
      onClose={onCancel}
      footer={
        <>
          <div className="spacer" />
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </>
      }
    >
      {/*
        * Reads as a permanent delete, and that is a deliberate product choice
        * rather than an oversight. The files are in fact retained under
        * `deleted/` where an administrator can still see them — but from this
        * side of the app the board is gone, and *this person* cannot get it
        * back by any means available to them, which is what the sentence has to
        * convey. Offering "an admin might still have it" would invite people to
        * treat delete as reversible and go asking, which is the opposite of
        * what the retention is for.
        *
        * The retention is documented in OPERATIONS and DECISIONS, so whoever
        * runs the instance knows what is actually on disk. Do not soften this
        * copy to match it.
        */}
      <p className="cg-archive__confirm">
        <strong>{board.name}</strong> and everything in it — nodes, notes and snapshots — will be
        deleted. This cannot be undone.
      </p>
    </Modal>
  );
}

export function ArchiveTab({ query }: { query: string }) {
  const [boards, setBoards] = useState<ShelvedBoard[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ShelvedBoard | null>(null);
  const loadSummaries = useStore((s) => s.loadSummaries);

  const load = useCallback(async () => {
    try {
      setBoards(await api.listArchived());
    } catch (err) {
      toast((err as Error).message);
      setBoards([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (board: ShelvedBoard) => {
    setBusy(board.entry);
    try {
      const back = await api.restoreArchived(board.entry);
      await load();
      // The shelf gained a board; the other tabs are reading a stale list.
      await loadSummaries();
      toast(`“${back.name}” restored`, { label: 'Open', run: () => navigate(routes.board(back.id)) });
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (board: ShelvedBoard) => {
    setConfirming(null);
    setBusy(board.entry);
    try {
      await api.deleteArchived(board.entry);
      await load();
      // No Undo, and none is possible from here: nothing in this account's API
      // surface reads `deleted/`. A button that cannot do what it says is worse
      // than no button.
      toast(`“${board.name}” deleted`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (boards === null) return <p className="cg-archive__empty muted">Reading the archive…</p>;

  const needle = query.trim().toLowerCase();
  const shown = needle ? boards.filter((b) => b.name.toLowerCase().includes(needle)) : boards;

  if (boards.length === 0) {
    return (
      <p className="cg-archive__empty muted">
        Nothing archived. Archiving a board from its ⋯ menu puts it here, where you can put it
        back.
      </p>
    );
  }

  return (
    <section className="cg-archive" data-testid="archive-tab">
      <p className="cg-archive__note muted">
        Archived boards keep everything — nodes, notes and snapshots. Most recently archived
        first. Restore puts one back on the shelf.
      </p>
      {shown.length === 0 ? (
        <p className="cg-archive__empty muted">Nothing archived matches “{query.trim()}”.</p>
      ) : (
        <ul className="cg-archive__list">
          {shown.map((board) => (
            <li key={board.entry} className="cg-archive__row" data-archive-entry={board.entry}>
              <span className="cg-archive__glyph" aria-hidden>
                <Archive size={14} />
              </span>
              <span className="cg-archive__name">{board.name}</span>
              {/* When it was archived, not when it was last edited — on this
                  page that is what the reader is asking, and a board untouched
                  for a year but archived this morning belongs at the top. Said
                  in words because a bare timestamp beside a node count reads as
                  "last edited" by convention. */}
              <span className="cg-archive__meta mono">
                {board.nodeCount} node{board.nodeCount === 1 ? '' : 's'} · archived{' '}
                {relativeTime(board.shelvedAt)}
              </span>
              <div className="spacer" />
              <Button
                variant="ghost"
                disabled={busy === board.entry}
                onClick={() => void restore(board)}
              >
                <RotateCcw size={13} /> Restore
              </Button>
              <Button
                variant="ghost"
                className="cg-archive__delete"
                disabled={busy === board.entry}
                aria-label={`Delete ${board.name}`}
                onClick={() => setConfirming(board)}
              >
                <Trash2 size={13} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <ConfirmDelete
          board={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void remove(confirming)}
        />
      )}
    </section>
  );
}
