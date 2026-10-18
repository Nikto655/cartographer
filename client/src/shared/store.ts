import { create } from 'zustand';
import type { Edge, Node, Viewport } from '@xyflow/react';
import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import type { EdgeChange, NodeChange } from '@xyflow/react';
import type {
  AppConfig,
  Board,
  BoardEdge,
  BoardFrame,
  BoardLink,
  BoardNode,
  BoardSummary,
  BoardText,
  BoardType,
  ClipboardSelection,
  CopyResult,
  EdgeShape,
  EdgeSide,
  EdgeStyle,
  Folder,
  FoldersFile,
  GraphNodeInput,
  NodeShape,
  NodeVariant,
  SharedBoardSummary,
} from '@cartograph/shared';
import {
  AUTOSAVE_GRAPH_MS,
  DEFAULT_NODE_SIZE,
  DEFAULT_SHAPE,
  DEFAULT_STATUS,
  linkKey,
} from '@cartograph/shared';
import { api, ApiError, setBoardScope } from './api';
import { currentOwner } from './router';
import { toast } from './ui/toast';
import { writeLocal } from './hooks';

// ---- canvas element types ----

export interface CanvasNodeData extends Record<string, unknown> {
  /** The node type within the board's world. Named apart from React Flow's own `node.type`. */
  nodeType?: string;
  title: string;
  description?: string;
  tags?: string[];
  showDescription?: boolean;
  shape: NodeShape;
  color?: string;
  status: string;
  childBoards?: string[];
  variant?: NodeVariant;
  hasData?: boolean;
  passesData?: boolean;
  coverage?: 'empty' | 'written';
  /** Agent provenance (v1.7 §4) — absent means a person drew it. */
  createdVia?: 'mcp';
  createdBy?: { token: string; at: string };
  /** Set right after drag-to-create so the title input mounts focused. */
  editing?: boolean;
}

export interface FrameNodeData extends Record<string, unknown> {
  title: string;
  color?: string;
  collapsed?: boolean;
  /** Expanded footprint — kept while collapsed so expand restores it exactly. */
  size: { width: number; height: number };
  editing?: boolean;
}

export interface TextNodeData extends Record<string, unknown> {
  text: string;
  size: 'sm' | 'md' | 'lg';
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  editing?: boolean;
}

export type TextStyleFlag = 'bold' | 'italic' | 'underline';

export type CardNode = Node<CanvasNodeData, 'cartograph'>;
export type FrameNode = Node<FrameNodeData, 'frame'>;
export type TextNode = Node<TextNodeData, 'text'>;
export type CGNode = CardNode | FrameNode | TextNode;
export type CGEdge = Edge;

export const isCard = (node: CGNode): node is CardNode => node.type === 'cartograph';
export const isFrame = (node: CGNode): node is FrameNode => node.type === 'frame';
export const isText = (node: CGNode): node is TextNode => node.type === 'text';

export const COLLAPSED_FRAME_SIZE = { width: 248, height: 68 };
/** Enough for a title plus ~3 description lines (v1.3 §3.2). */
export const DESCRIBED_NODE_HEIGHT = 116;
export const DEFAULT_FRAME_SIZE = { width: 380, height: 280 };
export const FRAME_PADDING = 32;
export const FRAME_HEADER = 40;

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

/**
 * The app clipboard (v1.6 §6.2): a reference to what was copied, never the
 * content. No file passes through the browser — on paste the server reads the
 * source directories itself, which is also why this survives a reload of the
 * board it points at and why an OS clipboard could never have done the job.
 *
 * `sourceOwnerId` is null for your own board. It rides along because the source
 * may be a board somebody shared with you, and the server has to know whose
 * workspace to look in before it can decide whether you may copy out of it.
 */
export interface Clipboard {
  sourceBoardId: string;
  sourceOwnerId: string | null;
  nodeIds: string[];
  frameIds: string[];
}

interface HistoryEntry {
  nodes: CGNode[];
  edges: CGEdge[];
}

interface StoreState {
  config: AppConfig | null;
  summaries: BoardSummary[];
  /**
   * Boards other people have shared with you (v1.6 §5). Kept beside the
   * summaries because it answers the same question the dashboard asks — what can
   * I open — and because the viewer reads it to know whose board it is on and
   * whether the share allows a copy.
   */
  shared: SharedBoardSummary[];
  /**
   * Your own boards that you have shared, board id → recipient display names.
   * Kept apart from `summaries` because a share is a database fact and a summary
   * describes a file; the card just reads both.
   */
  sharedByMe: Record<string, string[]>;
  /**
   * How the shelf is arranged (v1.8 §1). Organisation metadata, not storage —
   * a board's directory never moves. Kept whole because that is how it is
   * written: one small file, read and PUT entire.
   *
   * Membership itself is read off `BoardSummary.folderId`, which the server
   * merges during the scan. These three are here so a mutation can build the
   * next version of the file, not as a second source of truth about which
   * board sits where.
   */
  folders: Folder[];
  assignments: Record<string, string>;
  favorites: string[];
  board: Board | null;
  nodes: CGNode[];
  edges: CGEdge[];
  /**
   * Every `[[…]]` occurrence on the board (v1.5 §4.1). Seeded from the server on
   * load and kept current as notes are typed, so a link is live before any
   * reload. `targetId` is deliberately not trusted here — titles are resolved
   * against the canvas as it stands (see shared/links.ts).
   */
  links: BoardLink[];
  viewport: Viewport;
  saveStatus: SaveStatus;
  openNodeId: string | null;
  editingEdgeId: string | null;
  /**
   * The connector whose heads are grabbable (§4.4). One at a time and off by
   * default: an end that is always draggable competes with selecting the edge,
   * and nothing on screen would say it could be dragged. Turning it on is the
   * pill button, so the affordance and the mode arrive together.
   */
  headsEdgeId: string | null;
  history: HistoryEntry[];
  future: HistoryEntry[];
  loading: boolean;
  /**
   * This board is somebody else's, opened read-only (v1.6 §5). The server is
   * what actually refuses the writes; this is the client half of the same
   * decision, and it lives here rather than in the components because a hidden
   * button is not a disabled code path — every action below that would change
   * the board returns before it starts.
   */
  readonly: boolean;
  /** Whose workspace is on screen — null is your own. Half of `setWorkspace`. */
  workspaceOwner: string | null;
  /**
   * What `Ctrl+C` last picked up (§6.2). Deliberately not touched by `openBoard`
   * or `closeBoard`: the clipboard outliving the board it came from is the whole
   * point of pasting into a different one. Cleared on sign-out and nowhere else.
   */
  clipboard: Clipboard | null;

  loadConfig: () => Promise<void>;
  loadSummaries: () => Promise<void>;
  loadShared: () => Promise<void>;
  loadFolders: () => Promise<void>;
  createFolder: (name: string, color?: string) => Promise<void>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  recolorFolder: (folderId: string, color?: string) => Promise<void>;
  /** Boards inside it return to Unfiled; nothing on disk moves (§2). */
  deleteFolder: (folderId: string) => Promise<void>;
  /** `null` unfiles. Sub-boards follow their parent and are never assigned (§1). */
  assignBoards: (boardIds: string[], folderId: string | null) => Promise<void>;
  setFavorite: (boardIds: string[], favorite: boolean) => Promise<void>;
  /** Whose workspace the app is looking at — null is your own (v1.6 §5). */
  setWorkspace: (ownerId: string | null) => void;
  /** Re-read the open board after something changed it elsewhere. */
  refreshBoard: () => Promise<void>;
  openBoard: (id: string) => Promise<void>;
  closeBoard: () => void;

  /** Re-file one node's mentions after its notes changed. Core: both worlds parse. */
  setNodeLinks: (nodeId: string, titles: string[]) => void;

  onNodesChange: (changes: NodeChange<CGNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<CGEdge>[]) => void;
  setViewport: (viewport: Viewport) => void;

  createNode: (
    position: { x: number; y: number },
    options?: {
      title?: string;
      connectFrom?: string;
      editing?: boolean;
      variant?: NodeVariant;
      frameId?: string;
    },
  ) => Promise<string | null>;
  /**
   * Draw a connector. The faces are the ones the person actually dragged
   * between, and they are kept: having chosen where it leaves and where it
   * arrives, watching it swing round to the other side of the card the moment
   * anything moves is not what was asked for. Unpin from the pill to get the
   * following behaviour back.
   */
  connect: (source: string, target: string, sourceSide?: EdgeSide, targetSide?: EdgeSide) => void;
  setEdgeLabel: (edgeId: string, label: string) => void;
  setEdgeStyle: (edgeId: string, style: EdgeStyle) => void;
  setEdgeShape: (edgeId: string, shape: EdgeShape) => void;
  /**
   * Where an angled connector's bends sit — the whole list, since dragging one
   * fixes the others where they already are rather than leaving holes.
   *
   * The phase matters more than it looks. A save during the drag comes back as
   * a board change, which rebuilds the edges — and a rebuilt edge is a new
   * element, which drops the pointer capture the gesture is holding. So the
   * whole drag is silent: `start` takes the undo entry, `move` only redraws,
   * and nothing is written until `end`.
   */
  setEdgeBends: (edgeId: string, bends: number[], phase?: 'start' | 'move' | 'end') => void;
  /** Lock both ends to the faces they are using right now. */
  pinEdgeSides: (edgeId: string, source: EdgeSide, target: EdgeSide) => void;
  /** Let both ends follow the cards again. */
  unpinEdgeSides: (edgeId: string) => void;
  removeEdge: (edgeId: string) => void;
  patchNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
  renameNode: (nodeId: string, title: string) => Promise<string | null>;
  setStatus: (nodeIds: string[], status: string) => void;
  cycleStatus: (nodeIds: string[]) => void;
  setShape: (nodeIds: string[], shape: NodeShape) => void;
  setColor: (nodeIds: string[], color?: string) => void;
  toggleVariant: (nodeIds: string[]) => void;
  nudge: (nodeIds: string[], dx: number, dy: number) => void;
  /** §6.1 — any selection: one node, several, frames with their contents. */
  duplicateSelection: (ids: string[]) => Promise<void>;
  duplicateNode: (nodeId: string) => Promise<void>;
  copySelection: (ids: string[]) => void;
  /** §6.2 — `center` is where the group lands, in flow coordinates. */
  pasteClipboard: (center: { x: number; y: number }) => Promise<void>;
  archiveNodes: (nodeIds: string[]) => Promise<void>;
  expandIntoBoard: (
    nodeId: string,
    options?: { name?: string; boardType?: BoardType; label?: string },
  ) => Promise<string | null>;
  linkSubBoard: (nodeId: string, childId: string) => Promise<void>;
  unlinkSubBoard: (nodeId: string, childId: string) => Promise<void>;
  refreshNodeFlags: (
    nodeId: string,
    flags: { hasData?: boolean; passesData?: boolean; coverage?: 'empty' | 'written' },
  ) => void;
  setShowDescription: (nodeId: string, show: boolean) => void;

  // frames & texts (v1.1)
  createFrame: (position: { x: number; y: number }, size?: { width: number; height: number }) => string;
  wrapSelectionInFrame: () => string | null;
  toggleFrameCollapse: (frameId: string) => void;
  archiveFrame: (frameId: string) => void;
  setMembership: (nodeId: string, frameId: string | null, absolute: { x: number; y: number }) => void;
  promoteFrame: (frameId: string) => Promise<string | null>;
  createText: (position: { x: number; y: number }, size?: 'sm' | 'md' | 'lg') => string;
  setTextSize: (nodeIds: string[], size: 'sm' | 'md' | 'lg') => void;
  toggleTextStyle: (nodeIds: string[], flag: TextStyleFlag) => void;

  openEditor: (nodeId: string | null) => void;
  setEditingEdge: (edgeId: string | null) => void;
  setHeadsEdge: (edgeId: string | null) => void;
  /**
   * An end that has been lifted off its card and is waiting to be put somewhere
   * (§4.4). Click an end to lift it, click a face to set it down — two clicks,
   * each with a target you can see, and nothing that depends on holding a drag
   * steady across a card boundary.
   */
  detached: { edgeId: string; end: 'source' | 'target' } | null;
  detachEnd: (edgeId: string, end: 'source' | 'target') => void;
  /** Put the lifted end on this face of this card. */
  attachEnd: (nodeId: string, side: EdgeSide) => void;
  cancelDetach: () => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  scheduleSave: () => void;
  saveNow: () => Promise<void>;
  /**
   * The tab is going away: send what is unsaved as a request the browser will
   * finish after the page is gone. False when it could not be sent that way —
   * the graph is over the keepalive cap — and the page should ask to stay.
   */
  saveBeforeUnload: () => boolean;
}

// ---- board <-> react-flow mapping ----

function frameToFlow(frame: BoardFrame): FrameNode {
  const collapsed = !!frame.collapsed;
  return {
    id: frame.id,
    type: 'frame',
    position: frame.position,
    width: collapsed ? COLLAPSED_FRAME_SIZE.width : frame.size.width,
    height: collapsed ? COLLAPSED_FRAME_SIZE.height : frame.size.height,
    // Frames sit behind everything and never capture selection clicks on their body.
    zIndex: -1,
    data: { title: frame.title, color: frame.color, collapsed, size: frame.size },
  };
}

function cardToFlow(node: BoardNode, frames: Map<string, BoardFrame>): CardNode {
  const frame = node.frameId ? frames.get(node.frameId) : undefined;
  // A chip is as big as its title: leaving width/height unset lets React Flow
  // measure the pill, so handles and the selection ring hug it (not the card box).
  const isChip = node.variant === 'chip';
  return {
    id: node.id,
    type: 'cartograph',
    // Members are positioned relative to their frame so group drag is free.
    position: frame
      ? { x: node.position.x - frame.position.x, y: node.position.y - frame.position.y }
      : node.position,
    parentId: frame?.id,
    hidden: frame?.collapsed || undefined,
    width: isChip ? undefined : (node.size?.width ?? DEFAULT_NODE_SIZE.width),
    height: isChip ? undefined : (node.size?.height ?? DEFAULT_NODE_SIZE.height),
    data: {
      nodeType: node.type,
      title: node.title,
      description: node.description,
      tags: node.tags,
      showDescription: node.showDescription,
      shape: node.shape ?? DEFAULT_SHAPE,
      color: node.color,
      status: node.status ?? DEFAULT_STATUS,
      childBoards: node.childBoards,
      variant: node.variant ?? 'card',
      hasData: node.hasData,
      passesData: node.passesData,
      coverage: node.coverage,
      createdVia: node.createdVia,
      createdBy: node.createdBy,
    },
  };
}

function textToFlow(text: BoardText): TextNode {
  return {
    id: text.id,
    type: 'text',
    position: text.position,
    /*
     * Width only, and only when it was dragged. Left undefined React Flow
     * measures the box from the words, which is what an untouched text has
     * always done. Height is never set: the text is what decides it, so giving
     * the node one would fix a box the words then overflow or rattle around in.
     */
    width: text.width,
    data: {
      text: text.text,
      size: text.size ?? 'md',
      bold: text.bold,
      italic: text.italic,
      underline: text.underline,
    },
  };
}

/** Frames first: React Flow requires a parent to precede its children. */
export function boardToFlow(board: Board): CGNode[] {
  const frames = new Map((board.frames ?? []).map((f) => [f.id, f]));
  return [
    ...(board.frames ?? []).map(frameToFlow),
    ...board.nodes.map((n) => cardToFlow(n, frames)),
    ...(board.texts ?? []).map(textToFlow),
  ];
}

/** Flow frames back into the BoardFrame shape `cardToFlow` expects. */
function frameIndex(nodes: CGNode[]): Map<string, BoardFrame> {
  return new Map(
    nodes.filter(isFrame).map((f) => [
      f.id,
      {
        id: f.id,
        title: f.data.title,
        position: f.position,
        size: f.data.size,
        color: f.data.color,
        collapsed: f.data.collapsed,
      },
    ]),
  );
}

/**
 * A framed node's `position` is relative to its frame — see CLAUDE.md. Exported
 * because anything that reasons about where a node *is* on the canvas needs
 * this, not `node.position`: `focusNode` used the raw value and centred the
 * viewport short by the frame's offset, which on a tall board is empty canvas.
 */
export function absolutePosition(node: CGNode, byId: Map<string, CGNode>): { x: number; y: number } {
  if (!node.parentId) return node.position;
  const parent = byId.get(node.parentId);
  if (!parent) return node.position;
  return { x: node.position.x + parent.position.x, y: node.position.y + parent.position.y };
}

function splitFlow(nodes: CGNode[]): {
  nodes: GraphNodeInput[];
  frames: BoardFrame[];
  texts: BoardText[];
} {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const frames: BoardFrame[] = [];
  const cards: GraphNodeInput[] = [];
  const texts: BoardText[] = [];

  for (const node of nodes) {
    if (isFrame(node)) {
      frames.push({
        id: node.id,
        title: node.data.title,
        position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
        // While collapsed the rendered box is a card; the stored footprint stays expanded.
        size: node.data.collapsed
          ? node.data.size
          : {
              width: Math.round(node.width ?? node.data.size.width),
              height: Math.round(node.height ?? node.data.size.height),
            },
        color: node.data.color,
        collapsed: node.data.collapsed || undefined,
      });
    } else if (isText(node)) {
      // Absolute, like a card's — `node.position` is relative whenever React Flow
      // has given the node a parent, and a text that had somehow acquired one
      // saved its frame-relative coordinates as though they were absolute. It
      // then reappeared elsewhere on reload, which reads as "the save didn't
      // work" rather than "the save wrote the wrong number". Texts no longer
      // join frames at all (see the map canvas's drag-stop), so this is the
      // second line of defence rather than the fix.
      const absolute = absolutePosition(node, byId);
      texts.push({
        id: node.id,
        text: node.data.text,
        position: { x: Math.round(absolute.x), y: Math.round(absolute.y) },
        size: node.data.size,
        /*
         * `node.width` is the one somebody dragged; `node.measured.width` is the
         * one the browser worked out from the words. Only the first is stored —
         * writing the measured value would freeze every text at whatever width
         * it happened to have the first time the board was saved, and it would
         * never grow with its own text again.
         */
        width: node.width ? Math.round(node.width) : undefined,
        bold: node.data.bold,
        italic: node.data.italic,
        underline: node.data.underline,
      });
    } else {
      const absolute = absolutePosition(node, byId);
      cards.push({
        id: node.id,
        title: node.data.title,
        position: { x: Math.round(absolute.x), y: Math.round(absolute.y) },
        size: {
          width: Math.round(node.width ?? node.measured?.width ?? DEFAULT_NODE_SIZE.width),
          height: Math.round(node.height ?? node.measured?.height ?? DEFAULT_NODE_SIZE.height),
        },
        shape: node.data.shape,
        color: node.data.color,
        status: node.data.status,
        childBoards: node.data.childBoards,
        variant: node.data.variant === 'chip' ? 'chip' : undefined,
        frameId: node.parentId,
        showDescription: node.data.showDescription,
        // Attribution is stored in board.json rather than computed (v1.7 §4), so
        // it has to survive the round trip — a canvas save must not quietly
        // launder an agent's node into a human one.
        createdVia: node.data.createdVia,
        createdBy: node.data.createdBy,
      });
    }
  }

  return { nodes: cards, frames, texts };
}

function toFlowEdge(edge: BoardEdge): CGEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: 'cartograph',
    // The pins ride in `data` rather than as React Flow's own handle fields:
    // the canvas recomputes those every frame from where the cards are, and
    // anything it sets there would be overwritten. These are the author's
    // intent; the handles are this frame's consequence of it.
    data: {
      style: edge.style ?? 'solid',
      sourceSide: edge.sourceSide,
      targetSide: edge.targetSide,
      shape: edge.shape ?? 'curved',
      bends: edge.bends,
    },
  };
}

function toBoardEdge(edge: CGEdge): BoardEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: typeof edge.label === 'string' ? edge.label : undefined,
    style: (edge.data?.style as EdgeStyle) === 'dashed' ? 'dashed' : undefined,
    sourceSide: edge.data?.sourceSide as EdgeSide | undefined,
    targetSide: edge.data?.targetSide as EdgeSide | undefined,
    shape: (edge.data?.shape as EdgeShape) === 'angled' ? 'angled' : undefined,
    bends: Array.isArray(edge.data?.bends) ? (edge.data.bends as number[]) : undefined,
  };
}

const clone = (entry: HistoryEntry): HistoryEntry => ({
  nodes: entry.nodes.map((n) => ({ ...n, data: { ...n.data } })) as CGNode[],
  edges: entry.edges.map((e) => ({ ...e })),
});

let idSeq = 0;
const localId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(idSeq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// ---- autosave plumbing ----

/** The open board's live-change stream, and a refresh the save path owes. */
/** Only the newest `loadSummaries` may answer; see the call site. */
let summariesGeneration = 0;

let liveStream: EventSource | null = null;
let pendingRefresh = false;
/**
 * The open board's save bookkeeping, one object per opening. Module-level beside
 * the timers because none of it is state a component renders.
 *
 * It is an object rather than loose variables because a save can outlive the
 * board it belongs to. Leaving a board flushes its pending edits, and that write
 * is still on the wire when the next board has loaded — so it must keep its own
 * board's id, workspace and base, and must not stamp the new board's `updatedAt`,
 * mark it saved, or put a conflict banner over it. `line !== target` is how a
 * save asks whether the board it was writing is still the one on screen.
 */
interface SaveLine {
  boardId: string;
  /** Whose workspace, bound when the board opened; see `api.saveGraph`. */
  ownerId: string | null;
  /**
   * The `updatedAt` the canvas last agreed with the server about — set when the
   * board is read and after every save that lands. Sent with the next save so a
   * write built on a board that has since moved on is refused rather than applied.
   */
  base: string | null;
  /**
   * The write on the wire, if any. The next one waits for it, so writes land in
   * the order they were made and each carries the base the last one returned.
   * Two at once could reach the server in either order, and the older layout
   * would win.
   */
  inflight: Promise<void> | null;
  /** Writes started, so a landing write knows whether a newer one followed it. */
  issued: number;
  /** The `issued` of the last keepalive write, so `pagehide` after `beforeunload` sends nothing twice. */
  unloadSent: number;
  /** The server refused this copy; nothing built on it may be sent. */
  refused: boolean;
}
let line: SaveLine | null = null;
let saveTimer: number | undefined;
let retryTimer: number | undefined;

/**
 * Browsers cap the bodies of in-flight keepalive requests at 64 KiB per page, and
 * refuse one that would cross it. Leave a little headroom under that.
 */
const KEEPALIVE_LIMIT = 63 * 1024;

/**
 * Send the canvas as it stands. The payload is built *now*, synchronously,
 * whatever happens after — that is what lets `closeBoard` and `openBoard` flush
 * a board in the same tick they clear it, and what binds a queued write to the
 * board it was made on rather than the one on screen when it finally goes out.
 *
 * `unloading` is the tab going away. Nothing after this tick will run, so the
 * write cannot wait its turn behind one already on the wire; it goes at once,
 * as keepalive, carrying everything. If the earlier write lands first, this one
 * replaces it with a superset; it was sent first and is all but certain to.
 * `durable` is false when the browser cannot be trusted to finish it — a body
 * over the keepalive cap — and the caller should ask the person to stay.
 */
function startSave(
  get: () => StoreState,
  set: (partial: Partial<StoreState>) => void,
  unloading = false,
): { done: Promise<void>; durable: boolean } {
  const idle = { done: Promise.resolve(), durable: true };
  const state = get();
  const target = line;
  if (state.readonly || !state.board || !target || target.boardId !== state.board.id) return idle;
  if (target.refused) return idle;
  const status = state.saveStatus;
  if (status === 'saved' || status === 'idle' || status === 'conflict') return idle;
  /*
   * 'saving' means the newest canvas is already on the wire — an edit since
   * would have made it 'dirty'. Ordinarily that write is enough; on unload it
   * is an ordinary fetch the browser is about to abort, so send it again,
   * once, as one that survives.
   */
  if (status === 'saving' && (!unloading || target.unloadSent === target.issued)) {
    return { done: target.inflight ?? Promise.resolve(), durable: true };
  }
  if (saveTimer) window.clearTimeout(saveTimer);
  if (retryTimer) window.clearTimeout(retryTimer);

  const { board, nodes, edges, viewport } = state;
  const graph = splitFlow(nodes);
  const payload = {
    nodes: graph.nodes,
    edges: edges.map(toBoardEdge),
    frames: graph.frames,
    texts: graph.texts,
    viewport,
  };
  const seq = ++target.issued;
  let keepalive = false;
  if (unloading) {
    target.unloadSent = seq;
    keepalive = new Blob([JSON.stringify(payload)]).size <= KEEPALIVE_LIMIT;
  }
  set({ saveStatus: 'saving' });

  const send = async () => {
    if (target.refused) return;
    try {
      const written = await api.saveGraph(
        target.boardId,
        { ...payload, baseUpdatedAt: target.base ?? undefined },
        target.ownerId,
        keepalive,
      );
      // Our copy is now the server's copy; the next save is measured from here.
      target.base = written.updatedAt ?? target.base;
      if (line !== target) return;
      // A newer write is queued behind this one, or an edit is waiting on the
      // timer; either way "saved" would be a claim about a canvas we have not sent.
      if (seq === target.issued && get().saveStatus === 'saving') set({ saveStatus: 'saved' });
      // Something arrived while we were mid-edit and the refresh stood down so
      // it would not discard the work; now that the work is on disk, take it.
      if (pendingRefresh) void get().refreshBoard();
    } catch (err) {
      const here = line === target;
      /*
       * A refusal is not a failure to retry. 409 means the board changed under
       * us and this copy can never be written — retrying would either fail
       * forever or, worse, succeed against a base that has drifted again. Stop,
       * and put a warning on screen that says what is safe and what is not.
       */
      if (err instanceof ApiError && err.status === 409) {
        target.refused = true;
        if (!here) {
          toast(`“${board.name}” was not saved: ${err.message}`);
          return;
        }
        if (saveTimer) window.clearTimeout(saveTimer);
        if (retryTimer) window.clearTimeout(retryTimer);
        pendingRefresh = false;
        set({ saveStatus: 'conflict' });
        return;
      }
      // A board already left has no status light to turn red, so say so.
      if (!here) {
        toast(`“${board.name}” was not saved: ${(err as Error).message}`);
        return;
      }
      // Anything else is the volume being unreachable — keep trying.
      set({ saveStatus: 'error' });
      retryTimer = window.setTimeout(() => void get().saveNow(), 3000);
    }
  };

  const ahead = unloading ? null : target.inflight;
  const done = ahead ? ahead.then(send) : send();
  target.inflight = done;
  void done.finally(() => {
    if (target.inflight === done) target.inflight = null;
  });
  return { done, durable: !unloading || keepalive };
}
const HISTORY_LIMIT = 100;

/**
 * Undo/redo swaps whole graph snapshots, so a step can resurrect a node that the
 * server has archived, or drop one whose files still exist. Files are the
 * database, so the volume is brought back in step before the graph is saved.
 * Frames and texts have no files and are skipped.
 */
async function reconcileFiles(get: () => StoreState, from: CGNode[], to: CGNode[]): Promise<void> {
  const board = get().board;
  if (!board) return;
  const before = new Set(from.filter(isCard).map((n) => n.id));
  const after = new Set(to.filter(isCard).map((n) => n.id));

  try {
    for (const node of to.filter(isCard)) {
      if (before.has(node.id)) continue;
      const restored = await api.restoreNode(board.id, node.id, {
        position: node.position,
        size: {
          width: node.width ?? DEFAULT_NODE_SIZE.width,
          height: node.height ?? DEFAULT_NODE_SIZE.height,
        },
        shape: node.data.shape,
        color: node.data.color,
        childBoards: node.data.childBoards,
      });
      get().refreshNodeFlags(node.id, { hasData: restored.hasData, coverage: restored.coverage });
    }
    for (const node of from.filter(isCard)) {
      if (after.has(node.id)) continue;
      await api.archiveNode(board.id, node.id);
    }
  } catch (err) {
    toast((err as Error).message);
  } finally {
    get().scheduleSave();
  }
}

// ---- clipboard helpers (§6) ----

/**
 * A canvas selection is a flat list of ids; the server needs to know which of
 * them have files behind them. Texts are dropped: they carry no file, no edge
 * and no membership, so there is nothing for the server to copy.
 */
function splitSelection(nodes: CGNode[], ids: string[]): ClipboardSelection {
  const selected = nodes.filter((node) => ids.includes(node.id));
  return {
    nodeIds: selected.filter(isCard).map((n) => n.id),
    frameIds: selected.filter(isFrame).map((n) => n.id),
  };
}

/**
 * A copy lands as a whole board: it can add nodes, frames and edges at once, and
 * the server has just written the authoritative version of all three. Rebuilding
 * from it — with the copies selected, as §6.1 asks — is one source of truth
 * rather than a client-side replay of what the server did.
 */
function adopted(result: CopyResult): Partial<StoreState> {
  const fresh = new Set([...result.nodeIds, ...result.frameIds]);
  return {
    board: result.board,
    nodes: boardToFlow(result.board).map((node) => ({ ...node, selected: fresh.has(node.id) })) as CGNode[],
    edges: result.board.edges.map(toFlowEdge),
    links: result.board.links ?? [],
    saveStatus: 'saved',
  };
}

function countLabel(selection: ClipboardSelection, verb: string): string {
  const parts = [
    selection.nodeIds.length && `${selection.nodeIds.length} node${selection.nodeIds.length > 1 ? 's' : ''}`,
    selection.frameIds.length && `${selection.frameIds.length} frame${selection.frameIds.length > 1 ? 's' : ''}`,
  ].filter(Boolean);
  return `${parts.join(' · ')} ${verb}`;
}


/**
 * Every folder mutation goes through here (v1.8 §7): the file is written whole,
 * so each one builds the next version and hands it over.
 *
 * Optimistic, because dropping a card on a folder should land instantly. On
 * failure the previous file goes back — a dashboard that silently kept a move
 * the server refused would be lying about where a board lives. `undoTo` turns
 * the toast into an undo, which the spec asks for on every assignment path (§2).
 */
async function writeFolders(
  get: () => StoreState,
  set: (partial: Partial<StoreState>) => void,
  next: FoldersFile,
  message?: string,
  undoTo?: FoldersFile,
): Promise<void> {
  const previous: FoldersFile = {
    folders: get().folders,
    assignments: get().assignments,
    favorites: get().favorites,
  };
  set({ folders: next.folders, assignments: next.assignments, favorites: next.favorites });
  try {
    const saved = await api.putFolders(next);
    set({ folders: saved.folders, assignments: saved.assignments, favorites: saved.favorites });
    // `folderId` and `favorite` are merged server-side, so the cards only learn
    // about the change by asking again.
    await get().loadSummaries();
    if (message) {
      toast(
        message,
        undoTo ? { label: 'Undo', run: () => void writeFolders(get, set, undoTo) } : undefined,
      );
    }
  } catch (err) {
    set({
      folders: previous.folders,
      assignments: previous.assignments,
      favorites: previous.favorites,
    });
    toast((err as Error).message);
  }
}

export const useStore = create<StoreState>((set, get) => ({
  config: null,
  summaries: [],
  shared: [],
  sharedByMe: {},
  folders: [],
  assignments: {},
  favorites: [],
  board: null,
  nodes: [],
  edges: [],
  links: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  saveStatus: 'idle',
  openNodeId: null,
  editingEdgeId: null,
  headsEdgeId: null,
  detached: null,
  history: [],
  future: [],
  loading: false,
  readonly: false,
  workspaceOwner: null,
  clipboard: null,

  loadConfig: async () => {
    if (get().config) return;
    try {
      set({ config: await api.getConfig() });
    } catch {
      toast('Could not load config');
    }
  },

  loadSummaries: async () => {
    /*
     * Two of these can be in flight at once — the dashboard asks on mount while
     * App asks again for the same visit — so the newest call is the only one
     * allowed to answer. Without this an older response could still land last
     * and repaint the shelf with a list nothing on screen asked for.
     */
    const generation = ++summariesGeneration;
    try {
      const summaries = await api.listBoards(currentOwner());
      if (generation !== summariesGeneration) return;
      set({ summaries });
    } catch {
      /* dashboard renders its own error state */
    }
  },

  /**
   * Never scoped and never cached: a revoked share has to disappear the next
   * time anything asks, and asking is one small request.
   */
  loadShared: async () => {
    try {
      // Both directions of sharing refresh together — they answer one question.
      const [shared, sharedByMe] = await Promise.all([api.sharedWithMe(), api.myShares()]);
      set({ shared, sharedByMe });
    } catch {
      /* a section that cannot load simply isn't shown */
    }
  },


  /**
   * The whole file, read whole (v1.8 §7). Cheap enough to refetch after every
   * mutation, which is what keeps `assignments` here and `folderId` on the
   * summaries from ever disagreeing.
   */
  loadFolders: async () => {
    try {
      const file = await api.getFolders();
      set({ folders: file.folders, assignments: file.assignments, favorites: file.favorites });
    } catch {
      /* the dashboard renders without folders rather than not at all */
    }
  },

  createFolder: async (name, color) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { folders, assignments, favorites } = get();
    await writeFolders(get, set, {
      // Minted here rather than waiting for the server so the optimistic render
      // has a stable key; the server keeps an id it is given.
      folders: [
        ...folders,
        { id: `folder-${crypto.randomUUID()}`, name: trimmed, color, order: folders.length },
      ],
      assignments,
      favorites,
    });
  },

  renameFolder: async (folderId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { folders, assignments, favorites } = get();
    await writeFolders(get, set, {
      folders: folders.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)),
      assignments,
      favorites,
    });
  },

  recolorFolder: async (folderId, color) => {
    const { folders, assignments, favorites } = get();
    await writeFolders(get, set, {
      folders: folders.map((f) => (f.id === folderId ? { ...f, color } : f)),
      assignments,
      favorites,
    });
  },

  /**
   * The folder goes; the boards do not. Their assignments are dropped, which
   * returns them to Unfiled — nothing on disk moves, because nothing on disk
   * ever knew about the folder (§2).
   */
  deleteFolder: async (folderId) => {
    const { folders, assignments, favorites } = get();
    await writeFolders(get, set, {
      folders: folders.filter((f) => f.id !== folderId),
      assignments: Object.fromEntries(
        Object.entries(assignments).filter(([, id]) => id !== folderId),
      ),
      favorites,
    });
  },

  assignBoards: async (boardIds, folderId) => {
    const { folders, assignments, favorites } = get();
    const previous: FoldersFile = { folders, assignments, favorites };
    const nextAssignments = { ...assignments };
    for (const boardId of boardIds) {
      if (folderId) nextAssignments[boardId] = folderId;
      else delete nextAssignments[boardId];
    }
    const where = folderId ? folders.find((f) => f.id === folderId)?.name : null;
    const count = boardIds.length === 1 ? '' : ` ${boardIds.length} boards`;
    await writeFolders(
      get,
      set,
      { folders, assignments: nextAssignments, favorites },
      where ? `Moved${count} to ${where}` : `Removed${count} from folder`,
      previous,
    );
  },

  setFavorite: async (boardIds, favorite) => {
    const { folders, assignments, favorites } = get();
    const starred = new Set(favorites);
    for (const boardId of boardIds) {
      if (favorite) starred.add(boardId);
      else starred.delete(boardId);
    }
    await writeFolders(get, set, { folders, assignments, favorites: [...starred] });
  },

  /**
   * Both halves of "whose board is this" move together: the URLs the API
   * addresses and the flag every mutator checks are the same fact, and letting
   * them drift is exactly how a read-only viewer starts writing.
   */
  setWorkspace: (ownerId) => {
    /*
     * Runs before `openBoard` on every route change, and turns `readonly` on for
     * a shared board — so leaving your own board for somebody else's must flush
     * here, while the board on screen is still allowed to save.
     */
    if (get().workspaceOwner !== ownerId) void startSave(get, set).done;
    setBoardScope(ownerId);
    if (get().workspaceOwner !== ownerId) set({ workspaceOwner: ownerId });
    if (get().readonly !== !!ownerId) set({ readonly: !!ownerId });
  },

  /**
   * Pull the board again because something changed underneath us.
   *
   * Deliberately a refetch rather than applying a diff: the files are the one
   * description of a board, and a patch computed on the client is a second one
   * that can drift. Selection, viewport and the open panel are carried across,
   * because none of them is the server's to have an opinion about — losing your
   * place every time an agent writes would be its own bug.
   *
   * Refuses to run while there is unsaved work. A refetch mid-edit would throw
   * away what you just did, which is the very failure this whole mechanism
   * exists to prevent; `saveNow` calls back here once the write lands.
   */
  refreshBoard: async () => {
    const state = get();
    const current = state.board;
    if (!current || state.loading) return;
    /*
     * Never refetch over a conflict. The local copy holds edits the server has
     * refused, so replacing it is precisely the data loss the guard exists to
     * prevent — and the person has been told to rescue them and reload.
     */
    if (state.saveStatus === 'conflict') return;
    if (state.saveStatus === 'dirty' || state.saveStatus === 'saving') {
      pendingRefresh = true;
      return;
    }
    pendingRefresh = false;
    try {
      const board = await api.getBoard(current.id);
      // The board went away, or the app moved on while the request was in
      // flight — either way this answer is no longer about what is on screen.
      if (get().board?.id !== current.id) return;
      /*
       * And the same question the guard above asked, asked again on this side of
       * the await. Creating a node writes the board, so the change event for it
       * arrives *while the POST is still in flight* — this refresh starts when
       * there is nothing unsaved, and lands a moment after the new node has been
       * put on the canvas and marked dirty. Applying it then replaced the canvas
       * with a copy of the file that does not know the node is a chip yet, which
       * is exactly why a chip could be drawn and never appear.
       */
      const now = get().saveStatus;
      if (now === 'dirty' || now === 'saving' || now === 'conflict') {
        pendingRefresh = now !== 'conflict';
        return;
      }
      const selected = new Set(get().nodes.filter((n) => n.selected).map((n) => n.id));
      /*
       * Edges keep their selection across a refresh for the same reason nodes do
       * above, and it took a control on a selected edge to notice they did not.
       * A refresh lands on every save, including the one the gesture itself just
       * made — so dragging a connector's shoulder dropped the selection, and
       * with it the pill and the grip, the instant the write came back. It read
       * as "I can move it once and then it disappears".
       */
      const selectedEdges = new Set(get().edges.filter((e) => e.selected).map((e) => e.id));
      if (line?.boardId === board.id) line.base = board.updatedAt ?? null;
      set({
        board,
        nodes: boardToFlow(board).map((node) =>
          selected.has(node.id) ? { ...node, selected: true } : node,
        ),
        edges: board.edges
          .map(toFlowEdge)
          .map((edge) => (selectedEdges.has(edge.id) ? { ...edge, selected: true } : edge)),
        links: board.links ?? [],
        saveStatus: 'idle',
      });
    } catch {
      // A failed refresh leaves the stale view standing, which is what was on
      // screen a moment ago — noisier to toast about than to leave alone.
    }
  },

  openBoard: async (id) => {
    /*
     * Whatever the board on screen has not saved goes now, before anything is
     * replaced. Every way of leaving a board ends up here or in `closeBoard` —
     * the palette, a breadcrumb, a drill-down, the walkthrough, the back button —
     * so this is the one place that cannot be forgotten. Reopening the *same*
     * board waits for that write, or the read below could predate it.
     */
    const flushed = startSave(get, set).done;
    if (get().board?.id === id) await flushed;
    set({ loading: true });
    try {
      const board = await api.getBoard(id);
      line = {
        boardId: board.id,
        ownerId: get().workspaceOwner,
        base: board.updatedAt ?? null,
        inflight: null,
        issued: 0,
        unloadSent: -1,
        refused: false,
      };
      set({
        board,
        nodes: boardToFlow(board),
        edges: board.edges.map(toFlowEdge),
        links: board.links ?? [],
        viewport: board.viewport ?? { x: 0, y: 0, zoom: 1 },
        history: [],
        future: [],
        openNodeId: null,
        saveStatus: 'idle',
        loading: false,
      });
      writeLocal('cartograph.lastBoard', id);
      void get().loadSummaries();
      /*
       * Watch for changes made anywhere else — another tab, or an agent over
       * MCP. Without this the canvas holds the state it loaded with, and the
       * next autosave writes that stale copy back over whatever arrived in the
       * meantime; a node an agent added is dropped by omission and its file is
       * orphaned. Reproduced exactly that way before this existed.
       */
      liveStream?.close();
      const stream = api.boardEvents(id);
      stream.addEventListener('board', () => void get().refreshBoard());
      liveStream = stream;
    } catch (err) {
      line = null;
      set({ loading: false, board: null });
      toast((err as Error).message);
    }
  },

  closeBoard: () => {
    // Flush before clearing, for the reason `openBoard` gives. The write keeps
    // its own copy of the board, so clearing the store under it is safe.
    void startSave(get, set).done;
    line = null;
    liveStream?.close();
    liveStream = null;
    pendingRefresh = false;
    if (saveTimer) window.clearTimeout(saveTimer);
    set({ board: null, nodes: [], edges: [], links: [], openNodeId: null, history: [], future: [] });
  },

  setNodeLinks: (nodeId, titles) =>
    set((state) => ({
      links: [
        ...state.links.filter((link) => link.sourceId !== nodeId),
        ...titles.map((targetTitle) => ({ sourceId: nodeId, targetTitle, targetId: null })),
      ],
    })),

  onNodesChange: (changes) => {
    const persists = changes.some(
      (c) =>
        (c.type === 'position' && c.dragging === false) ||
        // React Flow also emits `dimensions` when it merely measures a node on
        // mount; only a real resize should dirty the board.
        (c.type === 'dimensions' && c.resizing === true) ||
        c.type === 'remove' ||
        c.type === 'add',
    );
    /*
     * History for a drag or a resize is pushed by the *gesture* handlers —
     * `onNodeDragStart` on each canvas and `onResizeStart` on the resizers —
     * not from here.
     *
     * It used to be done here, on any change carrying `dragging: true`, guarded
     * by `saveStatus !== 'dirty'`. That guard was doing two jobs and failing
     * both: `dragging: true` arrives on every mousemove, and a drag does not
     * dirty the board until it ends, so a drag on a clean board pushed one entry
     * per mousemove (⌘Z then rewound a few pixels), while a drag on a board with
     * anything unsaved pushed none at all (⌘Z skipped the move entirely).
     * A gesture has a start; that is the thing to hang an undo entry on.
     */
    set({ nodes: applyNodeChanges<CGNode>(changes, get().nodes) });
    if (persists) get().scheduleSave();
  },

  onEdgesChange: (changes) => {
    const persists = changes.some((c) => c.type === 'remove' || c.type === 'add');
    if (persists) get().pushHistory();
    set({ edges: applyEdgeChanges<CGEdge>(changes, get().edges) });
    if (persists) get().scheduleSave();
  },

  /*
   * Where you are looking is remembered, but looking is not a change.
   *
   * This used to `scheduleSave()`, which meant a pan or a zoom wrote the whole
   * board back and stamped `updatedAt` — so opening a map, scrolling to read it
   * and leaving pushed it to the top of Recent as if it had been edited, and
   * every such write was another chance for an open tab to clobber something a
   * second writer had done meanwhile.
   *
   * The viewport still persists: `saveNow` reads it from the store at send time,
   * so it rides along with the next real change. What is lost is the pan you
   * made and never followed with an edit — a fair trade for a recency list that
   * means what it says.
   */
  setViewport: (viewport) => set({ viewport }),

  createNode: async (position, options) => {
    if (get().readonly) return null;
    const board = get().board;
    if (!board) return null;
    get().pushHistory();
    try {
      const created = await api.createNode(board.id, {
        title: options?.title ?? 'Untitled',
        position,
      });
      const node = cardToFlow(
        { ...created, variant: options?.variant, frameId: options?.frameId },
        frameIndex(get().nodes),
      );
      node.selected = true;
      if (options?.editing) node.data.editing = true;

      set((state) => ({
        nodes: [...state.nodes.map((n) => ({ ...n, selected: false })), node] as CGNode[],
      }));

      if (options?.connectFrom) get().connect(options.connectFrom, created.id);
      get().scheduleSave();
      return created.id;
    } catch (err) {
      toast((err as Error).message);
      return null;
    }
  },

  connect: (source, target, sourceSide, targetSide) => {
    if (get().readonly) return;
    if (source === target) return;
    const exists = get().edges.some((e) => e.source === source && e.target === target);
    if (exists) return;
    get().pushHistory();
    const edge: CGEdge = {
      id: localId('edge'),
      source,
      target,
      type: 'cartograph',
      data: { style: 'solid', sourceSide, targetSide },
    };
    set((state) => ({ edges: [...state.edges, edge] }));
    get().scheduleSave();
  },

  setEdgeLabel: (edgeId, label) => {
    if (get().readonly) return;
    get().pushHistory();
    set((state) => ({
      edges: state.edges.map((e) => (e.id === edgeId ? { ...e, label: label || undefined } : e)),
    }));
    get().scheduleSave();
  },

  setEdgeShape: (edgeId, shape) => {
    if (get().readonly) return;
    get().pushHistory();
    /*
     * Changing the shape forgets the bends. They describe turns that only exist
     * in one of the two shapes, so keeping them means a connector switched to
     * curved and back silently reappears in a shape nobody can see it is still
     * holding — and the toggle stops meaning "start again". Undo has the old
     * positions if they were wanted.
     */
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === edgeId ? { ...e, data: { ...(e.data ?? {}), shape, bends: undefined } } : e,
      ),
    }));
    get().scheduleSave();
  },

  setEdgeBends: (edgeId, bends, phase = 'end') => {
    if (get().readonly) return;
    // Not clamped, here or on the server: a bend goes where it is put. The route
    // is built so that no value can make the connector meet a card from inside,
    // which is what a limit would otherwise have been protecting.
    const value = bends.map((n) => Math.round(n * 100) / 100);
    if (phase === 'start') get().pushHistory();
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === edgeId ? { ...e, data: { ...(e.data ?? {}), bends: value } } : e,
      ),
    }));
    if (phase === 'end') get().scheduleSave();
  },

  setEdgeStyle: (edgeId, style) => {
    if (get().readonly) return;
    get().pushHistory();
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === edgeId ? { ...e, data: { ...(e.data ?? {}), style } } : e,
      ),
    }));
    get().scheduleSave();
  },

  pinEdgeSides: (edgeId, source, target) => {
    if (get().readonly) return;
    get().pushHistory();
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === edgeId ? { ...e, data: { ...(e.data ?? {}), sourceSide: source, targetSide: target } } : e,
      ),
    }));
    get().scheduleSave();
  },

  unpinEdgeSides: (edgeId) => {
    if (get().readonly) return;
    get().pushHistory();
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === edgeId
          ? { ...e, data: { ...(e.data ?? {}), sourceSide: undefined, targetSide: undefined } }
          : e,
      ),
    }));
    get().scheduleSave();
  },

  removeEdge: (edgeId) => {
    if (get().readonly) return;
    get().pushHistory();
    set((state) => ({ edges: state.edges.filter((e) => e.id !== edgeId) }));
    get().scheduleSave();
    toast('Edge deleted', { label: 'Undo', run: () => get().undo() });
  },

  patchNodeData: (nodeId, patch) => {
    // Guarded like every other mutator: today's callers all sit behind an
    // editing flag that read-only forces off, but the store's own rule is that
    // nothing here changes a board you are only looking at.
    if (get().readonly) return;
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? ({ ...n, data: { ...n.data, ...patch } } as CGNode) : n,
      ),
    }));
  },

  renameNode: async (nodeId, title) => {
    if (get().readonly) return null;
    const board = get().board;
    if (!board) return null;
    const trimmed = title.trim();
    if (!trimmed) return null;
    const previous = get().nodes.find((n) => n.id === nodeId);
    const oldTitle = previous && isCard(previous) ? previous.data.title : '';

    get().pushHistory();
    get().patchNodeData(nodeId, { title: trimmed, editing: false });

    try {
      const result = await api.patchNode(board.id, nodeId, { title: trimmed });
      const newId = result.node.id;
      // The rename rewrote `[[Old]]` → `[[New]]` in the files (§4.1); the live
      // cache follows, or the old title would linger as an unresolved mention.
      set((state) => ({
        links: state.links.map((link) => ({
          sourceId: link.sourceId === nodeId ? newId : link.sourceId,
          targetTitle: linkKey(link.targetTitle) === linkKey(oldTitle) ? trimmed : link.targetTitle,
          targetId: null,
        })),
      }));
      if (newId !== nodeId) {
        set((state) => ({
          nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, id: newId } : n)) as CGNode[],
          edges: state.edges.map((e) => ({
            ...e,
            source: e.source === nodeId ? newId : e.source,
            target: e.target === nodeId ? newId : e.target,
          })),
          openNodeId: state.openNodeId === nodeId ? newId : state.openNodeId,
        }));
      }
      return newId;
    } catch (err) {
      toast((err as Error).message);
      return null;
    }
  },

  setStatus: (nodeIds, status) => {
    if (get().readonly) return;
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) =>
        nodeIds.includes(n.id) && isCard(n) ? { ...n, data: { ...n.data, status } } : n,
      ) as CGNode[],
    }));
    get().scheduleSave();
  },

  cycleStatus: (nodeIds) => {
    if (get().readonly) return;
    const statuses = get().config?.statuses ?? [];
    if (!statuses.length) return;
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (!nodeIds.includes(n.id) || !isCard(n)) return n;
        const index = statuses.findIndex((s) => s.id === n.data.status);
        const next = statuses[(index + 1 + statuses.length) % statuses.length];
        return { ...n, data: { ...n.data, status: next.id } };
      }) as CGNode[],
    }));
    get().scheduleSave();
  },

  setShape: (nodeIds, shape) => {
    if (get().readonly) return;
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) =>
        nodeIds.includes(n.id) && isCard(n) ? { ...n, data: { ...n.data, shape } } : n,
      ) as CGNode[],
    }));
    get().scheduleSave();
  },

  setColor: (nodeIds, color) => {
    if (get().readonly) return;
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) =>
        nodeIds.includes(n.id) && (isCard(n) || isFrame(n))
          ? ({ ...n, data: { ...n.data, color } } as CGNode)
          : n,
      ) as CGNode[],
    }));
    get().scheduleSave();
  },

  /** Card ↔ chip. Same file, same everything — only the rendering changes (§4.2). */
  toggleVariant: (nodeIds) => {
    if (get().readonly) return;
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (!nodeIds.includes(n.id) || !isCard(n)) return n;
        const nextVariant: NodeVariant = n.data.variant === 'chip' ? 'card' : 'chip';
        return {
          ...n,
          width: nextVariant === 'chip' ? undefined : DEFAULT_NODE_SIZE.width,
          height: nextVariant === 'chip' ? undefined : DEFAULT_NODE_SIZE.height,
          data: { ...n.data, variant: nextVariant },
        };
      }) as CGNode[],
    }));
    get().scheduleSave();
  },

  nudge: (nodeIds, dx, dy) => {
    if (get().readonly) return;
    if (!nodeIds.length) return;
    set((state) => ({
      nodes: state.nodes.map((n) =>
        nodeIds.includes(n.id)
          ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
          : n,
      ) as CGNode[],
    }));
    get().scheduleSave();
  },

  duplicateSelection: async (ids) => {
    if (get().readonly) return;
    const board = get().board;
    const selection = splitSelection(get().nodes, ids);
    // A frame on its own is a real selection: the server brings its members (§6.1).
    if (!board || (!selection.nodeIds.length && !selection.frameIds.length)) return;
    // Positions live on the canvas until autosave fires; the server copies files,
    // so it has to be looking at the layout the user can see.
    await get().saveNow();
    get().pushHistory();
    try {
      const result = await api.duplicateSelection(board.id, selection);
      set(adopted(result));
      // Counted off the result, not the request: duplicating a frame duplicates
      // members that were never selected.
      toast(countLabel(result, 'duplicated'));
    } catch (err) {
      toast((err as Error).message);
    }
  },

  /** The single-node case the toolbar and the editor still ask for by name. */
  duplicateNode: async (nodeId) => get().duplicateSelection([nodeId]),

  /**
   * Copy is a read: it takes nothing but ids, so it is offered on a board you
   * may only look at. Whether that copy may then be *pasted* is the server's
   * call, made against the share row when the paste arrives (§6.2).
   */
  copySelection: (ids) => {
    const board = get().board;
    const selection = splitSelection(get().nodes, ids);
    if (!board || (!selection.nodeIds.length && !selection.frameIds.length)) return;
    set({ clipboard: { sourceBoardId: board.id, sourceOwnerId: get().workspaceOwner, ...selection } });
    toast(countLabel(selection, 'copied'));
  },

  pasteClipboard: async (center) => {
    if (get().readonly) return;
    const board = get().board;
    const clipboard = get().clipboard;
    if (!board) return;
    if (!clipboard) return toast('Nothing on the clipboard yet');
    await get().saveNow();
    get().pushHistory();
    try {
      const result = await api.paste(board.id, {
        sourceBoardId: clipboard.sourceBoardId,
        sourceOwnerId: clipboard.sourceOwnerId ?? undefined,
        nodeIds: clipboard.nodeIds,
        frameIds: clipboard.frameIds,
        position: center,
      });
      set(adopted(result));
      toast(countLabel(result, 'pasted'));
    } catch (err) {
      toast((err as Error).message);
    }
  },

  archiveNodes: async (nodeIds) => {
    if (get().readonly) return;
    const board = get().board;
    if (!board || !nodeIds.length) return;

    // Frames and texts are board.json-only; nodes have files behind them.
    const all = get().nodes;
    const frameIds = nodeIds.filter((id) => all.some((n) => n.id === id && isFrame(n)));
    const textIds = nodeIds.filter((id) => all.some((n) => n.id === id && isText(n)));
    const cardIds = nodeIds.filter((id) => all.some((n) => n.id === id && isCard(n)));

    if (cardIds.length) await get().saveNow();
    get().pushHistory();

    if (frameIds.length || textIds.length) {
      set((state) => ({
        nodes: state.nodes
          .filter((n) => !frameIds.includes(n.id) && !textIds.includes(n.id))
          .map((n) =>
            n.parentId && frameIds.includes(n.parentId)
              ? { ...n, parentId: undefined, position: absolutePosition(n, new Map(state.nodes.map((x) => [x.id, x]))) }
              : n,
          ) as CGNode[],
      }));
      get().scheduleSave();
    }

    if (!cardIds.length) {
      if (frameIds.length) toast(frameIds.length === 1 ? 'Frame removed' : 'Frames removed', {
        label: 'Undo',
        run: () => get().undo(),
      });
      return;
    }

    try {
      for (const id of cardIds) await api.archiveNode(board.id, id);
      set((state) => ({
        nodes: state.nodes.filter((n) => !cardIds.includes(n.id)),
        edges: state.edges.filter((e) => !cardIds.includes(e.source) && !cardIds.includes(e.target)),
        openNodeId: state.openNodeId && cardIds.includes(state.openNodeId) ? null : state.openNodeId,
      }));
      toast(cardIds.length === 1 ? 'Node archived' : `${cardIds.length} nodes archived`, {
        label: 'Undo',
        run: () => get().undo(),
      });
    } catch (err) {
      toast((err as Error).message);
    }
  },

  expandIntoBoard: async (nodeId, options) => {
    if (get().readonly) return null;
    const board = get().board;
    if (!board) return null;
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node || !isCard(node)) return null;

    await get().saveNow();
    try {
      const child = await api.createBoard({
        name: options?.name?.trim() || node.data.title,
        // Absent = the server's default world, which is what every sub-board was
        // before a node could hold either kind (§3.1).
        boardType: options?.boardType,
        parentBoard: board.id,
        parentNode: nodeId,
      });
      get().patchNodeData(nodeId, {
        childBoards: [...(node.data.childBoards ?? []), child.id],
      });
      void get().loadSummaries();
      // The caller names the world; core only repeats what it was told.
      toast(`${options?.label ?? 'Sub-map'} created`);
      return child.id;
    } catch (err) {
      toast((err as Error).message);
      return null;
    }
  },

  /** Adopts an existing board as this node's sub-board (server moves the parent ref). */
  linkSubBoard: async (nodeId, childId) => {
    if (get().readonly) return;
    const board = get().board;
    if (!board) return;
    await get().saveNow();
    try {
      const node = await api.linkSubBoard(board.id, nodeId, childId);
      get().patchNodeData(nodeId, { childBoards: node.childBoards });
      void get().loadSummaries();
      toast('Sub-board linked');
    } catch (err) {
      toast((err as Error).message);
    }
  },

  /** Drops the link only — the board itself stays, at top level. */
  unlinkSubBoard: async (nodeId, childId) => {
    if (get().readonly) return;
    const board = get().board;
    if (!board) return;
    await get().saveNow();
    try {
      const node = await api.unlinkSubBoard(board.id, nodeId, childId);
      get().patchNodeData(nodeId, { childBoards: node.childBoards ?? [] });
      void get().loadSummaries();
      toast('Sub-board unlinked · it is now top-level');
    } catch (err) {
      toast((err as Error).message);
    }
  },

  refreshNodeFlags: (nodeId, flags) => get().patchNodeData(nodeId, flags),

  setShowDescription: (nodeId, show) => {
    if (get().readonly) return;
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || !isCard(node)) return node;
        // Grow a default-sized card to fit the description; a resized card keeps its size.
        const height = node.height ?? DEFAULT_NODE_SIZE.height;
        const grown =
          show && height <= DEFAULT_NODE_SIZE.height ? DESCRIBED_NODE_HEIGHT : height;
        return { ...node, height: grown, data: { ...node.data, showDescription: show } };
      }) as CGNode[],
    }));
    get().scheduleSave();
  },

  // ---- frames (§4.1) ----

  createFrame: (position, size) => {
    if (get().readonly) return '';
    get().pushHistory();
    const id = localId('frame');
    const footprint = size ?? DEFAULT_FRAME_SIZE;
    const frame: FrameNode = {
      id,
      type: 'frame',
      position,
      width: footprint.width,
      height: footprint.height,
      zIndex: -1,
      selected: true,
      data: { title: 'Section', size: footprint, editing: true },
    };
    // Frames must precede their children in the node array.
    set((state) => ({ nodes: [frame, ...state.nodes.map((n) => ({ ...n, selected: false }))] as CGNode[] }));
    get().scheduleSave();
    return id;
  },

  wrapSelectionInFrame: () => {
    if (get().readonly) return null;
    const selected = get().nodes.filter((n) => n.selected && !isFrame(n));
    if (!selected.length) return null;
    const byId = new Map(get().nodes.map((n) => [n.id, n]));

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of selected) {
      const pos = absolutePosition(node, byId);
      const width = node.width ?? node.measured?.width ?? DEFAULT_NODE_SIZE.width;
      const height = node.height ?? node.measured?.height ?? DEFAULT_NODE_SIZE.height;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + width);
      maxY = Math.max(maxY, pos.y + height);
    }

    const position = { x: minX - FRAME_PADDING, y: minY - FRAME_PADDING - FRAME_HEADER };
    const size = {
      width: maxX - minX + FRAME_PADDING * 2,
      height: maxY - minY + FRAME_PADDING * 2 + FRAME_HEADER,
    };

    get().pushHistory();
    const id = localId('frame');
    const frame: FrameNode = {
      id,
      type: 'frame',
      position,
      width: size.width,
      height: size.height,
      zIndex: -1,
      data: { title: 'Section', size, editing: true },
    };
    const memberIds = new Set(selected.filter(isCard).map((n) => n.id));

    set((state) => ({
      nodes: [
        frame,
        ...state.nodes.map((node) => {
          if (!memberIds.has(node.id)) return { ...node, selected: false };
          const absolute = absolutePosition(node, byId);
          return {
            ...node,
            selected: false,
            parentId: id,
            position: { x: absolute.x - position.x, y: absolute.y - position.y },
          };
        }),
      ] as CGNode[],
    }));
    get().scheduleSave();
    return id;
  },

  toggleFrameCollapse: (frameId) => {
    if (get().readonly) return;
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id === frameId && isFrame(node)) {
          const collapsed = !node.data.collapsed;
          return {
            ...node,
            width: collapsed ? COLLAPSED_FRAME_SIZE.width : node.data.size.width,
            height: collapsed ? COLLAPSED_FRAME_SIZE.height : node.data.size.height,
            data: { ...node.data, collapsed },
          };
        }
        if (node.parentId === frameId) {
          const frame = state.nodes.find((n) => n.id === frameId) as FrameNode | undefined;
          const collapsed = !frame?.data.collapsed;
          return { ...node, hidden: collapsed || undefined, selected: false };
        }
        return node;
      }) as CGNode[],
    }));
    get().scheduleSave();
  },

  archiveFrame: (frameId) => {
    if (get().readonly) return;
    get().pushHistory();
    const byId = new Map(get().nodes.map((n) => [n.id, n]));
    set((state) => ({
      nodes: state.nodes
        .filter((n) => n.id !== frameId)
        .map((n) =>
          n.parentId === frameId
            ? { ...n, parentId: undefined, hidden: undefined, position: absolutePosition(n, byId) }
            : n,
        ) as CGNode[],
    }));
    get().scheduleSave();
    toast('Frame removed · members kept', { label: 'Undo', run: () => get().undo() });
  },

  /** Containment: called on drag stop with the node's absolute position. */
  setMembership: (nodeId, frameId, absolute) => {
    if (get().readonly) return;
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId) return node;
        if (!frameId) return { ...node, parentId: undefined, position: absolute };
        const frame = state.nodes.find((n) => n.id === frameId);
        if (!frame) return node;
        return {
          ...node,
          parentId: frameId,
          position: { x: absolute.x - frame.position.x, y: absolute.y - frame.position.y },
        };
      }) as CGNode[],
    }));
    get().scheduleSave();
  },

  promoteFrame: async (frameId) => {
    if (get().readonly) return null;
    const board = get().board;
    if (!board) return null;
    await get().saveNow();
    try {
      const result = await api.promoteFrame(board.id, frameId);
      set({
        board: result.board,
        nodes: boardToFlow(result.board),
        edges: result.board.edges.map(toFlowEdge),
        history: [],
        future: [],
        saveStatus: 'saved',
      });
      void get().loadSummaries();
      toast('Frame promoted · snapshot taken first');
      return result.childBoardId;
    } catch (err) {
      toast((err as Error).message);
      return null;
    }
  },

  // ---- text labels (§4.3) ----

  createText: (position, size = 'md') => {
    if (get().readonly) return '';
    get().pushHistory();
    const id = localId('text');
    const node: TextNode = {
      id,
      type: 'text',
      position,
      selected: true,
      data: { text: '', size, editing: true },
    };
    set((state) => ({
      nodes: [...state.nodes.map((n) => ({ ...n, selected: false })), node] as CGNode[],
    }));
    return id;
  },

  setTextSize: (nodeIds, size) => {
    if (get().readonly) return;
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) =>
        nodeIds.includes(n.id) && isText(n) ? { ...n, data: { ...n.data, size } } : n,
      ) as CGNode[],
    }));
    get().scheduleSave();
  },

  /** Bold / italic / underline. Mixed selections turn on, uniform ones toggle off. */
  toggleTextStyle: (nodeIds, flag) => {
    if (get().readonly) return;
    const targets = get().nodes.filter((n) => nodeIds.includes(n.id) && isText(n)) as TextNode[];
    if (!targets.length) return;
    const next = !targets.every((n) => n.data[flag]);

    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) =>
        nodeIds.includes(n.id) && isText(n)
          ? { ...n, data: { ...n.data, [flag]: next || undefined } }
          : n,
      ) as CGNode[],
    }));
    get().scheduleSave();
  },

  openEditor: (nodeId) => {
    if (nodeId === null) return set({ openNodeId: null });
    // Only nodes have files behind them; frames and texts live in board.json.
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node || !isCard(node)) return;
    set({ openNodeId: nodeId });
  },

  setEditingEdge: (edgeId) => set({ editingEdgeId: edgeId }),
  setHeadsEdge: (edgeId) => set({ headsEdgeId: edgeId, detached: null }),

  detachEnd: (edgeId, end) => {
    if (get().readonly) return;
    set({ detached: { edgeId, end } });
  },

  cancelDetach: () => set({ detached: null }),

  attachEnd: (nodeId, side) => {
    const held = get().detached;
    if (!held || get().readonly) return;
    const edge = get().edges.find((e) => e.id === held.edgeId);
    if (!edge) {
      set({ detached: null });
      return;
    }
    // A connector from a card to itself is not a thing this canvas draws, so
    // the click is refused rather than obeyed into a shape nothing renders.
    const other = held.end === 'source' ? edge.target : edge.source;
    if (other === nodeId) return;

    get().pushHistory();
    const key = held.end === 'source' ? 'sourceSide' : 'targetSide';
    set((state) => ({
      detached: null,
      edges: state.edges.map((e) =>
        e.id === held.edgeId
          ? {
              ...e,
              source: held.end === 'source' ? nodeId : e.source,
              target: held.end === 'target' ? nodeId : e.target,
              // Where it was put down is where it stays.
              data: { ...(e.data ?? {}), [key]: side },
            }
          : e,
      ),
    }));
    get().scheduleSave();
  },

  pushHistory: () => {
    const { nodes, edges, history } = get();
    const entry = clone({ nodes, edges });
    set({ history: [...history, entry].slice(-HISTORY_LIMIT), future: [] });
  },

  undo: () => {
    if (get().readonly) return;
    const { history, nodes, edges, future } = get();
    const previous = history[history.length - 1];
    if (!previous) return;
    set({
      history: history.slice(0, -1),
      future: [...future, clone({ nodes, edges })].slice(-HISTORY_LIMIT),
      nodes: previous.nodes,
      edges: previous.edges,
      // Dirty from the same synchronous swap, not from reconcileFiles' finally:
      // until the restore round-trip lands, the server still says the node is
      // archived, and a change event from the archive write arriving in that
      // window passes refreshBoard's stand-down guards and rebuilds the canvas
      // without the node just brought back. Local latency hides the window;
      // a deployment's does not.
      saveStatus: 'dirty',
    });
    void reconcileFiles(get, nodes, previous.nodes);
  },

  redo: () => {
    if (get().readonly) return;
    const { future, nodes, edges, history } = get();
    const next = future[future.length - 1];
    if (!next) return;
    set({
      future: future.slice(0, -1),
      history: [...history, clone({ nodes, edges })].slice(-HISTORY_LIMIT),
      nodes: next.nodes,
      edges: next.edges,
      // Same window as undo: see the comment there.
      saveStatus: 'dirty',
    });
    void reconcileFiles(get, nodes, next.nodes);
  },

  scheduleSave: () => {
    if (get().readonly) return;
    // Once the server has refused this copy, every later save is built on the
    // same stale base and would be refused too. Stop, and leave the warning up.
    if (get().saveStatus === 'conflict') return;
    set({ saveStatus: 'dirty' });
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void get().saveNow(), AUTOSAVE_GRAPH_MS);
  },

  saveNow: () => startSave(get, set).done,

  saveBeforeUnload: () => startSave(get, set, true).durable,
}));

if (import.meta.env.DEV) {
  (window as unknown as { __cartograph?: unknown }).__cartograph = useStore;
}

/** Convenience selectors. */