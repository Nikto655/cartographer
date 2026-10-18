/**
 * The imperative handles the mounted canvas publishes for core — the command
 * palette and shortcuts act on the live viewport, which no store can hold.
 * Every world fills these in on mount and clears them on unmount.
 */
import { useStore } from './store';

export const canvasActions: {
  createAtCenter?: () => void;
  focusNode?: (nodeId: string) => void;
  /** Tool ids are world-defined; core only ever passes them through. */
  armTool?: (tool: string) => void;
} = {};

/**
 * Select a node, bring it into view, open its panel. What following a link means
 * in every world (v1.5 §4.2), and what the palette has always done.
 */
export function revealNode(nodeId: string): void {
  const store = useStore.getState();
  if (!store.nodes.some((node) => node.id === nodeId)) return;
  useStore.setState({ nodes: store.nodes.map((node) => ({ ...node, selected: node.id === nodeId })) });
  canvasActions.focusNode?.(nodeId);
  store.openEditor(nodeId);
}
