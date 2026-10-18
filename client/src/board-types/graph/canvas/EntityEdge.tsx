import { useEffect, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getStraightPath, type EdgeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import { useStore } from '@/shared/store';

/**
 * A drawn relationship: solid 1.5px, straight, arrowhead at the target.
 *
 * v1.5 §3.1 had no arrowhead, reasoning that direction is an authoring detail on
 * a graph. That is overridden: an edge stores a source and a target either way,
 * the export renders them as "Connects to" / "Connects from", and a reader who
 * has just come from a map should not have to learn that the same line means
 * something different here. The marker comes from the canvas's
 * `defaultEdgeOptions` — the map's, unchanged — and is simply passed through.
 *
 * Labels stay out of the way until you hover or select, and the v1.3 delete
 * affordances all still apply.
 */
export function EntityEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  label,
  selected,
  markerEnd,
  data,
}: EdgeProps) {
  const setEdgeLabel = useStore((s) => s.setEdgeLabel);
  const removeEdge = useStore((s) => s.removeEdge);
  const editingEdgeId = useStore((s) => s.editingEdgeId);
  const setEditingEdge = useStore((s) => s.setEditingEdge);
  const readOnly = useStore((s) => s.readonly);
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState(typeof label === 'string' ? label : '');

  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });

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

  // Labels can be switched off board-wide (§3.2); editing one is still possible
  // through selection, so the toggle hides the passive label only.
  const labelsOn = data?.showLabels !== false;
  const showLabel = labelsOn && !!label && (hovered || !!selected);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        // A hairline needs a fat invisible hit area to be clickable (§6.2 v1.3).
        interactionWidth={12}
        className={selected ? 'cg-graph-edge cg-graph-edge--selected' : 'cg-graph-edge'}
      />
      <EdgeLabelRenderer>
        <div
          className="cg-graph-label-wrap"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (readOnly) return;
            setDraft(typeof label === 'string' ? label : '');
            setEditing(true);
          }}
        >
          {editing ? (
            <input
              className="cg-graph-input"
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
            <div className="cg-graph-edge-toolbar">
              <button
                type="button"
                className="cg-graph-edge-toolbar__btn cg-graph-edge-toolbar__btn--text"
                onClick={() => {
                  setDraft(typeof label === 'string' ? label : '');
                  setEditing(true);
                }}
                title="Label"
              >
                {label ? String(label) : 'Label'}
              </button>
              <span className="cg-graph-edge-toolbar__sep" />
              <button
                type="button"
                className="cg-graph-edge-toolbar__btn cg-graph-edge-toolbar__btn--danger"
                onClick={() => removeEdge(id)}
                title="Delete edge"
                aria-label="Delete edge"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            showLabel && <span className="cg-graph-label">{label}</span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
