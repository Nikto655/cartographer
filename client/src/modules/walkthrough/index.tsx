import { useCallback, useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import { safeHtml } from '@/shared/safeHtml';
import type { NodeContent } from '@cartograph/shared';
import { api } from '@/shared/api';
import { isCard, useStore } from '@/shared/store';
import { navigate, routes } from '@/shared/router';
import { Button, Kbd } from '@/shared/ui';
import { useOverlay } from '@/shared/overlay';
import './walkthrough.css';

interface Step {
  boardId: string;
  nodeId: string;
  title: string;
}

interface WalkOption {
  nodeId: string;
  title: string;
  label?: string;
}

/**
 * Sequential review (§7.6). Traversal follows outgoing edges; at a branch the
 * walk pauses and the user picks the path.
 */
export function Walkthrough({ startNodeId, onClose }: { startNodeId: string; onClose: () => void }) {
  const board = useStore((s) => s.board);
  // Walkthrough traverses nodes only; frames and texts are not steps.
  const allNodes = useStore((s) => s.nodes);
  const nodes = useMemo(() => allNodes.filter(isCard), [allNodes]);
  const edges = useStore((s) => s.edges);

  const [path, setPath] = useState<Step[]>(() => {
    const node = nodes.find((n) => n.id === startNodeId);
    return node && board ? [{ boardId: board.id, nodeId: node.id, title: node.data.title }] : [];
  });
  const [index, setIndex] = useState(0);
  const [content, setContent] = useState<NodeContent | null>(null);
  const [loading, setLoading] = useState(true);

  const current = path[index];
  const currentNode = current ? nodes.find((n) => n.id === current.nodeId) : undefined;

  const options = useMemo<WalkOption[]>(() => {
    if (!current) return [];
    const out: WalkOption[] = [];
    for (const edge of edges.filter((e) => e.source === current.nodeId)) {
      const target = nodes.find((n) => n.id === edge.target);
      if (!target) continue;
      out.push({
        nodeId: target.id,
        title: target.data.title,
        label: typeof edge.label === 'string' ? edge.label : undefined,
      });
    }
    return out;
  }, [current, edges, nodes]);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setLoading(true);
    api
      .getNode(current.boardId, current.nodeId)
      .then((loaded) => !cancelled && setContent(loaded))
      .catch(() => !cancelled && setContent(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [current]);

  const step = useCallback(
    (nodeId: string) => {
      if (!board) return;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      setPath((p) => [...p.slice(0, index + 1), { boardId: board.id, nodeId, title: node.data.title }]);
      setIndex((i) => i + 1);
    },
    [board, index, nodes],
  );

  const forward = useCallback(() => {
    if (index < path.length - 1) {
      setIndex(index + 1);
      return;
    }
    if (options.length === 1) step(options[0].nodeId);
  }, [index, options, path.length, step]);

  useOverlay();

  /*
   * These keys are the walkthrough's, and nobody else's. Bubbling on `window`
   * they also reached the canvas, which nudged whatever was selected — and the
   * walk starts from the selection, so stepping through a path quietly moved
   * the node it began at and dirtied the board. Capture runs ahead of the
   * canvas and the panel; stopping here means neither hears them.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') forward();
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [forward, onClose]);

  const html = useMemo(() => {
    if (!content?.body.trim()) return '<p class="cg-walk__hint">No notes on this node yet.</p>';
    // Same rule as the panel preview: a walked board may not be yours.
    return safeHtml(marked.parse(content.body, { async: false }) as string);
  }, [content]);

  if (!current) return null;

  return (
    <div className="cg-walk" role="dialog" aria-label="Walkthrough">
      <header className="cg-walk__head">
        <span className="label">Walkthrough</span>
        <div className="cg-walk__dots">
          {path.map((s, i) => (
            <button
              key={`${s.nodeId}-${i}`}
              type="button"
              className={`cg-walk__dot${i === index ? ' is-active' : ''}`}
              onClick={() => setIndex(i)}
              aria-label={s.title}
              title={s.title}
            />
          ))}
        </div>
        <div className="spacer" />
        <span className="label">
          Esc to exit · <Kbd>←</Kbd> <Kbd>→</Kbd> to step
        </span>
        <Button icon variant="ghost" onClick={onClose} aria-label="Exit walkthrough">
          ✕
        </Button>
      </header>

      <div className="cg-walk__body">
        <h1 className="cg-walk__title">{current.title}</h1>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="cg-walk__prose" dangerouslySetInnerHTML={{ __html: html }} />

            {content?.incoming.map((item) => (
              <section className="cg-walk__data" key={item.edgeId}>
                <h2 className="label">
                  Receives from {item.sourceTitle} · {item.snippet.label}{' '}
                  <span className="muted">{item.snippet.lang}</span>
                </h2>
                <pre className="mono">{item.snippet.code}</pre>
              </section>
            ))}
            {content?.data?.snippets.map((snippet) => (
              <section className="cg-walk__data" key={snippet.id}>
                <h2 className="label">
                  {snippet.id === content.data?.outSnippetId ? '⌁ Passes forward · ' : ''}
                  {snippet.label} <span className="muted">{snippet.lang}</span>
                </h2>
                <pre className="mono">{snippet.code}</pre>
              </section>
            ))}
          </>
        )}
      </div>

      <footer className="cg-walk__foot">
        <Button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>
          ← Back
        </Button>

        {(currentNode?.data.childBoards ?? []).map((childId) => (
          <Button
            key={childId}
            variant="primary"
            onClick={() => {
              onClose();
              navigate(routes.board(childId));
            }}
          >
            ▣ Enter sub-map
          </Button>
        ))}

        <div className="spacer" />

        {index < path.length - 1 ? (
          <Button variant="primary" onClick={forward}>
            Next →
          </Button>
        ) : options.length === 0 ? (
          <span className="muted">End of path</span>
        ) : options.length === 1 ? (
          <Button variant="primary" onClick={() => step(options[0].nodeId)}>
            {options[0].label ? `${options[0].label} → ` : 'Next → '}
            {options[0].title}
          </Button>
        ) : (
          <div className="cg-walk__branch">
            <span className="label">Pick a path</span>
            <div className="cg-walk__options">
              {options.map((option) => (
                <button
                  key={option.nodeId}
                  type="button"
                  className="cg-walk__option"
                  onClick={() => step(option.nodeId)}
                >
                  {option.label && <span className="label">{option.label}</span>}
                  <span>{option.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}
