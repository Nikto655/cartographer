import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Handle, NodeResizer, Position, useStore as useRFStore } from '@xyflow/react';
import { Bot, Braces, SquareSquare, Zap } from 'lucide-react';
import { MIN_NODE_SIZE } from '@cartograph/shared';
import { useStore } from '@/shared/store';
import type { NodeCardProps } from '@/board-types/types';

const SIDES: { position: Position; key: 'top' | 'right' | 'bottom' | 'left' }[] = [
  { position: Position.Top, key: 'top' },
  { position: Position.Right, key: 'right' },
  { position: Position.Bottom, key: 'bottom' },
  { position: Position.Left, key: 'left' },
];

function ShapeBackdrop({ shape, hollow }: { shape: string; hollow: boolean }) {
  if (shape !== 'ellipse' && shape !== 'diamond') return null;
  const dash = hollow ? '4 3' : undefined;
  return (
    <svg className="cg-node__svg" preserveAspectRatio="none" viewBox="0 0 100 100">
      {shape === 'ellipse' ? (
        <ellipse cx="50" cy="50" rx="49.5" ry="49.5" vectorEffect="non-scaling-stroke" strokeDasharray={dash} />
      ) : (
        <polygon points="50,1 99,50 50,99 1,50" vectorEffect="non-scaling-stroke" strokeDasharray={dash} />
      )}
    </svg>
  );
}

/** The classic map card: title, description, status spine, glyph row (v1.3 §3.2). */
export function CardContent({ id, data, selected }: NodeCardProps) {
  const zoom = useRFStore((s) => s.transform[2]);
  const config = useStore((s) => s.config);
  const renameNode = useStore((s) => s.renameNode);
  const patchNodeData = useStore((s) => s.patchNodeData);

  const readOnly = useStore((s) => s.readonly);
  const attaching = useStore((s) => !!s.detached);
  const attachEnd = useStore((s) => s.attachEnd);

  const [draft, setDraft] = useState(data.title);
  const inputRef = useRef<HTMLInputElement>(null);
  // A card on a board you are only viewing never enters its editing state, so
  // the title stays a title rather than a field that refuses to save (§5).
  const editing = !!data.editing && !readOnly;

  useEffect(() => setDraft(data.title), [data.title]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const statusToken =
    config?.statuses.find((s) => s.id === data.status)?.colorToken ?? '--status-sketched';
  const hollow = data.coverage === 'empty';
  const isChip = data.variant === 'chip';
  /*
   * Rect and rounded carry the status spine on their left edge. The round
   * shapes have no straight edge to sit on, so for them the spine rides beside
   * the title instead — one treatment shared by pill, ellipse and diamond.
   */
  const inlineSpine = data.shape === 'pill' || data.shape === 'ellipse' || data.shape === 'diamond';
  const isSvgShape = !isChip && (data.shape === 'ellipse' || data.shape === 'diamond');
  const childIds = data.childBoards ?? [];
  const showChips = zoom > 0.4; // glyph row hides below ~40% (§3.2)
  const smallType = zoom < 0.4;
  // Descriptions drop out well before the glyph row does — from a distance the
  // board should read as titles and shapes, not paragraphs.
  const withDescription =
    !editing && !!data.description?.trim() && (data.showDescription ?? true) && zoom > 0.62;

  // Who drew this, if it wasn't a person (v1.7 §4). The date is the day, not the
  // instant — the question the mark answers is "which agent run was this", and a
  // clock time only makes a hover label harder to read.
  const agent = data.createdVia === 'mcp' ? data.createdBy : undefined;
  const agentTitle = agent ? `${agent.token} · ${agent.at.slice(0, 10)}` : '';

  const commit = () => {
    const next = draft.trim();
    patchNodeData(id, { editing: false });
    if (next && next !== data.title) void renameNode(id, next);
    else setDraft(data.title);
  };

  // Left unset when no colour is chosen, so CSS decides the default per state
  // (paper normally, transparent while hollow) instead of the variable forcing it.
  // Unset and an explicit clear are the same thing: nothing painted. Such a node
  // must not keep the card's drop shadow — a shadow around nothing reads as a
  // rendering fault — so it takes a hairline instead and stays perceivable.
  const unfilled = !data.color || data.color === '--node-clear';
  const fillStyle = data.color
    ? ({ ['--node-fill' as string]: `var(${data.color})` } as CSSProperties)
    : undefined;

  // ---- chip variant (§4.2): auto-width pill, title only ----
  if (isChip) {
    return (
      <div
        className={`cg-chip${hollow ? ' cg-chip--hollow' : ''}${selected ? ' is-selected' : ''}`}
        style={fillStyle}
      >
        <span className="cg-chip__dot" style={{ background: `var(${statusToken})` }} />
        {editing ? (
          <input
            ref={inputRef}
            className="cg-chip__input"
            value={draft}
            autoFocus
            size={Math.max(draft.length, 6)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(data.title);
                patchNodeData(id, { editing: false });
              }
            }}
          />
        ) : (
          <span className="cg-chip__title">{data.title}</span>
        )}
        {childIds.length > 0 && (
          <span className="cg-chip__badge" title="Opens a sub-map">
            <SquareSquare size={11} />
          </span>
        )}
        {data.hasData && <span className="cg-chip__data" title="Has structured data" />}

        {SIDES.map((side) => (
          <Handle
            key={side.key}
            id={side.key}
            type="source"
            position={side.position}
            className="cg-handle"
            onClick={attaching ? (e) => { e.stopPropagation(); attachEnd(id, side.key); } : undefined}
          />
        ))}
      </div>
    );
  }

  // ---- card variant ----
  return (
    <div
      className={[
        'cg-node',
        `cg-node--${data.shape}`,
        hollow ? 'cg-node--hollow' : '',
        unfilled ? 'cg-node--unfilled' : '',
        selected ? 'cg-node--selected' : '',
        isSvgShape ? 'cg-node--svg' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={fillStyle}
    >
      <NodeResizer
        isVisible={!!selected && !readOnly}
        // A resize is a gesture like a drag: one undo entry, taken before it starts.
        onResizeStart={() => useStore.getState().pushHistory()}
        minWidth={MIN_NODE_SIZE.width}
        minHeight={MIN_NODE_SIZE.height}
        lineClassName="cg-resize-line"
        handleClassName="cg-resize-handle"
      />
      <ShapeBackdrop shape={data.shape} hollow={hollow} />

      {!inlineSpine && (
        <span className="status-spine" style={{ background: `var(${statusToken})`, opacity: hollow ? 0.4 : 1 }} />
      )}

      <div className={`cg-node__body${withDescription ? ' cg-node__body--described' : ''}`}>
        <span className="cg-node__title-row">
          {inlineSpine && (
            <span
              className="status-spine status-spine--inline"
              style={{ background: `var(${statusToken})`, opacity: hollow ? 0.4 : 1 }}
            />
          )}
          {editing ? (
            <input
              ref={inputRef}
              className="cg-node__input"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') {
                  setDraft(data.title);
                  patchNodeData(id, { editing: false });
                }
              }}
            />
          ) : (
            <span className={`cg-node__title${smallType ? ' cg-node__title--small' : ''}`}>{data.title}</span>
          )}
        </span>
        {withDescription && <span className="cg-node__description">{data.description}</span>}
      </div>

      {showChips && (data.hasData || childIds.length > 0 || data.passesData || agent) && (
        <div className="cg-node__footer">
          {agent && (
            <span className="cg-node__glyph cg-node__glyph--agent" title={agentTitle}>
              <Bot size={12} />
            </span>
          )}
          {data.hasData && (
            <span className="cg-node__glyph" title="Has snippets">
              <Braces size={12} />
            </span>
          )}
          {/* A mark, not a measurement. The count it used to carry (done over
              total, or ×k) was a second board's progress reported on the face
              of this one, at a size nobody could read without zooming in — and
              it made the row a different width on every card. */}
          {childIds.length > 0 && (
            <span className="cg-node__glyph" title="Opens a sub-map">
              <SquareSquare size={12} />
            </span>
          )}
          {data.passesData && (
            <span className="cg-node__glyph cg-node__glyph--data" title="Passes data forward">
              <Zap size={12} />
            </span>
          )}
        </div>
      )}

      {SIDES.map((side) => (
        <Handle
          key={side.key}
          id={side.key}
          type="source"
          position={side.position}
          className="cg-handle"
          /* While an end is lifted these stop being places a connection starts
             and become places one lands. Same dots, and that is the point: the
             thing you aim at is the thing you already know. */
          onClick={attaching ? (e) => { e.stopPropagation(); attachEnd(id, side.key); } : undefined}
        />
      ))}
    </div>
  );
}
