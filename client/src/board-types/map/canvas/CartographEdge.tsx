import { useEffect, useRef, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { Move3d, Pin, PinOff, Spline, Waypoints, X, Zap } from 'lucide-react';
import type { EdgeSide } from '@cartograph/shared';
import { useStore } from '@/shared/store';
import { orthogonalPath, type Bend, type OrthogonalRoute } from './orthogonal';

interface EdgeData {
  style?: 'solid' | 'dashed';
  shape?: 'curved' | 'angled';
  bends?: number[];
  carriesData?: boolean;
  outputLabel?: string;
  sourceSide?: string;
  targetSide?: string;
}

/** Which way a connector runs, for deciding which way its pill steps aside. */
const isHorizontal = (position: Position) => position === Position.Left || position === Position.Right;

/** The curved route, in the shape the angled one already answers in. */
const bezier = (params: Parameters<typeof getBezierPath>[0]): OrthogonalRoute => {
  const [path, x, y] = getBezierPath(params);
  // One "bend" so the label has somewhere to sit; a curve has nothing to grip.
  return { path, bends: [{ at: { x, y }, axis: 'x' }] };
};

/** Solid/dashed, data-carrying styling (§6.1) and three ways to delete (§6.2). */
export function CartographEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  selected,
  markerEnd,
  data,
}: EdgeProps) {
  const setEdgeLabel = useStore((s) => s.setEdgeLabel);
  const pinEdgeSides = useStore((s) => s.pinEdgeSides);
  const unpinEdgeSides = useStore((s) => s.unpinEdgeSides);
  const headsEdgeId = useStore((s) => s.headsEdgeId);
  const detached = useStore((s) => s.detached);
  const detachEnd = useStore((s) => s.detachEnd);
  const cancelDetach = useStore((s) => s.cancelDetach);
  const setHeadsEdge = useStore((s) => s.setHeadsEdge);
  const setEdgeStyle = useStore((s) => s.setEdgeStyle);
  const setEdgeShape = useStore((s) => s.setEdgeShape);
  const setEdgeBends = useStore((s) => s.setEdgeBends);
  const removeEdge = useStore((s) => s.removeEdge);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(typeof label === 'string' ? label : '');
  const editingEdgeId = useStore((s) => s.editingEdgeId);
  const setEditingEdge = useStore((s) => s.setEditingEdge);
  // Style, label and delete are the whole toolbar, so on a board you are only
  // viewing the edge keeps its passive form and nothing else (§5).
  const readOnly = useStore((s) => s.readonly);

  const edge = (data ?? {}) as EdgeData;
  const dashed = edge.style === 'dashed';
  const pinned = !!edge.sourceSide || !!edge.targetSide;
  const headsOn = headsEdgeId === id;
  /** Which of this edge's ends is currently lifted, if either. */
  const lifted = detached?.edgeId === id ? detached.end : null;
  /** Exactly the condition the toolbar renders under, so the two cannot drift. */
  const toolbarShowing = !editing && selected && !readOnly;
  /** Which way the connector runs, which decides which way its pill steps aside. */
  const runsVertically = Math.abs(targetY - sourceY) > Math.abs(targetX - sourceX);
  const carries = !!edge.carriesData;

  /*
   * Deselecting ends the mode. Without this it stays on for an edge nobody is
   * looking at, and the next click near that end grabs it instead of selecting
   * whatever was actually clicked.
   */
  useEffect(() => {
    if (!selected && headsOn) setHeadsEdge(null);
  }, [selected, headsOn, setHeadsEdge]);

  /*
   * How many corners an angled connector has is decided by its faces, and every
   * one of them is something to take hold of: the router hands back a bend per
   * turn, each knowing where it sits and which way it slides, and each gets its
   * own grip below. Where a bend may go is not this component's business — the
   * route is built so that no value can put a connector inside a card.
   */
  const angled = edge.shape === 'angled';
  const stored = Array.isArray(edge.bends) ? edge.bends : undefined;

  const route = angled
    ? orthogonalPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, bends: stored })
    : bezier({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const { path } = route;
  const [labelX, labelY] = [route.bends[0]?.at.x ?? 0, route.bends[0]?.at.y ?? 0];

  /** How far the pill steps aside: enough to clear a grip when there is one. */
  const clearance = angled ? 26 : 12;

  const flow = useReactFlow();
  const dragging = useRef(false);
  /** A bend's position as it is stored: an offset from the source end. */
  const offsetOf = (bend: Bend) => (bend.axis === 'x' ? bend.at.x - sourceX : bend.at.y - sourceY);
  /*
   * Dragging one bend writes all of them. The others are written where they
   * already are, which is the only way an untouched bend can keep the default
   * the router chose for it while a moved one keeps the value it was given —
   * a list with holes in it cannot say both.
   */
  const bendsWith = (index: number, clientX: number, clientY: number) => {
    const at = flow.screenToFlowPosition({ x: clientX, y: clientY });
    return route.bends.map((bend, i) =>
      i === index
        ? bend.axis === 'x'
          ? at.x - sourceX
          : at.y - sourceY
        : offsetOf(bend),
    );
  };

  const commit = () => {
    setEditing(false);
    setEditingEdge(null);
    setEdgeLabel(id, draft.trim());
  };

  // The canvas context menu asks for label editing through the store.
  useEffect(() => {
    if (editingEdgeId !== id) return;
    setDraft(typeof label === 'string' ? label : '');
    setEditing(true);
  }, [editingEdgeId, id, label]);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        // A thin line needs a fat invisible hit area to be clickable (§6.2).
        interactionWidth={12}
        className={[carries ? 'cg-edge--data' : '', selected ? 'cg-edge--selected' : '']
          .filter(Boolean)
          .join(' ')}
        style={dashed ? { strokeDasharray: '5 4' } : undefined}
      />
      {headsOn && !readOnly && (
        <>
          {/*
           * An end is moved by two clicks: one to lift it, one to put it down
           * on a face. Not by dragging — a drag has to catch a small target and
           * hold it across a card boundary while the card, its handles and this
           * pill all compete for the pointer. Each click here has something
           * visible to aim at, and missing costs nothing.
           */}
          {(
            [
              ['source', sourceX, sourceY],
              ['target', targetX, targetY],
            ] as const
          ).map(([end, x, y]) => (
            /*
             * The ring around each marker is the target you actually hit: twice
             * the radius, invisible, and it carries both the click and the
             * hover. Aiming at a 7px circle sitting on top of a card meant most
             * near-misses landed on the card instead, and the marker never even
             * lit up to say it had been found.
             */
            <g
              key={end}
              className="cg-edge-head-hit"
              onClick={(e) => {
                e.stopPropagation();
                lifted === end ? cancelDetach() : detachEnd(id, end);
              }}
            >
              <circle className="cg-edge-head__ring" cx={x} cy={y} r={15} />
              <circle
                className={`cg-edge-head${lifted === end ? ' is-lifted' : ''}`}
                cx={x}
                cy={y}
                r={7}
              />
            </g>
          ))}
        </>
      )}
      <EdgeLabelRenderer>
        {angled &&
          selected &&
          !headsOn &&
          !readOnly &&
          route.bends.map((bend, index) => (
            /*
             * The grips live in the label layer rather than in the edge's own
             * SVG, and that is the only reason they can be picked up at all:
             * edges paint under nodes, so a grip sitting a standoff off a card
             * was behind it, and the card took every click meant for it. This
             * layer sits above the cards. Raising the whole edge layer instead
             * would bring the line's own click target with it, and then a card
             * could not be selected wherever a connector happened to cross it.
             *
             * Pointer capture is what makes a drag survive leaving the grip:
             * without it the first fast move lands on the pane and the gesture
             * ends there. `nodrag nopan` stops React Flow reading the same
             * press as a pan. One history entry at the start and one save at
             * the end — the moves between only redraw.
             */
            <div
              key={index}
              className={`cg-edge-shoulder cg-edge-shoulder--${bend.axis} nodrag nopan`}
              style={{ transform: `translate(-50%, -50%) translate(${bend.at.x}px, ${bend.at.y}px)` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as Element).setPointerCapture(e.pointerId);
                dragging.current = true;
                setEdgeBends(id, bendsWith(index, e.clientX, e.clientY), 'start');
              }}
              onPointerMove={(e) => {
                if (!dragging.current) return;
                e.stopPropagation();
                setEdgeBends(id, bendsWith(index, e.clientX, e.clientY), 'move');
              }}
              onPointerUp={(e) => {
                if (!dragging.current) return;
                e.stopPropagation();
                (e.target as Element).releasePointerCapture(e.pointerId);
                dragging.current = false;
                setEdgeBends(id, bendsWith(index, e.clientX, e.clientY), 'end');
              }}
              /* A capture can be taken away — the window losing focus is enough.
                 Without this the gesture stays open forever and the move is
                 never written, which looks exactly like a dead drag. */
              onLostPointerCapture={() => {
                if (!dragging.current) return;
                dragging.current = false;
                setEdgeBends(id, route.bends.map(offsetOf), 'end');
              }}
            >
              <span className="cg-edge-shoulder__grip" />
            </div>
          ))}
        <div
          className="cg-edge-label-wrap"
          /*
           * The toolbar sits *above* the line, not on it. A label centred on the
           * midpoint is right — it reads as belonging to the connector — but the
           * toolbar is the same size as a small card, and the midpoint is
           * precisely where someone reaches to click the line, drag an end past,
           * or read what it says. Lifted clear, the line stays available while
           * its controls are open.
           */
          /*
           * The toolbar clears the line by moving *across* it, not along it.
           * Lifting straight up is right for a connector running left-to-right
           * and useless for one running top-to-bottom — there, up is along the
           * line, so the pill lands squarely on the thing it is covering for.
           * Which way to move is therefore decided by which way the line runs.
           *
           * It moves further when there is a shoulder, because the grip sits at
           * this same point with a 15px reach around it. The pill is HTML over
           * the connector's SVG, so any overlap is not a near miss: the pill
           * takes the pointer and that part of the grip is simply dead.
           */
          style={{
            transform: toolbarShowing
              ? `translate(${runsVertically ? `${clearance}px` : '-50%'}, ${runsVertically ? '-50%' : `calc(-100% - ${clearance}px)`}) translate(${labelX}px, ${labelY}px)`
              : `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (readOnly) return;
            setDraft(typeof label === 'string' ? label : '');
            setEditing(true);
          }}
        >
          {editing ? (
            <input
              className="cg-edge-input"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
          ) : selected && !readOnly ? (
            <div className="cg-edge-toolbar">
              {/*
                * While the ends are being moved the pill is only the way out of
                * that mode. A five-button bar is as wide as the gap between two
                * cards, and it sits on the midpoint — measured, it was covering
                * an endpoint with the Delete button, so pressing the anchor
                * pressed that instead. The controls come back the moment the
                * mode is off.
                */}
              {headsOn ? (
                <button
                  type="button"
                  className="cg-edge-toolbar__btn is-active"
                  onClick={() => setHeadsEdge(null)}
                  title="Done moving the ends"
                >
                  <Move3d size={13} />
                </button>
              ) : (
                <>
              <button
                type="button"
                className={`cg-edge-toolbar__btn${!dashed ? ' is-active' : ''}`}
                onClick={() => setEdgeStyle(id, 'solid')}
                title="Solid"
              >
                <svg width="20" height="8" aria-hidden>
                  <line x1="1" y1="4" x2="19" y2="4" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
              <button
                type="button"
                className={`cg-edge-toolbar__btn${dashed ? ' is-active' : ''}`}
                onClick={() => setEdgeStyle(id, 'dashed')}
                title="Dashed — tentative"
              >
                <svg width="20" height="8" aria-hidden>
                  <line
                    x1="1"
                    y1="4"
                    x2="19"
                    y2="4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                </svg>
              </button>
              <span className="cg-edge-toolbar__sep" />
              {/*
                * Solid/dashed is what the line is made of; curved/angled is
                * where it goes. Two different questions, so they sit either
                * side of a separator rather than reading as one four-way pick.
                */}
              <button
                type="button"
                className={`cg-edge-toolbar__btn${angled ? ' is-active' : ''}`}
                onClick={() => setEdgeShape(id, angled ? 'curved' : 'angled')}
                title={angled ? 'Angled — square corners' : 'Curved'}
              >
                {angled ? <Waypoints size={13} /> : <Spline size={13} />}
              </button>
              <span className="cg-edge-toolbar__sep" />
              {/*
                * Heads. Off, an end is not grabbable at all — that keeps an
                * ordinary click on the connector selecting it rather than
                * catching an endpoint, and means nothing pretends to be
                * draggable when it is not. On, both ends can be picked up and
                * dropped on any face of any card, and where one lands is where
                * it stays: the drop is the person saying where they want it,
                * which is exactly what pinning records.
                */}
              <button
                type="button"
                className={`cg-edge-toolbar__btn${headsOn ? ' is-active' : ''}`}
                onClick={() => setHeadsEdge(headsOn ? null : id)}
                title={headsOn ? 'Done moving the ends' : 'Move the ends'}
              >
                <Move3d size={13} />
              </button>
              {/*
                * Pin: lock both ends to the faces they are on right now, without
                * moving anything. Separate from the heads button on purpose —
                * that one is for putting an end somewhere else, this one is for
                * keeping an arrangement you already like. Dragging the cards
                * until it reads well and then freezing it is the common case,
                * and it needs no aim at all.
                */}
              <button
                type="button"
                className={`cg-edge-toolbar__btn${pinned ? ' is-active' : ''}`}
                onClick={() =>
                  pinned
                    ? unpinEdgeSides(id)
                    : pinEdgeSides(id, sourcePosition as EdgeSide, targetPosition as EdgeSide)
                }
                title={pinned ? 'Pinned — click to let both ends follow again' : 'Pin both ends where they are'}
              >
                {pinned ? <PinOff size={13} /> : <Pin size={13} />}
              </button>
              <span className="cg-edge-toolbar__sep" />
              <button
                type="button"
                className="cg-edge-toolbar__btn cg-edge-toolbar__btn--text"
                onClick={() => {
                  setDraft(typeof label === 'string' ? label : '');
                  setEditing(true);
                }}
                title="Label"
              >
                {label ? String(label) : 'Label'}
              </button>
              <span className="cg-edge-toolbar__sep" />
              <button
                type="button"
                className="cg-edge-toolbar__btn cg-edge-toolbar__btn--danger"
                onClick={() => removeEdge(id)}
                title="Delete edge"
                aria-label="Delete edge"
              >
                <X size={13} />
              </button>
                            </>
              )}
</div>
          ) : (
            <span className="cg-edge-idle">
              {carries && (
                <span className="cg-edge-data-pill" title={`Carries: ${edge.outputLabel ?? 'data'}`}>
                  <Zap size={10} />
                </span>
              )}
              {label && <span className="cg-edge-label">{label}</span>}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>

    </>
  );
}
