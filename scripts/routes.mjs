/*
 * The connector router's invariants, checked over every pair of faces and a
 * spread of relative positions. It is a pure function, so this needs no server
 * and no browser — and it is the only way the awkward cases get looked at at
 * all: two cards side by side, one behind the other, both pinned to faces that
 * point the same way.
 *
 * Bundle the router once, then run it:
 *   npx esbuild client/src/board-types/map/canvas/orthogonal.ts --bundle \
 *     --format=esm --outfile=/tmp/orth.mjs --alias:@xyflow/react=./scripts/position-shim.mjs
 *   node scripts/routes.mjs
 */
import { orthogonalPath } from '/tmp/orth.mjs';

const FACES = ['left', 'right', 'top', 'bottom'];
const NORMAL = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const CARD = { w: 184, h: 76 };

// The anchor point of a face, for a card whose top-left is at (x, y).
const anchor = (x, y, face) => ({
  left:   { x, y: y + CARD.h / 2 },
  right:  { x: x + CARD.w, y: y + CARD.h / 2 },
  top:    { x: x + CARD.w / 2, y },
  bottom: { x: x + CARD.w / 2, y: y + CARD.h },
}[face]);

const parse = (d) => d.split('L').map((seg) => seg.replace('M', '').split(',').map(Number)).map(([x, y]) => ({ x, y }));

let checked = 0, bad = [];
// The near-misses matter as much as the extremes: two cards of different heights
// put their side anchors a few units apart, which is a step nobody can drag out.
const OFFSETS = [[0,0],[300,0],[-300,0],[0,300],[0,-300],[300,300],[-300,300],[300,-300],
  [-260,-260],[60,40],[-60,-40],[900,500],[300,6],[300,-6],[6,300],[-6,-300],[300,40]];
// Offsets in flow units, including some far outside anything sane — the point
// of removing the fence is that absurd values must still meet the faces right.
const BENDS = [undefined, [0], [-40], [400], [-900], [2000], [60, -60], [-500, 700], [0, 0]];

for (const sf of FACES) for (const tf of FACES) for (const [dx, dy] of OFFSETS) for (const bends of BENDS) {
  const s = anchor(0, 0, sf);
  const t = anchor(dx, dy, tf);
  const route = orthogonalPath({
    sourceX: s.x, sourceY: s.y, targetX: t.x, targetY: t.y,
    sourcePosition: sf, targetPosition: tf, bends,
  });
  const d = route.path;
  const pts = parse(d);
  const label = `${sf}->${tf} @(${dx},${dy}) bends=${JSON.stringify(bends)}`;
  checked++;

  // 1. every segment is axis-aligned (a right angle at every turn)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.x !== b.x && a.y !== b.y) bad.push(`${label}: segment ${i} is diagonal`);
  }
  // 2. it leaves the source along that face's normal
  const [snx, sny] = NORMAL[sf];
  const first = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
  if (first.x * snx + first.y * sny <= 0) bad.push(`${label}: leaves the source inward`);
  // 3. it arrives at the target from OUTSIDE — the thing in the screenshot
  const [tnx, tny] = NORMAL[tf];
  const last = { x: pts.at(-1).x - pts.at(-2).x, y: pts.at(-1).y - pts.at(-2).y };
  if (last.x * tnx + last.y * tny >= 0) bad.push(`${label}: arrives at the target from inside`);
  // 4. every bend the route offers has its grip sitting on the line
  if (!route.bends.length) bad.push(`${label}: no grip at all`);
  for (const g of route.bends) {
    const onPath = pts.some((p, i) => i && (
      (p.x === pts[i-1].x && Math.abs(g.at.x - p.x) < 0.01 && (g.at.y - p.y) * (g.at.y - pts[i-1].y) <= 0.01) ||
      (p.y === pts[i-1].y && Math.abs(g.at.y - p.y) < 0.01 && (g.at.x - p.x) * (g.at.x - pts[i-1].x) <= 0.01)));
    if (!onPath) bad.push(`${label}: a grip is off the line`);
  }
  /*
   * 5. the shape a connector gets for free must not run through either card.
   *
   * Only checked for perpendicular ends. The router is given two anchors and
   * two faces and never a card's size, so it cannot route around something it
   * cannot see: two left faces at the same height have to travel between the
   * cards, and no arrangement of turns avoids that. Perpendicular ends always
   * have a clear route, and taking it is exactly what the plain elbow fails to
   * do when the target sits behind the source.
   */
  const perpendicular = (sf === 'left' || sf === 'right') !== (tf === 'left' || tf === 'right');
  // Overlapping cards have no clear route between them by definition.
  const apart = Math.abs(dx) >= CARD.w || Math.abs(dy) >= CARD.h;
  /*
   * And a perpendicular route has to travel along the target's standoff line to
   * reach its face. When that line runs through the source card there is no
   * clean way past it — not without knowing how tall or wide the source is,
   * which is exactly what the router is never told. Demanding it here would be
   * demanding the impossible; what it costs is that this case goes unchecked.
   */
  const clears = (norm, from, card) => {
    const line = norm[0] !== 0 ? from.x + norm[0] * 7 : from.y + norm[1] * 7;
    const span = norm[0] !== 0 ? [card.x, card.x + CARD.w] : [card.y, card.y + CARD.h];
    return line < span[0] || line > span[1];
  };
  // Both standoff lines, since a perpendicular route travels along each of them.
  const reachable =
    clears(NORMAL[tf], t, { x: 0, y: 0 }) && clears(NORMAL[sf], s, { x: dx, y: dy });
  if (!bends && perpendicular && apart && reachable) {
    const boxes = [{ x: 0, y: 0 }, { x: dx, y: dy }].map((o) => ({
      x1: o.x + 1, y1: o.y + 1, x2: o.x + CARD.w - 1, y2: o.y + CARD.h - 1,
    }));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      for (const box of boxes) {
        const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
        const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
        if (lo.x < box.x2 && hi.x > box.x1 && lo.y < box.y2 && hi.y > box.y1) {
          bad.push(`${label}: the default route crosses a card`);
        }
      }
    }
  }
  // 6. two facing ends a hair out of true are drawn as one straight line
  if (!bends) {
    const sameAxis = (sf === 'left' || sf === 'right') === (tf === 'left' || tf === 'right');
    const sn = NORMAL[sf], tn = NORMAL[tf];
    const sideways = sn[0] !== 0;
    const facing = sameAxis && (sideways
      ? (t.x - s.x) * sn[0] > 0 && (t.x - s.x) * tn[0] < 0
      : (t.y - s.y) * sn[1] > 0 && (t.y - s.y) * tn[1] < 0);
    const drift = Math.abs(sideways ? t.y - s.y : t.x - s.x);
    if (facing && drift <= 10 && pts.length !== 2) {
      bad.push(`${label}: ${drift} out of true and still stepped (${pts.length} points)`);
    }
  }
  // 7. a bend that is given a value actually lands on it — no hidden fence
  if (bends) {
    for (let i = 0; i < Math.min(bends.length, route.bends.length); i++) {
      const g = route.bends[i];
      const want = (g.axis === 'x' ? s.x : s.y) + bends[i];
      const got = g.axis === 'x' ? g.at.x : g.at.y;
      if (Math.abs(want - got) > 0.01) bad.push(`${label}: bend ${i} clamped (${got} not ${want})`);
    }
  }
}

console.log(`  ${checked} routes checked`);
if (bad.length) {
  console.log(`  ${bad.length} FAILURES:`);
  for (const b of [...new Set(bad)].slice(0, 12)) console.log('   ', b);
} else console.log('  every route: right angles only, leaves outward, arrives from outside, grip on the line');
