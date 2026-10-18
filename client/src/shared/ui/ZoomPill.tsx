import { Map as MapIcon, Maximize2, Minus, Plus } from 'lucide-react';
import { useReactFlow, useStore as useRFStore } from '@xyflow/react';
import { Tooltip } from '@/shared/ui';

/**
 * Zoom out / percentage / zoom in / fit — the same four controls on every
 * canvas, so they live here rather than once per world.
 *
 * On a graph the percentage is more than magnification: zoom is what decides
 * whether you are reading labels or looking at the shape of the whole board
 * (v1.5 §3.1), which is why it is always on screen and always clickable back
 * to 100%.
 */
export function ZoomPill({
  fitPadding = 0.2,
  minimap,
}: {
  fitPadding?: number;
  /** Folds the minimap toggle into this pill. Omit it to place one separately. */
  minimap?: { active: boolean; onToggle: () => void };
}) {
  const flow = useReactFlow();
  const zoom = useRFStore((s) => s.transform[2]);

  return (
    <div className="pill">
      <button type="button" className="pill__btn" onClick={() => flow.zoomOut()} aria-label="Zoom out">
        <Minus size={16} />
      </button>
      <button
        type="button"
        className="pill__btn zoom-pill__value mono"
        onClick={() => flow.zoomTo(1, { duration: 160 })}
        aria-label="Reset zoom to 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className="pill__btn" onClick={() => flow.zoomIn()} aria-label="Zoom in">
        <Plus size={16} />
      </button>
      <span className="pill__sep" />
      <Tooltip label="Fit to view">
        <button
          type="button"
          className="pill__btn"
          onClick={() => void flow.fitView({ duration: 200, padding: fitPadding })}
          aria-label="Fit to view"
        >
          <Maximize2 size={16} />
        </button>
      </Tooltip>
      {minimap && (
        <Tooltip label={minimap.active ? 'Hide minimap' : 'Show minimap'}>
          <button
            type="button"
            className={`pill__btn${minimap.active ? ' is-active' : ''}`}
            onClick={minimap.onToggle}
            aria-label={minimap.active ? 'Hide minimap' : 'Show minimap'}
          >
            <MapIcon size={16} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

/** Separate because the map puts it in the opposite corner from the zoom pill. */
export function MinimapToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <div className="pill">
      <Tooltip label={active ? 'Hide minimap' : 'Show minimap'}>
        <button
          type="button"
          className={`pill__btn${active ? ' is-active' : ''}`}
          onClick={onToggle}
          aria-label={active ? 'Hide minimap' : 'Show minimap'}
        >
          <MapIcon size={16} />
        </button>
      </Tooltip>
    </div>
  );
}
