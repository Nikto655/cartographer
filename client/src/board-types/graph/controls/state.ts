/**
 * Controls state (v1.5 §3.2).
 *
 * These are a lens, not content. board.json says what exists; how hard you were
 * pushing the dots apart and whether you had orphans hidden is yours, not the
 * board's — so it lives in localStorage, per board, and never touches the
 * server. That also settles two things by construction: an open graph can never
 * sit "Unsaved" because you moved a slider, and no slider tick can start a save.
 * The persist itself is debounced, so a drag writes once when it stops.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { readLocal, useDebouncedCallback, writeLocal } from '@/shared/hooks';
import { FORCE_DEFAULTS } from '../simulation';
import type { ColorGroup } from '../grouping';

export interface GraphControls {
  repel: number;
  linkDistance: number;
  centre: number;
  labels: boolean;
  orphans: boolean;
  drawnEdges: boolean;
  derivedLinks: boolean;
  edgeLabels: boolean;
  /** Dims everything it doesn't match. Deliberately not remembered (below). */
  filter: string;
  group: ColorGroup;
  collapsed: boolean;
}

export const CONTROL_DEFAULTS: GraphControls = {
  ...FORCE_DEFAULTS,
  labels: true,
  orphans: true,
  drawnEdges: true,
  derivedLinks: true,
  edgeLabels: true,
  filter: '',
  group: 'color',
  collapsed: false,
};

const PERSIST_MS = 400;

const storageKey = (boardId: string) => `cartograph.graphControls.${boardId}`;

/** A filter is a question you were asking, not a setting — it never comes back. */
function load(boardId: string): GraphControls {
  return { ...CONTROL_DEFAULTS, ...readLocal(storageKey(boardId), {}), filter: '' };
}

export function useGraphControls(
  boardId: string,
): [GraphControls, (patch: Partial<GraphControls>) => void] {
  const [controls, setControls] = useState<GraphControls>(() => load(boardId));
  const board = useRef(boardId);

  const [persist] = useDebouncedCallback((next: GraphControls) => {
    writeLocal(storageKey(board.current), { ...next, filter: '' });
  }, PERSIST_MS);

  // The canvas stays mounted across boards, so the lens has to follow the board.
  useEffect(() => {
    if (board.current === boardId) return;
    board.current = boardId;
    setControls(load(boardId));
  }, [boardId]);

  const update = useCallback(
    (patch: Partial<GraphControls>) =>
      setControls((current) => {
        const next = { ...current, ...patch };
        persist(next);
        return next;
      }),
    [persist],
  );

  return [controls, update];
}
