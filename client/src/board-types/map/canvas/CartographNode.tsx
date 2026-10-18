import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { isKnownNodeType, resolveNodeType } from '@/board-types/nodeTypes';
import type { CardNode } from '@/shared/store';
import { mapNodeTypes } from '../node-types';

/**
 * The map's card slot: the node type decides what a card looks like, the canvas
 * only picks which one. A type this world doesn't have still draws — as the
 * world default, flagged with a badge rather than an error (§1).
 */
function CartographNodeImpl({ id, data, selected }: NodeProps<CardNode>) {
  const nodeType = resolveNodeType(mapNodeTypes, data.nodeType);
  const unknown = !!data.nodeType && !isKnownNodeType(mapNodeTypes, data.nodeType);

  return (
    <>
      <nodeType.CardContent id={id} data={data} selected={!!selected} />
      {unknown && (
        <span className="cg-node__type-badge mono" title={`Unknown node type “${data.nodeType}” · shown as ${nodeType.label}`}>
          ?
        </span>
      )}
    </>
  );
}

export const CartographNode = memo(CartographNodeImpl);
