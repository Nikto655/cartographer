import type { BoardTypeDefinition } from '@/board-types/types';
import { entityNodeType } from './entity';

/*
 * Split out of board.ts so the canvas can resolve a dot's type without importing
 * the world definition that owns the canvas.
 */
export const graphNodeTypes: Pick<BoardTypeDefinition, 'nodeTypes' | 'defaultNodeType'> = {
  nodeTypes: { [entityNodeType.id]: entityNodeType },
  defaultNodeType: entityNodeType.id,
};
