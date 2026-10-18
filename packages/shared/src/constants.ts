import type { AppConfig, BoardType, NodeShape } from './types.js';

export const DEFAULT_NODE_SIZE = { width: 184, height: 76 };
export const MIN_NODE_SIZE = { width: 120, height: 56 };

export const SHAPES: NodeShape[] = ['rect', 'rounded', 'ellipse', 'diamond', 'pill'];

export const DEFAULT_CONFIG: AppConfig = {
  statuses: [
    { id: 'sketched', label: 'Sketched', colorToken: '--status-sketched' },
    { id: 'documented', label: 'Documented', colorToken: '--status-documented' },
    { id: 'built', label: 'Built', colorToken: '--status-built' },
  ],
  shapes: SHAPES,
  colors: [
    // Transparent is also what an unset colour renders as, so the two are the
    // same thing and the swatch shows as chosen either way.
    { id: 'clear', label: 'Transparent', token: '--node-clear' },
    { id: 'paper', label: 'White', token: '--node-paper' },
    { id: 'slate', label: 'Slate', token: '--node-slate' },
    { id: 'sky', label: 'Sky', token: '--node-sky' },
    { id: 'aqua', label: 'Aqua', token: '--node-aqua' },
    { id: 'mint', label: 'Mint', token: '--node-mint' },
    { id: 'lemon', label: 'Lemon', token: '--node-lemon' },
    { id: 'peach', label: 'Peach', token: '--node-peach' },
    { id: 'blush', label: 'Blush', token: '--node-blush' },
    { id: 'lilac', label: 'Lilac', token: '--node-lilac' },
  ],
  theme: 'light',
};

export const DEFAULT_STATUS = DEFAULT_CONFIG.statuses[0].id;
export const DEFAULT_SHAPE: NodeShape = 'rect';

export const DEFAULT_BOARD_TYPE: BoardType = 'map';

/** Each world's default node type — what a node without a `type` is (v1.5 §2.2). */
export const DEFAULT_NODE_TYPES: Record<BoardType, string> = {
  map: 'classic',
  graph: 'entity',
};

/** Stored JSON is never trusted: anything but a known world reads as a map. */
export function asBoardType(value: unknown): BoardType {
  return value === 'graph' ? 'graph' : DEFAULT_BOARD_TYPE;
}

export function defaultNodeType(boardType: unknown): string {
  return DEFAULT_NODE_TYPES[asBoardType(boardType)];
}

/** Debounce windows from the autosave contract (§5). */
export const AUTOSAVE_GRAPH_MS = 1000;
export const AUTOSAVE_BODY_MS = 800;
