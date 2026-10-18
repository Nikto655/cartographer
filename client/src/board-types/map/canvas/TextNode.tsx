import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { NodeResizeControl, Position, ResizeControlVariant, type NodeProps } from '@xyflow/react';
import { useStore, type TextNode as TextNodeType } from '@/shared/store';

/** Narrower than this and a word of any length has nowhere to go. */
const MIN_WIDTH = 80;

/** Freestanding canvas annotation (§4.3). No file, no editor panel. */
function TextNodeImpl({ id, data, selected, width }: NodeProps<TextNodeType>) {
  const patchNodeData = useStore((s) => s.patchNodeData);
  const scheduleSave = useStore((s) => s.scheduleSave);
  const archiveNodes = useStore((s) => s.archiveNodes);

  const readOnly = useStore((s) => s.readonly);

  const [draft, setDraft] = useState(data.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  /*
   * An unsized text is exactly as wide as its rendered line, so swapping the
   * span for a `width: 100%` textarea dissolves the very width the box had and
   * it visibly jumps. Measured at the moment editing starts and held for the
   * session; a box with a dragged width keeps that instead.
   */
  const [editWidth, setEditWidth] = useState<number | null>(null);
  const editing = !!data.editing && !readOnly;

  /*
   * The textarea is as tall as what is in it. A fixed `rows` was fine when the
   * box was one line wide by definition; now that the box has a width, typing
   * past it has to push the bottom down rather than scroll inside a slot. Read
   * `scrollHeight` after collapsing the height, which is the only way to ask an
   * element how tall it *would* be.
   */
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => setDraft(data.text), [data.text]);
  useEffect(() => {
    if (!editing) return;
    fit();
    /*
     * Focus has to be *taken*, not requested once. React Flow keeps a freshly
     * created node `visibility: hidden` until it has measured it, and focus()
     * inside a hidden subtree fails silently — so the autoFocus attribute and
     * any single deferred call both land on a node that cannot take them yet,
     * and everything typed right after placing a text went to the canvas.
     * Retried on a timer (not rAF, which starves in an occluded tab) until the
     * element actually holds focus or editing ends.
     */
    let cancelled = false;
    const grab = (attempt: number) => {
      if (cancelled) return;
      const el = ref.current;
      if (!el) return;
      el.focus();
      if (document.activeElement === el) {
        el.select();
        return;
      }
      if (attempt < 20) window.setTimeout(() => grab(attempt + 1), 50);
    };
    grab(0);
    return () => {
      cancelled = true;
    };
  }, [editing, fit]);
  // Dragging the box narrower rewraps the draft, so the height has to follow it.
  useEffect(() => {
    if (editing) fit();
  }, [width, editing, fit]);

  const commit = () => {
    const next = draft.trim();
    if (!next) {
      // An empty label is nothing at all — drop it rather than leave a ghost.
      void archiveNodes([id]);
      return;
    }
    patchNodeData(id, { text: next, editing: false });
    scheduleSave();
  };

  return (
    <div
      ref={box}
      className={[
        'cg-text',
        `cg-text--${data.size}`,
        width ? 'cg-text--sized' : '',
        data.bold ? 'cg-text--bold' : '',
        data.italic ? 'cg-text--italic' : '',
        data.underline ? 'cg-text--underline' : '',
        selected ? 'is-selected' : '',
        // While editing the whole box opts out of node-dragging, so a press
        // anywhere in it goes to the text and never becomes a drag that blurs
        // the editor mid-thought.
        editing ? 'nodrag' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        editing && !width && editWidth
          ? { width: `${editWidth}px`, boxSizing: 'border-box' }
          : undefined
      }
      onDoubleClick={() => {
        if (readOnly) return;
        setEditWidth(box.current ? Math.max(box.current.offsetWidth, 120) : null);
        patchNodeData(id, { editing: true });
      }}
    >
      {/*
        * Two side handles rather than a `NodeResizer`, and that is the whole
        * design: the resizer would give corners and a height with them, and a
        * text with a stored height is a box the words either overflow or rattle
        * around in. Width is the only thing here worth dragging — the text
        * decides the rest, before and after.
        */}
      {selected && !readOnly && (
        <>
          <NodeResizeControl
            position={Position.Left}
            variant={ResizeControlVariant.Line}
            minWidth={MIN_WIDTH}
            // A resize is a gesture like a drag: one undo entry, taken up front.
            onResizeStart={() => useStore.getState().pushHistory()}
            className="cg-text__grip"
          />
          <NodeResizeControl
            position={Position.Right}
            variant={ResizeControlVariant.Line}
            minWidth={MIN_WIDTH}
            onResizeStart={() => useStore.getState().pushHistory()}
            className="cg-text__grip"
          />
        </>
      )}

      {editing ? (
        <textarea
          ref={ref}
          // `nodrag`: without it React Flow claims every press as the start of
          // a node drag — the caret cannot be placed and selecting text moves
          // the box, whose blur then commits and closes the editor.
          className="cg-text__input nodrag"
          rows={1}
          value={draft}
          autoFocus
          placeholder="Label…"
          onChange={(e) => {
            setDraft(e.target.value);
            fit();
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') commit();
          }}
        />
      ) : (
        <span className="cg-text__value">{data.text || 'Label…'}</span>
      )}
    </div>
  );
}

export const TextNode = memo(TextNodeImpl);
