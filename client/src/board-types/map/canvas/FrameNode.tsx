import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useStore, type FrameNode as FrameNodeType } from '@/shared/store';
import { StatusStrip } from '@/shared/ui';

/** Sections (§4.1). Rendered behind nodes; members ride along via React Flow parenting. */
function FrameNodeImpl({ id, data, selected }: NodeProps<FrameNodeType>) {
  const config = useStore((s) => s.config);
  // Selectors must return stable references — filter in a memo, not in the selector.
  const allNodes = useStore((s) => s.nodes);
  const members = useMemo(() => allNodes.filter((n) => n.parentId === id), [allNodes, id]);
  const toggleCollapse = useStore((s) => s.toggleFrameCollapse);
  const patchNodeData = useStore((s) => s.patchNodeData);
  const scheduleSave = useStore((s) => s.scheduleSave);

  const readOnly = useStore((s) => s.readonly);

  const [draft, setDraft] = useState(data.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = !!data.editing && !readOnly;

  useEffect(() => setDraft(data.title), [data.title]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const counts: Record<string, number> = {};
  for (const member of members) {
    const status = (member.data as { status?: string }).status;
    if (status) counts[status] = (counts[status] ?? 0) + 1;
  }

  const commit = () => {
    const next = draft.trim() || 'Section';
    patchNodeData(id, { title: next, editing: false });
    scheduleSave();
  };

  return (
    <div
      className={`cg-frame${data.collapsed ? ' cg-frame--collapsed' : ''}${selected ? ' is-selected' : ''}`}
      style={{ ['--frame-tint' as string]: data.color ? `var(${data.color})` : 'var(--node-slate)' }}
    >
      <NodeResizer
        isVisible={!!selected && !data.collapsed && !readOnly}
        // A resize is a gesture like a drag: one undo entry, taken before it starts.
        onResizeStart={() => useStore.getState().pushHistory()}
        minWidth={220}
        minHeight={140}
        lineClassName="cg-resize-line"
        handleClassName="cg-resize-handle"
      />

      <header className="cg-frame__head">
        <button
          type="button"
          className="cg-frame__chevron"
          // Collapsing is stored on the frame, so it is a change like any other.
          onClick={() => !readOnly && toggleCollapse(id)}
          aria-label={data.collapsed ? 'Expand frame' : 'Collapse frame'}
        >
          {data.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>

        {editing ? (
          <input
            ref={inputRef}
            className="cg-frame__input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') patchNodeData(id, { editing: false });
            }}
          />
        ) : (
          <span
            className="cg-frame__title"
            onDoubleClick={() => !readOnly && patchNodeData(id, { editing: true })}
            title={readOnly ? undefined : 'Double-click to rename'}
          >
            {data.title}
          </span>
        )}

        <span className="cg-frame__count mono">{members.length}</span>
        {config && (
          <span className="cg-frame__strip">
            <StatusStrip counts={counts} statuses={config.statuses} height={4} />
          </span>
        )}
      </header>
    </div>
  );
}

export const FrameNode = memo(FrameNodeImpl);
