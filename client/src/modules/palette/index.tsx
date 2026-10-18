import { useEffect, useMemo, useRef, useState } from 'react';
import { isCard, useStore } from '@/shared/store';
import { navigate, routes } from '@/shared/router';
import { Kbd } from '@/shared/ui';
import { useOverlay } from '@/shared/overlay';
import './palette.css';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  keys?: string[];
  run: () => void;
}

interface Item {
  id: string;
  label: string;
  group: 'Nodes' | 'Maps' | 'Commands';
  hint?: string;
  keys?: string[];
  run: () => void;
}

/** Subsequence match — "pysc" finds "Payment Screen". */
function score(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0;
  let hits = 0;
  let streak = 0;
  let best = 0;
  for (const char of q) {
    const found = t.indexOf(char, ti);
    if (found === -1) return null;
    streak = found === ti ? streak + 1 : 1;
    best = Math.max(best, streak);
    hits += 1;
    ti = found + 1;
  }
  return hits * 2 + best * 3 - t.length * 0.01;
}

export function CommandPalette({
  commands,
  onClose,
  onSelectNode,
}: {
  commands: Command[];
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const allNodes = useStore((s) => s.nodes);
  const nodes = useMemo(() => allNodes.filter(isCard), [allNodes]);
  const summaries = useStore((s) => s.summaries);
  const board = useStore((s) => s.board);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useOverlay();

  const items = useMemo<Item[]>(() => {
    const nodeItems: Item[] = nodes.map((node) => ({
      id: `node:${node.id}`,
      label: node.data.title,
      group: 'Nodes',
      hint: board?.name,
      run: () => {
        onSelectNode(node.id);
        onClose();
      },
    }));
    const boardItems: Item[] = summaries.map((summary) => ({
      id: `board:${summary.id}`,
      label: summary.name,
      group: 'Maps',
      hint: `${summary.nodeCount} nodes`,
      run: () => {
        navigate(routes.board(summary.id));
        onClose();
      },
    }));
    const commandItems: Item[] = commands.map((command) => ({
      id: `cmd:${command.id}`,
      label: command.label,
      group: 'Commands',
      hint: command.hint,
      keys: command.keys,
      run: () => {
        command.run();
        onClose();
      },
    }));
    return [...commandItems, ...nodeItems, ...boardItems];
  }, [nodes, summaries, commands, board, onClose, onSelectNode]);

  const results = useMemo(() => {
    if (!query.trim()) return items.slice(0, 40);
    return items
      .map((item) => ({ item, s: score(query.trim(), item.label) }))
      .filter((r): r is { item: Item; s: number } => r.s !== null)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((r) => r.item);
  }, [items, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((a) => Math.min(a + 1, results.length - 1));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        results[active]?.run();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [results, active, onClose]);

  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let lastGroup = '';

  return (
    <div className="cg-palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cg-palette" role="dialog" aria-label="Command palette">
        <input
          className="cg-palette__input"
          autoFocus
          placeholder="Jump to a node, a map, or run a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="cg-palette__list" ref={listRef}>
          {results.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && <div className="cg-palette__group label">{header}</div>}
                <button
                  type="button"
                  className={`cg-palette__item${index === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => item.run()}
                >
                  <span className="cg-palette__label">{item.label}</span>
                  {item.hint && <span className="cg-palette__hint">{item.hint}</span>}
                  {item.keys?.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </button>
              </div>
            );
          })}
          {!results.length && <p className="cg-palette__empty muted">No matches.</p>}
        </div>
      </div>
    </div>
  );
}
