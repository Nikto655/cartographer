import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type FinalConnectionState,
  type NodeMouseHandler,
  type OnNodeDrag,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { EdgeSide } from '@cartograph/shared';
import { DEFAULT_NODE_SIZE } from '@cartograph/shared';
import {
  absolutePosition,
  DEFAULT_FRAME_SIZE,
  isCard,
  isFrame,
  isText,
  useStore,
  type CGNode,
} from '@/shared/store';
import { canvasActions } from '@/shared/canvasActions';
import { useDrillDown } from '@/shared/subBoards';
import { Menu, MenuItem, MenuSeparator } from '@/shared/ui';
import type { BoardCanvasProps } from '@/board-types/types';
import { CartographNode } from './CartographNode';
import { CartographEdge } from './CartographEdge';
import { FrameNode } from './FrameNode';
import { TextNode } from './TextNode';
import { SelectionToolbar } from './SelectionToolbar';
import { ToolPill, type Tool } from './ToolPill';
import { MinimapToggle, ZoomPill } from '@/shared/ui/ZoomPill';
import { useCanvasKeyboard } from './useCanvasKeyboard';
import './canvas.css';

const nodeTypes = { cartograph: CartographNode, frame: FrameNode, text: TextNode };
const edgeTypes = { cartograph: CartographEdge };
const defaultEdgeOptions = {
  type: 'cartograph',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--edge-line)' },
};

/** React Flow's handle id, when it names one of the four faces and not something else. */
const sideOf = (handle: string | null | undefined): EdgeSide | undefined =>
  handle === 'top' || handle === 'right' || handle === 'bottom' || handle === 'left'
    ? handle
    : undefined;

const sizeOf = (node: CGNode) => ({
  width: node.width ?? node.measured?.width ?? DEFAULT_NODE_SIZE.width,
  height: node.height ?? node.measured?.height ?? DEFAULT_NODE_SIZE.height,
});

function CanvasInner({
  onExport,
  onPalette,
  snapToGrid,
  showMinimap,
  onToggleMinimap,
  readOnly,
}: BoardCanvasProps) {
  const flow = useReactFlow();
  const boardId = useStore((s) => s.board?.id ?? null);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const viewport = useStore((s) => s.viewport);
  /*
   * Opening a board frames it (v1.9). A remembered viewport is still written to
   * board.json and is still what the minimap and a mid-session re-render read,
   * but it is no longer where an *open* starts: coming in from the dashboard at
   * someone's last scroll position — or, on a board that had never been panned,
   * at the origin and 100% with the work off the corner — is the same puzzle
   * either way. Fit is the one opening that is right for every board.
   *
   * Waits for `useNodesInitialized`, because fitting before React Flow has
   * measured the nodes computes a box out of zeroes and lands nowhere. Keyed on
   * the board id so it happens once per open and never fights a pan.
   */
  const nodesInitialized = useNodesInitialized();
  const framedFor = useRef<string | null>(null);
  const onNodesChange = useStore((s) => s.onNodesChange);
  const onEdgesChange = useStore((s) => s.onEdgesChange);
  const setViewport = useStore((s) => s.setViewport);
  const connect = useStore((s) => s.connect);
  const createNode = useStore((s) => s.createNode);
  const createFrame = useStore((s) => s.createFrame);
  const createText = useStore((s) => s.createText);
  const setMembership = useStore((s) => s.setMembership);
  const openEditor = useStore((s) => s.openEditor);
  // Drilling in is core's gesture, and asking which world to make is part of it (§3.1).
  const { drill, picker } = useDrillDown();

  const [selection, setSelection] = useState<string[]>([]);
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; edgeId: string } | null>(null);
  const headsEdgeId = useStore((s) => s.headsEdgeId);
  const detached = useStore((s) => s.detached);
  /*
   * Working on a connector at all is enough to put a card's faces away, not
   * just moving its ends. A bend sits a standoff — seven units — off the card
   * it belongs to, so reaching for its grip means hovering right where that
   * card keeps its four dots, and they appear on top of the thing being aimed
   * at. A boolean, so the selector stays referentially stable.
   */
  const edgeSelected = useStore((s) => s.edges.some((e) => e.selected));
  const cancelDetach = useStore((s) => s.cancelDetach);
  const [armed, setArmed] = useState<Tool>('select');
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const absolute = useCallback(
    (node: CGNode) => {
      if (!node.parentId) return node.position;
      const parent = byId.get(node.parentId);
      return parent
        ? { x: node.position.x + parent.position.x, y: node.position.y + parent.position.y }
        : node.position;
    },
    [byId],
  );

  /** Topmost frame containing a point — frames don't nest in v1. */
  const frameAt = useCallback(
    (point: { x: number; y: number }) => {
      for (const frame of nodes.filter(isFrame)) {
        if (frame.data.collapsed) continue;
        const size = sizeOf(frame);
        if (
          point.x >= frame.position.x &&
          point.x <= frame.position.x + size.width &&
          point.y >= frame.position.y &&
          point.y <= frame.position.y + size.height
        ) {
          return frame.id;
        }
      }
      return undefined;
    },
    [nodes],
  );

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelection(params.nodes.map((n) => n.id));

    // With the panel open, selecting another node moves the panel to it.
    const state = useStore.getState();
    if (!state.openNodeId || params.nodes.length !== 1) return;
    const picked = params.nodes[0];
    if (picked.type === 'cartograph' && picked.id !== state.openNodeId) state.openEditor(picked.id);
  }, []);

  /** Right-click anywhere along an edge (§6.2). */
  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: { id: string }) => {
      event.preventDefault();
      // Every item in that menu edits the edge, so on a board you are only
      // viewing there is no menu to open (§5).
      if (readOnly) return;
      setEdgeMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
    },
    [readOnly],
  );

  /**
   * The two faces the drag actually used are the author's answer to "where
   * should this connector meet the cards", so they are kept. Dropping them here
   * was why a connector drawn deliberately from one face to another still slid
   * around both cards the moment either one moved: the intent existed for the
   * length of the gesture and was then thrown away, leaving the recomputed
   * default behind. React Flow names the handle it used; `sideOf` refuses
   * anything that is not one of the four faces so a rerouted or unnamed handle
   * leaves the end unpinned rather than pinned to a face that does not exist.
   */
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      connect(
        connection.source,
        connection.target,
        sideOf(connection.sourceHandle),
        sideOf(connection.targetHandle),
      );
    },
    [connect],
  );

  /** Dropping a link on empty canvas creates the next node, already linked (§7.2 v1.0). */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      /*
       * While an end is lifted, a card's faces are click targets. A click on
       * one still starts and cancels a connection underneath, which arrives
       * here as a drop on nothing — and this handler would answer it with a
       * new card. Placing an end is never a request for one.
       */
       if (useStore.getState().detached) return;
      if (readOnly || state.isValid || !state.fromNode) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      const position = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY });
      const source = byId.get(state.fromNode.id);
      void createNode(
        { x: position.x - 92, y: position.y - 38 },
        {
          connectFrom: state.fromNode.id,
          editing: true,
          variant: source && isCard(source) ? source.data.variant : undefined,
          frameId: frameAt(position),
        },
      );
    },
    [createNode, flow, frameAt, byId, readOnly],
  );

  // ---- tool placement (§4.5) ----
  const place = useCallback(
    (tool: Tool, client: { x: number; y: number }) => {
      const point = flow.screenToFlowPosition(client);
      if (tool === 'node' || tool === 'chip') {
        void createNode(
          { x: point.x - (tool === 'chip' ? 60 : 92), y: point.y - (tool === 'chip' ? 14 : 38) },
          { editing: true, variant: tool === 'chip' ? 'chip' : 'card', frameId: frameAt(point) },
        );
      } else if (tool === 'frame') {
        createFrame({ x: point.x - DEFAULT_FRAME_SIZE.width / 2, y: point.y - 40 });
      } else if (tool === 'text') {
        createText({ x: point.x, y: point.y - 12 });
      }
      setArmed('select');
    },
    [createFrame, createNode, createText, flow, frameAt],
  );

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      setConnectFrom(null);
      if (readOnly || armed === 'select' || armed === 'connector') return;
      place(armed, { x: event.clientX, y: event.clientY });
    },
    [armed, place, readOnly],
  );

  /**
   * Double-click always opens the panel, sub-maps included — drilling in is an
   * explicit act (the Sub-maps tab, the ▣ toolbar button, or `E`).
   */
  const onNodeDoubleClick: NodeMouseHandler<CGNode> = useCallback(
    (_event, node) => {
      if (isCard(node)) openEditor(node.id);
    },
    [openEditor],
  );

  const onNodeClick: NodeMouseHandler<CGNode> = useCallback(
    (event, node) => {
      if (readOnly) return;
      // A frame is a backdrop: placing over it should place, not select.
      if (armed !== 'select' && armed !== 'connector') {
        place(armed, { x: event.clientX, y: event.clientY });
        return;
      }
      /** Connector tool: click source, then target. */
      if (armed !== 'connector' || isFrame(node)) return;
      if (!connectFrom) {
        setConnectFrom(node.id);
        return;
      }
      if (connectFrom !== node.id) {
        /*
         * The connector tool never had handles to hand on — it is two clicks on
         * cards, not a drag between faces — so the faces are worked out here
         * with the same rule the renderer uses, and kept. Drawing a connector
         * and having it swing to the other side of the card on the next nudge
         * is the thing being fixed.
         */
        const a = byId.get(connectFrom);
        const b = byId.get(node.id);
        let from: EdgeSide | undefined;
        let to: EdgeSide | undefined;
        if (a && b) {
          const pa = absolute(a);
          const pb = absolute(b);
          const ca = { x: pa.x + sizeOf(a).width / 2, y: pa.y + sizeOf(a).height / 2 };
          const cb = { x: pb.x + sizeOf(b).width / 2, y: pb.y + sizeOf(b).height / 2 };
          const dx = cb.x - ca.x;
          const dy = cb.y - ca.y;
          const horizontal = Math.abs(dx) >= Math.abs(dy);
          from = horizontal ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
          to = horizontal ? (dx >= 0 ? 'left' : 'right') : dy >= 0 ? 'top' : 'bottom';
        }
        connect(connectFrom, node.id, from, to);
      }
      setConnectFrom(null);
      setArmed('select');
    },
    [armed, connectFrom, connect, place, readOnly, byId, absolute],
  );

  /** Containment: ≥50% inside a frame joins it, dragging out clears it (§4.1). */
  /**
   * One history entry per drag, taken before the first pixel moves. React Flow
   * gives us the gesture boundary; without it the alternative is guessing from
   * the change stream, which is what used to make ⌘Z rewind a mousemove.
   */
  const onNodeDragStart: OnNodeDrag<CGNode> = useCallback(() => {
    if (readOnly) return;
    useStore.getState().pushHistory();
  }, [readOnly]);

  const onNodeDragStop: OnNodeDrag<CGNode> = useCallback(
    (_event, dragged) => {
      /*
       * Frames do not nest, and a text is not a member of anything.
       *
       * `BoardText` has no `frameId`, so a text's membership cannot be stored —
       * but React Flow will happily accept a parent and start reporting the
       * node's position *relative* to it. That relative value was then saved as
       * though it were absolute, and on reload, with no parent to subtract, the
       * annotation reappeared somewhere else entirely. It looked like the save
       * had silently failed; it had actually saved the wrong number.
       *
       * A text is canvas furniture — a caption over a band, not a thing in it.
       * The model already says so by having nowhere to put the membership.
       */
      if (isFrame(dragged) || isText(dragged)) return;
      const node = useStore.getState().nodes.find((n) => n.id === dragged.id);
      if (!node) return;
      const pos = absolute(node);
      const size = sizeOf(node);
      const area = size.width * size.height;

      let bestFrame: string | null = null;
      let bestOverlap = 0;
      for (const frame of useStore.getState().nodes.filter(isFrame)) {
        if (frame.data.collapsed) continue;
        const fs = sizeOf(frame);
        const overlapX = Math.max(
          0,
          Math.min(pos.x + size.width, frame.position.x + fs.width) - Math.max(pos.x, frame.position.x),
        );
        const overlapY = Math.max(
          0,
          Math.min(pos.y + size.height, frame.position.y + fs.height) - Math.max(pos.y, frame.position.y),
        );
        const ratio = area > 0 ? (overlapX * overlapY) / area : 0;
        if (ratio >= 0.5 && ratio > bestOverlap) {
          bestOverlap = ratio;
          bestFrame = frame.id;
        }
      }

      if ((node.parentId ?? null) !== bestFrame) setMembership(node.id, bestFrame, pos);
    },
    [absolute, setMembership],
  );

  /** Anchored on the node itself, so the Map-or-Graph choice opens where you looked. */
  const handleExpand = useCallback(
    (nodeId: string) => {
      const internal = flow.getInternalNode(nodeId);
      const at = internal?.internals.positionAbsolute;
      drill(
        nodeId,
        at
          ? flow.flowToScreenPosition({ x: at.x, y: at.y + (internal.measured?.height ?? 0) + 8 })
          : undefined,
      );
    },
    [drill, flow],
  );

  useCanvasKeyboard({
    onExport,
    onPalette,
    onExpand: handleExpand,
    onArm: setArmed,
    // Leaves ⌘K and ⌘E — find and export read; everything else writes.
    disabled: readOnly,
  });

  useEffect(() => {
    if (readOnly) return;
    canvasActions.createAtCenter = () => {
      const center = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      void useStore.getState().createNode(
        { x: center.x - 92, y: center.y - 38 },
        { editing: true, frameId: frameAt(center) },
      );
    };
    canvasActions.focusNode = (nodeId: string) => {
      /*
       * Absolute position, not `node.position` — a node inside a frame stores
       * its position *relative to the frame*, so centring on the stored value
       * lands the viewport short by the frame's own offset. Measured on the
       * product-outline board: 1829 units out for a node in a frame near the
       * bottom, which is empty canvas.
       *
       * This is what `revealNode` calls, so it was every ⌘K jump and every
       * `[[wiki-link]]` click on a framed node — and it fails quietly, because
       * the node is still selected and its panel still opens. `handleExpand`
       * above already reads `positionAbsolute` for exactly this reason.
       */
      const nodes = useStore.getState().nodes;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      /*
       * The store's own answer, not React Flow's: `getInternalNode` needs the
       * node to be mounted and measured, and returns nothing when it is not —
       * which turned a wrong jump into no jump at all. `absolutePosition` is
       * derived from data we already hold and is always available.
       */
      const at = absolutePosition(node, new Map(nodes.map((n) => [n.id, n])));
      void flow.setCenter(at.x + 92, at.y + 38, { zoom: 1, duration: 240 });
    };
    // Core passes tool ids through as plain strings; the map owns the vocabulary.
    canvasActions.armTool = (tool) => setArmed(tool as Tool);
    return () => {
      delete canvasActions.createAtCenter;
      delete canvasActions.focusNode;
      delete canvasActions.armTool;
    };
  }, [flow, frameAt, readOnly]);

  const minimapColor = useMemo(
    () => (node: CGNode) => {
      if (isFrame(node)) return 'var(--bg-inset)';
      const color = (node.data as { color?: string }).color;
      return color ? `var(${color})` : 'var(--node-paper)';
    },
    [],
  );

  /**
   * Edges store only source/target (§4 v1.0). Which side they leave and enter is
   * presentation, derived from the current layout. Endpoints inside a collapsed
   * frame reroute to the frame card (§4.1).
   */
  const routedEdges = useMemo(() => {
    const hiddenToFrame = new Map<string, string>();
    for (const node of nodes) {
      if (node.hidden && node.parentId) hiddenToFrame.set(node.id, node.parentId);
    }

    const centres = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
      if (node.hidden) continue;
      const pos = absolute(node);
      const size = sizeOf(node);
      centres.set(node.id, { x: pos.x + size.width / 2, y: pos.y + size.height / 2 });
    }

    // An edge carries data when its source marks an output snippet — derived, so
    // it updates the moment an upstream output is marked or cleared (§6.1).
    const passing = new Map<string, boolean>();
    for (const n of nodes) {
      if (isCard(n)) passing.set(n.id, !!n.data.passesData);
    }

    const seen = new Set<string>();
    const out = [];
    for (const edge of edges) {
      const source = hiddenToFrame.get(edge.source) ?? edge.source;
      const target = hiddenToFrame.get(edge.target) ?? edge.target;
      if (source === target) continue; // collapsed into the same frame
      const key = `${source}->${target}`;
      if (hiddenToFrame.size && seen.has(key)) continue;
      seen.add(key);

      const from = centres.get(source);
      const to = centres.get(target);
      const rerouted = source !== edge.source || target !== edge.target;
      const withData = {
        ...edge,
        data: { ...(edge.data ?? {}), carriesData: passing.get(source) === true },
      };
      if (!from || !to) {
        out.push({ ...withData, source, target });
        continue;
      }
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      /*
       * A pinned end keeps its face wherever the cards go; an unpinned one is
       * recomputed every frame, which is what makes a connector slide around a
       * node as it is dragged. Rerouted ends are the exception: the edge is
       * being drawn to a collapsed frame rather than the node the author pinned,
       * so the pin describes a face that is not on screen.
       */
      const pins = edge.data as { sourceSide?: string; targetSide?: string } | undefined;
      const pinnedSource = rerouted ? undefined : pins?.sourceSide;
      const pinnedTarget = rerouted ? undefined : pins?.targetSide;
      out.push({
        ...withData,
        source,
        target,
        sourceHandle: pinnedSource ?? (horizontal ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top'),
        targetHandle: pinnedTarget ?? (horizontal ? (dx >= 0 ? 'left' : 'right') : dy >= 0 ? 'top' : 'bottom'),
        selectable: !rerouted,
      });
    }
    return out;
  }, [edges, nodes, absolute, headsEdgeId, readOnly]);

  useEffect(() => {
    if (!boardId || !nodesInitialized || framedFor.current === boardId) return;
    // An empty board has nothing to frame; leave it alone so the first node is
    // dropped where the canvas already is rather than under a jump.
    if (nodes.length === 0) return;
    framedFor.current = boardId;
    void flow.fitView({ padding: 0.2, duration: 0, maxZoom: 1 });
  }, [boardId, nodesInitialized, nodes.length, flow]);

  const armedClass = armed === 'select' ? '' : ` cg-canvas--armed cg-canvas--armed-${armed}`;
  // Connection handles are the last way in that is drawn rather than mounted;
  // React Flow already refuses to start a link, the class stops offering one.
  const modeClass =
    (readOnly ? ' cg-canvas--readonly' : '') +
    (headsEdgeId || edgeSelected ? ' cg-canvas--heads' : '') +
    (edgeSelected && !headsEdgeId ? ' cg-canvas--selected-only' : '') +
    (detached ? ' cg-canvas--attaching' : '');

  return (
    <div className={`cg-canvas${armedClass}${modeClass}`} ref={wrapper}>
      <ReactFlow
        nodes={nodes}
        edges={routedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onSelectionChange={onSelectionChange}
        onNodeClick={onNodeClick}
        onEdgeContextMenu={onEdgeContextMenu}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        onDoubleClick={(event: React.MouseEvent) => {
          if (readOnly) return;
          /*
           * Select means select. Double-clicking empty canvas used to make a
           * node whatever tool was armed, which turns a mis-aimed double click —
           * on the way to selecting something, or just twice on nothing — into
           * an untitled card. The node tool is one key away and says what it
           * will do; this was the same action without the warning.
           */
          if (armed === 'select') return;
          const target = event.target as HTMLElement;
          if (!target.classList.contains('react-flow__pane')) return;
          const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          void createNode(
            { x: position.x - 92, y: position.y - 38 },
            { editing: true, frameId: frameAt(position) },
          );
        }}
        onMoveEnd={(_e, vp) => setViewport(vp)}
        defaultViewport={viewport}
        connectionMode={ConnectionMode.Loose}
          connectionRadius={28}
        // Selection still works — reading a board means opening its nodes.
        // With Move armed a drag is a pan wherever it starts — a node that slid
        // out from under the hand would make the tool useless on a full board.
        nodesDraggable={!readOnly && armed !== 'pan'}
        /*
         * Belt and braces only — and worth being honest about which is which.
         * This prop does *not* disable the handles here: `isConnectable` is never
         * forwarded down to them, so each defaults to connectable, and it is the
         * CSS in `.cg-canvas--heads` that actually stops them competing for the
         * pointer. Do not "fix" that by forwarding it: a handle that is not
         * connectable is not a valid drop target either, which would make every
         * attempt to move an end fail rather than only the ones that miss.
         */
        nodesConnectable={!readOnly && !headsEdgeId}
        snapToGrid={snapToGrid}
        snapGrid={[8, 8]}
        panOnScroll
        selectionOnDrag={armed === 'select'}
        // Middle and right always pan; Move adds the left button to that list.
        panOnDrag={armed === 'pan' ? [0, 1, 2] : [1, 2]}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        multiSelectionKeyCode="Shift"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--dot-grid)" />
        {showMinimap && (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            offsetScale={4}
            maskColor="rgba(20,24,35,0.06)"
            nodeColor={minimapColor}
            nodeStrokeColor="var(--line-hair)"
          />
        )}
        {/* Every control on it changes something; there is nothing to show. */}
        {!readOnly && (
          <SelectionToolbar nodeIds={selection} onExpand={handleExpand} onOpenEditor={openEditor} />
        )}
      </ReactFlow>

      {edgeMenu && (
        <Menu anchor={{ x: edgeMenu.x, y: edgeMenu.y }} onClose={() => setEdgeMenu(null)}>
          <MenuItem
            onClick={() => {
              useStore.getState().setEditingEdge(edgeMenu.edgeId);
              setEdgeMenu(null);
            }}
          >
            Edit label
          </MenuItem>
          <MenuItem
            onClick={() => {
              const edge = useStore.getState().edges.find((e) => e.id === edgeMenu.edgeId);
              const dashed = (edge?.data as { style?: string } | undefined)?.style === 'dashed';
              useStore.getState().setEdgeStyle(edgeMenu.edgeId, dashed ? 'solid' : 'dashed');
              setEdgeMenu(null);
            }}
          >
            Toggle dashed
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            danger
            onClick={() => {
              useStore.getState().removeEdge(edgeMenu.edgeId);
              setEdgeMenu(null);
            }}
          >
            Delete edge
          </MenuItem>
        </Menu>
      )}

      {picker}

      <div className="chrome-layer">
        {/* The pill is the board's way in; the read-only banner takes its place. */}
        {!readOnly && (
          <div className="chrome-top-center">
            <ToolPill armed={armed} onArm={setArmed} onPlace={place} />
          </div>
        )}
        <div className="chrome-bottom-left">
          <ZoomPill />
        </div>
        <div className="chrome-bottom-right chrome-minimap-toggle">
          <MinimapToggle active={showMinimap} onToggle={onToggleMinimap} />
        </div>
      </div>
    </div>
  );
}

export function Canvas(props: BoardCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export { useCanvasKeyboard };
