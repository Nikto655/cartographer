import type { ComponentType } from 'react';
import type { NodeContent, NodeData } from '@cartograph/shared';
import type { CanvasNodeData } from '@/shared/store';

/**
 * The contract between core and a world (v1.5 §6). Core knows these shapes and
 * nothing else about any particular board type.
 */

/** What the shell hands every tab, whichever world owns it. */
export interface NodeTabProps {
  nodeId: string;
  content: NodeContent;
  onBodyChange: (body: string) => void;
  onDataChange: (data: NodeData) => void;
  /** Tabs cross-link ("Open in Notes", "Add a sub-map") — the shell owns which one is showing. */
  onOpenTab: (tabId: string) => void;
  /** Select another node on the canvas and follow it with the panel. */
  onOpenNode: (nodeId: string) => void;
  /** Hand the file itself to the shell's raw editor. */
  onOpenRaw: () => void;
  onDuplicate: () => void;
  /**
   * This board is being viewed, not edited (v1.6 §5). A tab that honours it
   * shows everything and offers nothing: no inputs, no actions, no autosave.
   * The store refuses the writes anyway — this is so the panel doesn't lie.
   */
  readOnly: boolean;
}

/** What a card renderer gets from the canvas — the React Flow node, minus its chrome. */
export interface NodeCardProps {
  id: string;
  data: CanvasNodeData;
  selected: boolean;
}

/** Everything the board canvas needs from the app shell. */
export interface BoardCanvasProps {
  onExport: () => void;
  onPalette: () => void;
  snapToGrid: boolean;
  showMinimap: boolean;
  onToggleMinimap: () => void;
  /** Read-only view (v1.6 §5): the canvas draws, and every way in is closed. */
  readOnly: boolean;
}

export interface NodeTypeDefinition {
  id: string;
  label: string;
  tabs: {
    id: string;
    label: string;
    component: ComponentType<NodeTabProps>;
    /*
     * The tab bar marks tabs that hold something (v1.3). Only the tab knows what
     * counts as content, so it says so here rather than the shell guessing by id.
     */
    dot?: (content: NodeContent) => boolean;
  }[];
  CardContent: ComponentType<NodeCardProps>;
}

export interface BoardTypeDefinition {
  id: string;
  label: string;
  /**
   * The world's mark in the board browser (§3.4). A component rather than a name
   * so the world draws itself — core would otherwise have to keep a table of
   * which glyph means which world, which is exactly what it must not know (§1).
   */
  Icon: ComponentType<{ size?: string | number; className?: string }>;
  Canvas: ComponentType<BoardCanvasProps>;
  /** What an empty board of this world tells you to do — its furniture differs. */
  emptyHint: string;
  nodeTypes: Record<string, NodeTypeDefinition>;
  defaultNodeType: string;
  /**
   * Panel affordances core has to know about. Kept to what is actually read:
   * everything else a world wants to show or hide is decided by its own node
   * types, which is where the v1.5 registry put that decision.
   */
  panelFlags: {
    /** The walkthrough is map-only (v1.5 §7.5). */
    walkthrough: boolean;
  };
}
