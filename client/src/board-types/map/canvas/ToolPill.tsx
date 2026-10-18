import { useEffect, useRef, useState } from 'react';
import { Frame, Hand, MousePointer2, Spline, StickyNote, Tag, Type } from 'lucide-react';
import { Tooltip } from '@/shared/ui';

export type Tool = 'select' | 'pan' | 'node' | 'chip' | 'frame' | 'text' | 'connector';

const TOOLS: { id: Tool; label: string; keys?: string[]; Icon: typeof Frame }[] = [
  { id: 'select', label: 'Select', keys: ['V'], Icon: MousePointer2 },
  /*
   * Move. Middle-drag and right-drag have always panned, and space-drag is the
   * habit of people who already know that — none of which is discoverable with
   * one hand on a mouse, where a left-drag on the pane draws a selection box and
   * a left-drag on a node moves it. This is the same gesture, armed.
   */
  { id: 'pan', label: 'Move', keys: ['H'], Icon: Hand },
  { id: 'node', label: 'Node', keys: ['N'], Icon: StickyNote },
  { id: 'chip', label: 'Chip', Icon: Tag },
  { id: 'frame', label: 'Frame', keys: ['F'], Icon: Frame },
  { id: 'text', label: 'Text', keys: ['T'], Icon: Type },
  { id: 'connector', label: 'Connector', Icon: Spline },
];

export interface DragOut {
  tool: Tool;
  x: number;
  y: number;
}

/**
 * Top-centre tool pill (§4.5). Every tool supports click-to-arm and drag-out:
 * the element follows the cursor from the pill at 0.9 scale and springs to 1 on drop.
 */
export function ToolPill({
  armed,
  onArm,
  onPlace,
}: {
  armed: Tool;
  onArm: (tool: Tool) => void;
  onPlace: (tool: Tool, client: { x: number; y: number }) => void;
}) {
  const [drag, setDrag] = useState<DragOut | null>(null);
  const dragRef = useRef<DragOut | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      setDrag((d) => (d ? { ...d, x: event.clientX, y: event.clientY } : d));
    };
    const onUp = (event: PointerEvent) => {
      const current = dragRef.current;
      setDrag(null);
      if (!current) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (target?.closest('.react-flow')) onPlace(current.tool, { x: event.clientX, y: event.clientY });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, onPlace]);

  return (
    <>
      <div className="pill tool-pill">
        {TOOLS.map(({ id, label, keys, Icon }) => (
          <Tooltip key={id} label={label} keys={keys}>
            <button
              type="button"
              className={`pill__btn${armed === id ? ' is-active' : ''}`}
              aria-label={label}
              aria-pressed={armed === id}
              onClick={() => onArm(id)}
              onPointerDown={(event) => {
                if (id === 'select' || id === 'pan' || id === 'connector') return;
                event.preventDefault();
                setDrag({ tool: id, x: event.clientX, y: event.clientY });
              }}
            >
              <Icon size={17} />
            </button>
          </Tooltip>
        ))}
      </div>

      {drag && (
        <div className="tool-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden>
          {drag.tool === 'frame' && <div className="tool-ghost__frame" />}
          {drag.tool === 'node' && <div className="tool-ghost__node" />}
          {drag.tool === 'chip' && <div className="tool-ghost__chip" />}
          {drag.tool === 'text' && <div className="tool-ghost__text">Text</div>}
        </div>
      )}
    </>
  );
}
