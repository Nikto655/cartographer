import type { BoardTypeDefinition } from '@/board-types/types';
import { classicNodeType } from './classic';

/*
 * Split out of board.ts so the canvas can resolve a card's type without
 * importing the world definition that owns the canvas.
 */
export const mapNodeTypes: Pick<BoardTypeDefinition, 'nodeTypes' | 'defaultNodeType'> = {
  nodeTypes: { [classicNodeType.id]: classicNodeType },
  defaultNodeType: classicNodeType.id,
};
