import { useEffect, useMemo, useState } from 'react';
import { api } from '@/shared/api';
import { isCard, useStore } from '@/shared/store';
import { Button, Modal } from '@/shared/ui';
import { toast } from '@/shared/ui/toast';
import './export.css';

/** Selection → one hand-off markdown doc (§7.7). */
export function ExportDialog({ initialNodeIds, onClose }: { initialNodeIds: string[]; onClose: () => void }) {
  const board = useStore((s) => s.board);
  const allNodes = useStore((s) => s.nodes);
  const nodes = useMemo(() => allNodes.filter(isCard), [allNodes]);
  const edges = useStore((s) => s.edges);

  /**
   * What the selection actually means to an export.
   *
   * `selectedIds` is every selected *canvas* node — cards, frames and text
   * annotations alike — but only a card has a file behind it. Passing a frame's
   * id straight through produced an id the server matched to nothing, so the
   * document came back with no blocks in it: a file containing one newline,
   * which downloads looking blank. Selecting a frame and hitting Export is a
   * completely ordinary thing to do, and on a board built of frames it was the
   * likely thing to do.
   *
   * A selected frame means its contents, exactly as it does for copy and
   * duplicate (v1.6 §6.1). A text annotation means nothing here — it is canvas
   * furniture, not a thing with notes to export.
   */
  const picked = useMemo(() => {
    if (!initialNodeIds.length) return [];
    const chosen = new Set(initialNodeIds);
    const cards = nodes.filter(
      (node) => chosen.has(node.id) || (node.parentId && chosen.has(node.parentId)),
    );
    return cards.map((n) => n.id);
  }, [initialNodeIds, nodes]);

  const ordered = useMemo(() => {
    if (picked.length) return picked;
    // No usable selection → whole board in edge order (roots first).
    const incoming = new Set(edges.map((e) => e.target));
    const visited = new Set<string>();
    const order: string[] = [];
    const walk = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      order.push(id);
      for (const edge of edges.filter((e) => e.source === id)) walk(edge.target);
    };
    for (const node of nodes.filter((n) => !incoming.has(n.id))) walk(node.id);
    for (const node of nodes) walk(node.id);
    return order;
  }, [picked, nodes, edges]);

  const [ids, setIds] = useState<string[]>(ordered);
  const [descend, setDescend] = useState(false);
  const [preview, setPreview] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.data.title ?? id;

  useEffect(() => {
    if (!board || !ids.length) {
      setPreview('');
      return;
    }
    let cancelled = false;
    setBusy(true);
    api
      .exportPath(board.id, { nodeIds: ids, descend })
      .then((result) => !cancelled && setPreview(result.markdown))
      .catch((err) => !cancelled && toast((err as Error).message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [board, ids, descend]);

  const move = (index: number, delta: number) => {
    const next = [...ids];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setIds(next);
  };

  const ready = preview.trim().length > 0;

  const download = () => {
    if (!board) return;
    const blob = new Blob([preview], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${board.id}.md`;
    link.click();
    URL.revokeObjectURL(url);
    toast('Export downloaded');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preview);
      toast('Copied to clipboard');
    } catch {
      toast('Clipboard blocked — use Download');
    }
  };

  return (
    <Modal
      title="Export path"
      onClose={onClose}
      width={820}
      footer={
        <>
          <label className="cg-export__toggle">
            <input type="checkbox" checked={descend} onChange={(e) => setDescend(e.target.checked)} />
            Descend into sub-boards
          </label>
          <div className="spacer" />
          <Button onClick={() => void copy()} disabled={!ready}>
            Copy to clipboard
          </Button>
          <Button variant="primary" onClick={download} disabled={!ready}>
            Download .md
          </Button>
        </>
      }
    >
      <div className="cg-export">
        <ol className="cg-export__list">
          {ids.map((id, index) => (
            <li key={id} className="cg-export__item">
              <span className="mono cg-export__index">{String(index + 1).padStart(2, '0')}</span>
              <span className="cg-export__title">{titleOf(id)}</span>
              <button type="button" onClick={() => move(index, -1)} aria-label="Move up">
                ↑
              </button>
              <button type="button" onClick={() => move(index, 1)} aria-label="Move down">
                ↓
              </button>
              <button
                type="button"
                onClick={() => setIds(ids.filter((x) => x !== id))}
                aria-label="Remove from export"
              >
                ✕
              </button>
            </li>
          ))}
          {!ids.length && <p className="muted">Nothing selected.</p>}
        </ol>

        <pre className={`cg-export__preview mono${busy ? ' is-busy' : ''}`}>
          {ready || busy ? preview : 'Nothing to export — these nodes have no content on this board.'}
        </pre>
      </div>
    </Modal>
  );
}
