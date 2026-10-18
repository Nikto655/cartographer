import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Bot } from 'lucide-react';
import { isKnownNodeType, resolveNodeType } from '@/board-types/nodeTypes';
import type { CardNode } from '@/shared/store';
import { graphNodeTypes } from '../node-types';

/**
 * The graph's node slot: the node type decides what a dot looks like, the canvas
 * only picks which one. A type this world doesn't have still draws — as the
 * world default, flagged with a badge rather than an error (§1).
 */
function EntityNodeImpl({ id, data, selected }: NodeProps<CardNode>) {
  const nodeType = resolveNodeType(graphNodeTypes, data.nodeType);
  const unknown = !!data.nodeType && !isKnownNodeType(graphNodeTypes, data.nodeType);
  /*
   * Who drew this, if it wasn't a person (v1.7 §4). It hangs off the dot rather
   * than sitting in it: the dot is as small as 8px and carries fill, hollowness
   * and the sub-board ring already — anything drawn inside it would either be
   * invisible or would overwrite one of those three. Same corner treatment as
   * the unknown-type badge, on the opposite side of the label, so a node can
   * wear both marks at once without them colliding.
   */
  const agent = data.createdVia === 'mcp' ? data.createdBy : undefined;

  return (
    <>
      <nodeType.CardContent id={id} data={data} selected={!!selected} />
      {agent && (
        <span className="cg-entity__agent" title={`${agent.token} · ${agent.at.slice(0, 10)}`}>
          <Bot size={9} />
        </span>
      )}
      {unknown && (
        <span
          className="cg-entity__badge mono"
          title={`Unknown node type “${data.nodeType}” · shown as ${nodeType.label}`}
        >
          ?
        </span>
      )}
    </>
  );
}

export const EntityNode = memo(EntityNodeImpl);
