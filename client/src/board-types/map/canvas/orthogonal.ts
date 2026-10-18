import { Position } from '@xyflow/react';

/**
 * Right-angle routing for connectors, with a grip on every bend and no fence
 * around any of them.
 *
 * React Flow's `getSmoothStepPath` is the obvious tool and it is not enough: its
 * `stepPosition` moves the middle segment only when both ends leave on the same
 * axis, and perpendicular faces return the same fixed elbow for every value.
 *
 * Two rules hold this together.
 *
 * **A face is approached from outside its card.** A connector arriving at a left
 * face comes from the left and travels rightward into it, always. That is why
 * every route below starts and ends with a standoff point: whatever the bends
 * do, the first segment leaves along the source's normal and the last arrives
 * against the target's. Drag a bend somewhere absurd and the line will doubles
 * back to get there — but it never enters a card to reach its own endpoint.
 *
 * **A bend is an offset, not a fraction.** Each value in `bends` is measured in
 * flow units from the source anchor, along the axis that bend slides on. Offsets
 * have no ends to be clamped against, so a bend can go anywhere on the canvas;
 * a fraction of the run would have had to be re-derived every time either card
 * moved, and would have been wrong in between.
 */
export interface OrthogonalParams {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  /**
   * One offset per bend, in the order the connector meets them, measured from
   * the source anchor along each bend's own axis. Missing or short means "use
   * the tidy default for the rest", so an untouched connector keeps its plainest
   * shape and a connector with one bend moved keeps the defaults for the others.
   */
  bends?: number[];
}

/**
 * How far a connector stands off a face before it is free to turn.
 *
 * As short as it can be: the length of the arrowhead itself, so the last
 * straight run *is* the arrow and the turn happens the moment it ends. The
 * marker is 16 wide over a 20-unit viewBox with its back edge at -5, drawn in
 * stroke widths — 16/20 × 5 × 1.75 — which is where the 7 comes from. Any
 * positive number keeps the face rule; this is the smallest that does not put
 * a corner inside the arrow.
 */
const STANDOFF = 7;

interface Vec {
  x: number;
  y: number;
}

/** A bend the person can take hold of: where it sits and which way it slides. */
export interface Bend {
  at: Vec;
  axis: 'x' | 'y';
}

export interface OrthogonalRoute {
  path: string;
  bends: Bend[];
}

/** The direction a face points: the way a connector must leave, or arrive against. */
const normalOf = (position: Position): Vec =>
  position === Position.Left
    ? { x: -1, y: 0 }
    : position === Position.Right
      ? { x: 1, y: 0 }
      : position === Position.Top
        ? { x: 0, y: -1 }
        : { x: 0, y: 1 };

/**
 * How far out of true two facing ends may be and still be drawn as one straight
 * line. A left face's anchor sits at its card's vertical middle, so two cards of
 * different heights almost never agree to the pixel — and the couple of units
 * between them became a visible step near the arrowhead that no amount of
 * dragging could remove, because the step is the honest shape. Within this the
 * line is straightened and the difference split between the two ends, which
 * moves each arrow a few units off centre on a face tens of units tall.
 */
const ALIGN_SNAP = 10;

/**
 * The default place for a crossing: clear of both standoffs when there is room
 * between them, and a standoff's width past the nearer one when there is not.
 */
function defaultCrossing(from: number, toward: number, to: number, arriving: number): number {
  const clearsSource = (x: number) => (x - from) * toward >= 0;
  const clearsTarget = (x: number) => (x - to) * arriving >= 0;
  const middle = (from + to) / 2;
  if (clearsSource(middle) && clearsTarget(middle)) return middle;
  // No room between them — sit outside whichever standoff is further along.
  const outside = toward > 0 ? Math.max(from, to) : Math.min(from, to);
  return clearsTarget(outside) || clearsSource(outside) ? outside : middle;
}

export function orthogonalPath(params: OrthogonalParams): OrthogonalRoute {
  const given = params.bends ?? [];
  const s0: Vec = { x: params.sourceX, y: params.sourceY };
  const t0: Vec = { x: params.targetX, y: params.targetY };
  const sn = normalOf(params.sourcePosition);
  const tn = normalOf(params.targetPosition);
  // Present in every route, and the whole reason the face rule cannot be broken.
  const s1: Vec = { x: s0.x + sn.x * STANDOFF, y: s0.y + sn.y * STANDOFF };
  const t1: Vec = { x: t0.x + tn.x * STANDOFF, y: t0.y + tn.y * STANDOFF };

  const leavesSideways = sn.x !== 0;
  const arrivesSideways = tn.x !== 0;
  /** A stored bend, as an absolute coordinate again. */
  const bend = (index: number, axis: 'x' | 'y', fallback: number) =>
    typeof given[index] === 'number' ? (axis === 'x' ? s0.x : s0.y) + given[index] : fallback;

  let points: Vec[];
  let bends: Bend[];

  /*
   * Near enough to straight, and facing each other, is drawn straight. Only when
   * nobody has moved a bend: a route that has been shaped by hand is answering
   * to that instead.
   */
  const facing = leavesSideways === arrivesSideways &&
    (leavesSideways
      ? (t0.x - s0.x) * sn.x > 0 && (t0.x - s0.x) * tn.x < 0
      : (t0.y - s0.y) * sn.y > 0 && (t0.y - s0.y) * tn.y < 0);
  const drift = leavesSideways ? t0.y - s0.y : t0.x - s0.x;
  if (!given.length && facing && Math.abs(drift) <= ALIGN_SNAP) {
    const middle = leavesSideways ? (s0.y + t0.y) / 2 : (s0.x + t0.x) / 2;
    const straight: Vec[] = leavesSideways
      ? [{ x: s0.x, y: middle }, { x: t0.x, y: middle }]
      : [{ x: middle, y: s0.y }, { x: middle, y: t0.y }];
    return {
      path: `M${straight[0].x},${straight[0].y} L${straight[1].x},${straight[1].y}`,
      bends: [
        {
          at: { x: (straight[0].x + straight[1].x) / 2, y: (straight[0].y + straight[1].y) / 2 },
          axis: leavesSideways ? 'x' : 'y',
        },
      ],
    };
  }

  if (leavesSideways === arrivesSideways) {
    /*
     * Facing, alongside, or back to back: out, across, in. One bend — the
     * crossing — and the standoffs on either side of it keep both faces honest
     * however far out it is dragged.
     */
    if (leavesSideways) {
      const m = bend(0, 'x', defaultCrossing(s1.x, sn.x, t1.x, tn.x));
      points = [s0, s1, { x: m, y: s0.y }, { x: m, y: t0.y }, t1, t0];
      bends = [{ at: { x: m, y: (s0.y + t0.y) / 2 }, axis: 'x' }];
    } else {
      const m = bend(0, 'y', defaultCrossing(s1.y, sn.y, t1.y, tn.y));
      points = [s0, s1, { x: s0.x, y: m }, { x: t0.x, y: m }, t1, t0];
      bends = [{ at: { x: (s0.x + t0.x) / 2, y: m }, axis: 'y' }];
    }
  } else {
    /*
     * Perpendicular ends meet at a single corner, and while nobody has moved
     * anything that plain elbow is the right shape — a board full of connectors
     * that jog for no reason is worse than one that cannot be adjusted. Take
     * hold of either bend and the elbow opens into a jog; put them back where
     * they started and the two corners land on each other, so the elbow returns.
     */
    const across = leavesSideways ? 'x' : 'y';
    const along = leavesSideways ? 'y' : 'x';
    /*
     * The elbow is only the tidiest shape when its corner is actually clear of
     * both cards. Reach a left face from a card sitting to its right and the
     * elbow would run the length of the target to get there — correct at the
     * face, and straight through everything in between. So the default falls
     * back to crossing midway, out in the open, where the two cards are not.
     */
    const elbowClears = leavesSideways
      ? (t0.x - s1.x) * sn.x >= 0 && (t1.y - s0.y) * -tn.y >= 0
      : (t0.y - s1.y) * sn.y >= 0 && (t1.x - s0.x) * -tn.x >= 0;
    /*
     * When the elbow will not do, the first turn happens at the source's own
     * standoff. Anywhere further along would mean travelling back across the
     * card the connector has just left — the same mistake as the elbow, made at
     * the other end. Hugging the standoff is the one position that is provably
     * outside the source whatever the card's size, which the router is never
     * told.
     */
    const firstDefault = leavesSideways
      ? elbowClears
        ? t0.x
        : s1.x
      : elbowClears
        ? t0.y
        : s1.y;
    const first = bend(0, across, firstDefault);
    const second = bend(1, along, leavesSideways ? t1.y : t1.x);
    if (leavesSideways) {
      points = [s0, s1, { x: first, y: s0.y }, { x: first, y: second }, { x: t0.x, y: second }, t1, t0];
      bends = [
        { at: { x: first, y: (s0.y + second) / 2 }, axis: 'x' },
        { at: { x: (first + t0.x) / 2, y: second }, axis: 'y' },
      ];
    } else {
      points = [s0, s1, { x: s0.x, y: first }, { x: second, y: first }, { x: second, y: t0.y }, t1, t0];
      bends = [
        { at: { x: (s0.x + second) / 2, y: first }, axis: 'y' },
        { at: { x: second, y: (first + t0.y) / 2 }, axis: 'x' },
      ];
    }
  }

  /*
   * Repeated points only lengthen the path string. Collinear ones are left
   * alone deliberately: the standoffs are usually collinear with the segment
   * beside them, and folding them away is exactly how the first version lost
   * the guarantee they exist for.
   */
  const kept = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);

  const path = kept.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  return { path, bends };
}
