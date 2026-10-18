/**
 * Ids for the things that live only in `board.json` — edges and frames. They are
 * never path segments and never become slugs, so they only have to be unique
 * within a board.
 *
 * The shape deliberately matches what the canvas mints locally, so an edge the
 * server drew for an agent is indistinguishable from one somebody dragged. Two
 * minters that drifted would show up as two id shapes in one file.
 */
let seq = 0;

export function mintId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 5)}`;
}
