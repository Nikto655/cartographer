import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react';

/**
 * The emergent layer (§3.1): 1px at 45% opacity, so a mention reads as weaker
 * than a line somebody drew on purpose. It has no label, no menu and no delete —
 * it is not an object, it is what a sentence in a note looks like from far away.
 * Edit the note and it goes.
 *
 * **No arrowhead, deliberately.** The canvas's `defaultEdgeOptions` carries one
 * and this does not destructure `markerEnd`, which is the whole mechanism: a
 * drawn edge points somewhere, a mention only notices something. Spreading props
 * into `BaseEdge` here would quietly promote every mention into a relationship.
 */
export function DerivedEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const ghost = !!data?.toGhost;
  return (
    <BaseEdge
      path={path}
      interactionWidth={0}
      className={`cg-derived-edge${ghost ? ' cg-derived-edge--ghost' : ''}`}
    />
  );
}
