/**
 * Where things go when nobody said where (v1.7 §5).
 *
 * Everything that reaches the canvas from a person carries coordinates: they
 * clicked somewhere. An agent describing a process has none to offer, and the
 * old default — every node at the origin — produces a board that has to be
 * untangled by hand before it can be read at all. So a position-less node is
 * *placed* rather than defaulted, below whatever is already on the board, which
 * is also what keeps an agent run from landing on top of existing work.
 *
 * This is presentation arithmetic and nothing more. It reads `board.json`'s
 * geometry, knows no world, and holds no opinion about which nodes belong
 * together — that is the author's job, and the frame's.
 */
import type { Board, BoardNode } from '@cartograph/shared';
import { DEFAULT_NODE_SIZE } from '@cartograph/shared';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Nodes and frames both; texts have no size and would only skew the box. */
function boxesOf(board: Board): Box[] {
  return [
    ...board.nodes.map((node) => ({
      ...node.position,
      ...(node.size ?? DEFAULT_NODE_SIZE),
    })),
    ...board.frames.map((frame) => ({ ...frame.position, ...frame.size })),
  ];
}

function bounds(boxes: Box[]): Bounds | null {
  // Guarded rather than relying on Math.min([]) — it returns Infinity, which
  // propagates into a position and lands the node nowhere at all.
  if (!boxes.length) return null;
  return {
    minX: Math.min(...boxes.map((b) => b.x)),
    minY: Math.min(...boxes.map((b) => b.y)),
    maxX: Math.max(...boxes.map((b) => b.x + b.width)),
    maxY: Math.max(...boxes.map((b) => b.y + b.height)),
  };
}

export function boardBounds(board: Board): Bounds | null {
  return bounds(boxesOf(board));
}

export function nodeBounds(nodes: readonly BoardNode[]): Bounds | null {
  return bounds(nodes.map((node) => ({ ...node.position, ...(node.size ?? DEFAULT_NODE_SIZE) })));
}

const COLUMNS = 4;
const GAP = { x: 64, y: 56 };
/** Clear of the last row, so a second agent run reads as a second block. */
const BLOCK_GAP = 96;

/**
 * A cursor that hands out the next free slot each time it is called. Stateful on
 * purpose: a batch of twenty nodes has to lay itself out as it goes, and the
 * board it is being appended to does not change underneath it while the lock is
 * held.
 */
export function gridPlacer(board: Board): (size?: { width: number; height: number }) => {
  x: number;
  y: number;
} {
  const box = boardBounds(board);
  const originX = box ? box.minX : 0;
  const originY = box ? box.maxY + BLOCK_GAP : 0;
  let n = 0;

  return (size) => {
    const width = size?.width ?? DEFAULT_NODE_SIZE.width;
    const height = size?.height ?? DEFAULT_NODE_SIZE.height;
    const column = n % COLUMNS;
    const row = Math.floor(n / COLUMNS);
    n += 1;
    return {
      x: Math.round(originX + column * (width + GAP.x)),
      y: Math.round(originY + row * (height + GAP.y)),
    };
  };
}

/** Room for the frame's title bar, which is drawn inside its own box. */
const FRAME_PADDING = 44;
const FRAME_HEADER = 28;
const EMPTY_FRAME_SIZE = { width: 480, height: 320 };

/**
 * A box that encloses the nodes it is given. A frame that did not contain its
 * own members would be corrected by the canvas the moment anybody dragged
 * anything, because membership there is decided by containment.
 */
export function frameAround(
  board: Board,
  members: readonly BoardNode[],
): { position: { x: number; y: number }; size: { width: number; height: number } } {
  const box = nodeBounds(members);
  if (!box) {
    const origin = gridPlacer(board)(EMPTY_FRAME_SIZE);
    return { position: origin, size: { ...EMPTY_FRAME_SIZE } };
  }
  return {
    position: {
      x: Math.round(box.minX - FRAME_PADDING),
      y: Math.round(box.minY - FRAME_PADDING - FRAME_HEADER),
    },
    size: {
      width: Math.round(box.maxX - box.minX + FRAME_PADDING * 2),
      height: Math.round(box.maxY - box.minY + FRAME_PADDING * 2 + FRAME_HEADER),
    },
  };
}

// ---- arranging what is already there (v1.10) ----

/**
 * Laying out a selection, as one instruction rather than a coordinate per node.
 *
 * The reason this exists is not tidiness. An agent asked to arrange a board had
 * to compute every x and y itself, which is slow, and slow in the worst way —
 * arithmetic reasoned about token by token, where a single slip puts a card on
 * top of another. Naming a shape instead moves that work to where it is cheap
 * and exact.
 *
 * It is also most of the fix for edges that run underneath cards. Nothing here
 * routes an edge; `flow` simply puts connected nodes in adjacent layers with a
 * clear lane between them, and an edge with nothing in its way does not need
 * routing. The layouts that ignore edges make no such promise.
 *
 * Pure: it takes geometry and gives back geometry. No board is read or written
 * here, and nothing in this file knows what a workspace is.
 */
export type LayoutName = 'flow' | 'grid' | 'row' | 'column' | 'circle' | 'align' | 'distribute';

export type AlignEdge = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';

export interface ArrangeOptions {
  layout: LayoutName;
  /** `flow` only: which way the process runs. */
  direction?: 'right' | 'down';
  /** `grid` only. Defaults to something squarish for the count. */
  columns?: number;
  /** Space between boxes, not between centres. */
  gap?: { x?: number; y?: number };
  /** `align` only. */
  align?: AlignEdge;
  /** `distribute` only: the axis gaps are equalised along. */
  axis?: 'x' | 'y';
}

export interface LayoutInput {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface LayoutEdge {
  source: string;
  target: string;
}

const DEFAULT_GAP = { x: 72, y: 64 };

const sizeOf = (n: LayoutInput) => n.size ?? DEFAULT_NODE_SIZE;

/**
 * Longest-path layering, then one barycentre pass per layer.
 *
 * Longest path rather than breadth-first because a node belongs *after*
 * everything that feeds it: with breadth-first, a step reachable both directly
 * and through a detour lands in the early layer and draws an edge leaping over
 * the ones between. The barycentre pass then orders each layer by the average
 * position of what points into it, which is the cheap standard way to take most
 * of the crossings out — it is not optimal, and optimal is NP-hard.
 *
 * Cycles cannot be layered at all, so the relaxation is capped: a back edge
 * stops raising its target once every node has had a chance to move, and the
 * cycle simply reads as a loop back through the layers, which is what it is.
 */
function layersOf(nodes: readonly LayoutInput[], edges: readonly LayoutEdge[]): string[][] {
  const ids = new Set(nodes.map((n) => n.id));
  const inside = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);

  const depth = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let moved = false;
    for (const edge of inside) {
      const next = depth.get(edge.source)! + 1;
      if (next > depth.get(edge.target)!) {
        depth.set(edge.target, next);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const byLayer: string[][] = [];
  // Input order decides the starting order within a layer, which for a run of
  // freshly created nodes is the order they were written — usually the order a
  // person would read them.
  for (const node of nodes) {
    const d = depth.get(node.id)!;
    (byLayer[d] ??= []).push(node.id);
  }
  const layers = byLayer.filter(Boolean);

  const predecessors = new Map<string, string[]>();
  for (const edge of inside) {
    const list = predecessors.get(edge.target);
    if (list) list.push(edge.source);
    else predecessors.set(edge.target, [edge.source]);
  }

  for (let i = 1; i < layers.length; i += 1) {
    const above = new Map(layers[i - 1].map((id, index) => [id, index]));
    const score = (id: string) => {
      const preds = (predecessors.get(id) ?? []).map((p) => above.get(p)).filter((v) => v !== undefined);
      if (!preds.length) return Number.MAX_SAFE_INTEGER; // unattached: keep it at the end
      return preds.reduce((a, b) => a + b!, 0) / preds.length;
    };
    const keyed = layers[i].map((id, index) => ({ id, index, score: score(id) }));
    // Stable: equal scores keep their existing order rather than shuffling.
    keyed.sort((a, b) => a.score - b.score || a.index - b.index);
    layers[i] = keyed.map((k) => k.id);
  }

  return layers;
}

/** Stacks one layer across the minor axis, centred on the widest layer. */
function stack(
  ids: readonly string[],
  byId: Map<string, LayoutInput>,
  minorGap: number,
  horizontal: boolean,
): { extent: number; offsets: Map<string, number> } {
  const offsets = new Map<string, number>();
  let cursor = 0;
  for (const id of ids) {
    const size = sizeOf(byId.get(id)!);
    offsets.set(id, cursor);
    cursor += (horizontal ? size.height : size.width) + minorGap;
  }
  return { extent: Math.max(0, cursor - minorGap), offsets };
}

/**
 * Where each named node should end up. Only the nodes given are placed; the rest
 * of the board is untouched, and the group keeps the top-left corner it already
 * occupied so arranging never teleports a selection somewhere off screen.
 */
export function arrange(
  nodes: readonly LayoutInput[],
  edges: readonly LayoutEdge[],
  options: ArrangeOptions,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (!nodes.length) return out;

  const gapX = options.gap?.x ?? DEFAULT_GAP.x;
  const gapY = options.gap?.y ?? DEFAULT_GAP.y;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const box = bounds(nodes.map((n) => ({ ...n.position, ...sizeOf(n) })))!;
  const originX = box.minX;
  const originY = box.minY;

  switch (options.layout) {
    case 'align': {
      const edge = options.align ?? 'left';
      for (const node of nodes) {
        const size = sizeOf(node);
        const { x, y } = node.position;
        out.set(node.id, {
          x:
            edge === 'left' ? originX
            : edge === 'right' ? box.maxX - size.width
            : edge === 'centerX' ? (box.minX + box.maxX) / 2 - size.width / 2
            : x,
          y:
            edge === 'top' ? originY
            : edge === 'bottom' ? box.maxY - size.height
            : edge === 'centerY' ? (box.minY + box.maxY) / 2 - size.height / 2
            : y,
        });
      }
      return round(out);
    }

    case 'distribute': {
      // Equal gaps between boxes, order taken from where things already are —
      // distributing is a tidy-up, and reordering would make it a rearrangement.
      const axis = options.axis ?? 'x';
      const sorted = [...nodes].sort((a, b) =>
        axis === 'x' ? a.position.x - b.position.x : a.position.y - b.position.y,
      );
      const total = sorted.reduce(
        (sum, n) => sum + (axis === 'x' ? sizeOf(n).width : sizeOf(n).height),
        0,
      );
      const span = axis === 'x' ? box.maxX - box.minX : box.maxY - box.minY;
      const gap = sorted.length > 1 ? (span - total) / (sorted.length - 1) : 0;
      let cursor = axis === 'x' ? box.minX : box.minY;
      for (const node of sorted) {
        const size = sizeOf(node);
        out.set(node.id, {
          x: axis === 'x' ? cursor : node.position.x,
          y: axis === 'y' ? cursor : node.position.y,
        });
        cursor += (axis === 'x' ? size.width : size.height) + gap;
      }
      return round(out);
    }

    case 'circle': {
      // Big enough that neighbours do not touch: the circumference has to hold
      // every box plus a gap, and the radius follows from that.
      const perimeter = nodes.reduce((sum, n) => sum + sizeOf(n).width + gapX, 0);
      const radius = Math.max(perimeter / (2 * Math.PI), 120);
      const cx = originX + radius;
      const cy = originY + radius;
      nodes.forEach((node, i) => {
        const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
        const size = sizeOf(node);
        out.set(node.id, {
          x: cx + radius * Math.cos(angle) - size.width / 2,
          y: cy + radius * Math.sin(angle) - size.height / 2,
        });
      });
      return round(out);
    }

    case 'row':
    case 'column': {
      const horizontal = options.layout === 'row';
      let cursor = horizontal ? originX : originY;
      for (const node of nodes) {
        const size = sizeOf(node);
        out.set(node.id, {
          x: horizontal ? cursor : originX,
          y: horizontal ? originY : cursor,
        });
        cursor += (horizontal ? size.width + gapX : size.height + gapY);
      }
      return round(out);
    }

    case 'grid': {
      const columns = Math.max(1, Math.min(options.columns ?? Math.ceil(Math.sqrt(nodes.length)), nodes.length));
      const rows = Math.ceil(nodes.length / columns);
      // Column widths and row heights from the widest and tallest in each, so a
      // grid of mixed sizes still lines up on both axes.
      const colWidth = Array.from({ length: columns }, (_, c) =>
        Math.max(...nodes.filter((_, i) => i % columns === c).map((n) => sizeOf(n).width)),
      );
      const rowHeight = Array.from({ length: rows }, (_, r) =>
        Math.max(...nodes.slice(r * columns, r * columns + columns).map((n) => sizeOf(n).height)),
      );
      nodes.forEach((node, i) => {
        const c = i % columns;
        const r = Math.floor(i / columns);
        const x = originX + colWidth.slice(0, c).reduce((a, b) => a + b + gapX, 0);
        const y = originY + rowHeight.slice(0, r).reduce((a, b) => a + b + gapY, 0);
        out.set(node.id, { x, y });
      });
      return round(out);
    }

    case 'flow':
    default: {
      const horizontal = (options.direction ?? 'right') === 'right';
      const layers = layersOf(nodes, edges);
      const stacks = layers.map((ids) => stack(ids, byId, horizontal ? gapY : gapX, horizontal));
      const widest = Math.max(...stacks.map((s) => s.extent));

      let major = horizontal ? originX : originY;
      layers.forEach((ids, i) => {
        const { extent, offsets } = stacks[i];
        // Each layer centred against the widest, so a three-node layer sits in
        // the middle of a five-node one rather than hugging the top edge.
        const minorStart = (horizontal ? originY : originX) + (widest - extent) / 2;
        const thickness = Math.max(
          ...ids.map((id) => (horizontal ? sizeOf(byId.get(id)!).width : sizeOf(byId.get(id)!).height)),
        );
        for (const id of ids) {
          const minor = minorStart + offsets.get(id)!;
          out.set(id, horizontal ? { x: major, y: minor } : { x: minor, y: major });
        }
        major += thickness + (horizontal ? gapX : gapY);
      });
      return round(out);
    }
  }
}

/** Whole units, for the same reason `moveNodes` rounds: fractions never line up. */
function round(map: Map<string, { x: number; y: number }>): Map<string, { x: number; y: number }> {
  for (const [id, p] of map) map.set(id, { x: Math.round(p.x), y: Math.round(p.y) });
  return map;
}
