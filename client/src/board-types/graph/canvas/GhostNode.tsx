import { memo, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { MIN_DOT } from '../geometry';

/*
 * A ghost is never an endpoint you can draw to, but React Flow still needs a
 * handle to anchor the derived line that points at it.
 */
const SIDES: { position: Position; key: string }[] = [
  { position: Position.Top, key: 'top' },
  { position: Position.Right, key: 'right' },
  { position: Position.Bottom, key: 'bottom' },
  { position: Position.Left, key: 'left' },
];

export interface GhostNodeData extends Record<string, unknown> {
  title: string;
  dot: number;
  /** How many notes mention it — the tooltip's whole story. */
  mentions: number;
  showLabel: boolean;
}

export type GhostFlowNode = Node<GhostNodeData, 'ghost'>;

/**
 * A thing that has been talked about but does not exist yet (§4.2). Grey and
 * dashed because it is a promise, not a record: nothing on disk, nothing in
 * board.json. Click it and it becomes an ordinary entity.
 */
function GhostNodeImpl({ data }: NodeProps<GhostFlowNode>) {
  const style = { width: data.dot || MIN_DOT, height: data.dot || MIN_DOT } as CSSProperties;

  return (
    <div
      className="cg-ghost"
      style={style}
      title={`“${data.title}” is mentioned by ${data.mentions === 1 ? '1 note' : `${data.mentions} notes`} · click to create it`}
    >
      {data.showLabel && <span className="cg-ghost__label">{data.title}</span>}
      {SIDES.map((side) => (
        <Handle
          key={side.key}
          id={side.key}
          type="source"
          position={side.position}
          isConnectable={false}
          className="cg-ghost__handle"
        />
      ))}
    </div>
  );
}

export const GhostNode = memo(GhostNodeImpl);
