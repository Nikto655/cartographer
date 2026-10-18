import type { BoardTypeDefinition, NodeTypeDefinition } from './types';

/*
 * Node-type resolution lives apart from the world table so a world can resolve
 * its own types without importing the registry that imports it.
 */
type NodeTypeSet = Pick<BoardTypeDefinition, 'nodeTypes' | 'defaultNodeType'>;

/** Anything the world doesn't recognise renders as its default type (§1). */
export function resolveNodeType(world: NodeTypeSet, type: string | undefined): NodeTypeDefinition {
  return (type && world.nodeTypes[type]) || world.nodeTypes[world.defaultNodeType];
}

/** False when the node asked for a type this world doesn't have — the UI says so quietly. */
export function isKnownNodeType(world: NodeTypeSet, type: string | undefined): boolean {
  return !!type && type in world.nodeTypes;
}
