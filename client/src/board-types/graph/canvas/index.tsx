import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type FinalConnectionState,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { isCard, useStore, type CGNode } from '@/shared/store';
import { canvasActions } from '@/shared/canvasActions';
import { useDrillDown } from '@/shared/subBoards';
import { Menu, MenuItem, MenuSeparator } from '@/shared/ui';
import type { BoardCanvasProps } from '@/board-types/types';
import { createSimulation, type GraphSimulation, type SimSeat } from '../simulation';
import { MIN_DOT, dotSize } from '../geometry';
import { isGhostId, useDerivedLayer } from '../links';
import { groupColors } from '../grouping';
import { ControlsPanel, useGraphControls } from '../controls';
import { EntityNode } from './EntityNode';
import { EntityEdge } from './EntityEdge';
import { DerivedEdge } from './DerivedEdge';
import { GhostNode, type GhostFlowNode } from './GhostNode';
import { ZoomPill } from '@/shared/ui/ZoomPill';
import { useGraphKeyboard } from './useGraphKeyboard';
import './graph.css';

/*
 * The store labels every card `cartograph` and every edge `cartograph`; which
 * component that maps to is each world's own business. Ghosts and derived edges
 * have no store counterpart at all — they are drawn from the notes each render.
 */
const nodeTypes = { cartograph: EntityNode, ghost: GhostNode };
const edgeTypes = { cartograph: EntityEdge, derived: DerivedEdge };
/**
 * The same arrowhead the map draws, deliberately — a drawn relationship points
 * somewhere in both worlds, and two canvases rendering the same fact differently
 * is a thing a reader has to learn rather than see.
 *
 * This supersedes v1.5 §3.1, which had graph edges plain on the grounds that
 * direction is an authoring detail here. It is not: `link_nodes` and the canvas
 * both record a source and a target, and the export already reads them out as
 * "Connects to" and "Connects from".
 *
 * Only `EntityEdge` passes this through to its `BaseEdge`. Derived edges get the
 * option too and ignore it, which is what keeps a mention looking like a mention.
 */
const defaultEdgeOptions = {
  type: 'cartograph',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--edge-line)' },
};

/**
 * Long enough for React Flow to have measured the dots it is being asked to fit,
 * short enough that nobody watches an empty corner while the graph forms.
 */
const FRAME_AFTER_TICKS = 6;

type GraphFlowNode = CGNode | GhostFlowNode;

/** React Flow's `add` change names the node it carries; every other one has an id. */
const idOf = (change: NodeChange<GraphFlowNode>): string =>
  'id' in change ? change.id : change.item.id;

function GraphCanvasInner({
  onExport,
  onPalette,
  showMinimap,
  onToggleMinimap,
  readOnly,
}: BoardCanvasProps) {
  const flow = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const boardId = useStore((s) => s.board?.id ?? '');
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const config = useStore((s) => s.config);
  const viewport = useStore((s) => s.viewport);
  const onNodesChangeCore = useStore((s) => s.onNodesChange);
  const onEdgesChange = useStore((s) => s.onEdgesChange);
  const setViewport = useStore((s) => s.setViewport);
  const connect = useStore((s) => s.connect);
  const createNode = useStore((s) => s.createNode);
  const openEditor = useStore((s) => s.openEditor);
  // An entity can hold either kind of board inside it, so drilling asks (§3.1).
  const { drill: drillDown, picker } = useDrillDown();

  const [controls, setControls] = useGraphControls(boardId);
  const { derived, ghosts } = useDerivedLayer();

  /** Live layout, 60 fps, canvas-local: it is not board state until it settles. */
  const [layout, setLayout] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [hovered, setHovered] = useState<string | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; edgeId: string } | null>(null);

  const simRef = useRef<GraphSimulation | null>(null);
  const dotsRef = useRef<Map<string, number>>(new Map());
  /** Armed by a deliberate rearrangement; disarmed by the flush it asks for. */
  const flushRef = useRef(false);
  /*
   * A board with no remembered viewport has to be framed, or it opens at 100%
   * with the constellation off the top-left corner — the simulation builds its
   * picture around the origin, which is the canvas corner. It is framed twice:
   * once as soon as there is anything to look at, and again when the layout
   * stops moving, since a settling graph keeps growing. Touch the viewport
   * yourself and the second one is called off.
   */
  const frameRef = useRef(false);
  const refitRef = useRef(false);
  const ticksRef = useRef(0);

  const cards = useMemo(() => nodes.filter(isCard), [nodes]);

  /** A layer you have switched off is not a connection you can see (§3.2). */
  const drawnEdges = useMemo(
    () => (controls.drawnEdges ? edges : []),
    [edges, controls.drawnEdges],
  );
  const derivedEdges = useMemo(
    () => (controls.derivedLinks ? derived : []),
    [derived, controls.derivedLinks],
  );
  const liveGhosts = useMemo(
    () => (controls.derivedLinks ? ghosts : []),
    [ghosts, controls.derivedLinks],
  );

  /**
   * Degree across the board's connections — the drawn layer and the derived one
   * together (§3.1). Sizing and the hover halo both read it, and ghosts sit in
   * it too so a much-mentioned absence draws as big as it is talked about.
   */
  const { dots, neighbours, degree } = useMemo(() => {
    const counts = new Map<string, number>();
    const near = new Map<string, Set<string>>();
    const join = (id: string) => {
      if (!counts.has(id)) counts.set(id, 0);
      if (!near.has(id)) near.set(id, new Set([id]));
    };
    for (const card of cards) join(card.id);
    for (const ghost of liveGhosts) join(ghost.id);

    const link = (source: string, target: string) => {
      if (!counts.has(source) || !counts.has(target)) return;
      counts.set(source, (counts.get(source) ?? 0) + 1);
      counts.set(target, (counts.get(target) ?? 0) + 1);
      near.get(source)?.add(target);
      near.get(target)?.add(source);
    };
    for (const edge of drawnEdges) link(edge.source, edge.target);
    for (const edge of derivedEdges) link(edge.source, edge.target);

    const max = Math.max(0, ...counts.values());
    const sized = new Map<string, number>();
    for (const [id, count] of counts) sized.set(id, dotSize(count, max));
    return { dots: sized, neighbours: near, degree: counts };
  }, [cards, liveGhosts, drawnEdges, derivedEdges]);

  dotsRef.current = dots;

  const halfOf = useCallback((id: string) => (dotsRef.current.get(id) ?? MIN_DOT) / 2, []);

  const { fills, keys } = useMemo(
    () => groupColors(cards, controls.group, config),
    [cards, controls.group, config],
  );

  /**
   * Settled positions are written back as board state — but as a cache, not as
   * intent: `setState` deliberately bypasses the dirty flag, so a graph that is
   * merely open never claims to be unsaved (§2.2). Only a rearrangement the user
   * asked for arms the flush that actually schedules a save.
   */
  const handleSettle = useCallback(() => {
    const positions = simRef.current?.positions();
    if (!positions) return;
    const current = useStore.getState().nodes;
    let moved = false;
    const next = current.map((node) => {
      const point = positions.get(node.id);
      if (!point) return node;
      const half = halfOf(node.id);
      const x = Math.round(point.x - half);
      const y = Math.round(point.y - half);
      if (node.position.x === x && node.position.y === y) return node;
      moved = true;
      return { ...node, position: { x, y } };
    }) as CGNode[];
    if (moved) useStore.setState({ nodes: next });
    if (refitRef.current && positions.size) {
      refitRef.current = false;
      void flow.fitView({ padding: 0.24, duration: 320, maxZoom: 1.2 });
    }
    if (flushRef.current) {
      flushRef.current = false;
      useStore.getState().scheduleSave();
    }
  }, [halfOf, flow]);

  const settleRef = useRef(handleSettle);
  settleRef.current = handleSettle;

  // One simulation per board — the seed is the board id, so the same graph
  // always settles into the same picture (§3.1).
  useEffect(() => {
    if (!boardId) return;
    /*
     * Always, where this used to frame only a board with no remembered viewport
     * (v1.9). Same rule as the map world now: an open starts framed. On a graph
     * it matters more, because the simulation re-settles every time and last
     * session's viewport points at where the dots used to be.
     */
    frameRef.current = true;
    refitRef.current = true;
    ticksRef.current = 0;
    const sim = createSimulation({
      seed: boardId,
      onTick: () => {
        ticksRef.current += 1;
        setLayout(sim.positions());
      },
      onSettle: () => settleRef.current(),
    });
    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
      setLayout(new Map());
    };
  }, [boardId]);

  useEffect(() => {
    if (!frameRef.current || layout.size === 0 || ticksRef.current < FRAME_AFTER_TICKS) return;
    frameRef.current = false;
    void flow.fitView({ padding: 0.24, duration: 0, maxZoom: 1.2 });
  }, [layout, flow]);

  useEffect(() => {
    simRef.current?.tune({
      repel: controls.repel,
      linkDistance: controls.linkDistance,
      centre: controls.centre,
    });
  }, [controls.repel, controls.linkDistance, controls.centre]);

  const cardSeats = useMemo<SimSeat[]>(
    () =>
      cards.map((card) => {
        const dot = dots.get(card.id) ?? MIN_DOT;
        // A stored position is the last-settled cache; the origin means the node
        // has never been laid out, so the seeded spiral seats it instead.
        const cached = card.position.x !== 0 || card.position.y !== 0;
        return {
          id: card.id,
          radius: dot / 2,
          x: cached ? card.position.x + dot / 2 : undefined,
          y: cached ? card.position.y + dot / 2 : undefined,
        };
      }),
    [cards, dots],
  );

  /** Ghosts have no cache to come back to — they are seated fresh every time. */
  const seats = useMemo<SimSeat[]>(
    () => [
      ...cardSeats,
      ...liveGhosts.map((ghost) => ({ id: ghost.id, radius: (dots.get(ghost.id) ?? MIN_DOT) / 2 })),
    ],
    [cardSeats, liveGhosts, dots],
  );

  /*
   * Ghosts are the only nodes this canvas invents rather than receives, and
   * React Flow will not draw a line to a node it has never measured. Its own
   * observer does not always get to them, so they are measured on request the
   * moment the set of them changes — the documented way to do exactly this.
   */
  const ghostIds = liveGhosts.map((ghost) => ghost.id).join('\n');
  useEffect(() => {
    if (ghostIds) updateNodeInternals(ghostIds.split('\n'));
  }, [ghostIds, updateNodeInternals]);

  const simEdges = useMemo(
    () => [
      ...drawnEdges.map((edge) => ({ source: edge.source, target: edge.target })),
      ...derivedEdges.map((edge) => ({ source: edge.source, target: edge.target })),
    ],
    [drawnEdges, derivedEdges],
  );

  useEffect(() => {
    // An entity that has never been laid out earns the board its first cache
    // write, so the next open paints the settled picture immediately (§2.2).
    // Ghosts are excluded on purpose: they are never cached, and counting them
    // would arm a save on every settle for as long as one exists.
    if (cardSeats.some((seat) => seat.x === undefined)) flushRef.current = true;
    simRef.current?.sync(seats, simEdges);
  }, [cardSeats, seats, simEdges]);

  // ---- interaction ----

  /**
   * Where a dot sits is the simulation's business, never the board's, so
   * position changes stop here. Everything else — selection, removal, and the
   * measurements React Flow needs before it will draw an edge — is ordinary
   * core traffic. Ghosts have no store row, so nothing about them travels.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange<GraphFlowNode>[]) => {
      const rest = changes.filter(
        (change) => change.type !== 'position' && !isGhostId(idOf(change)),
      );
      if (rest.length) onNodesChangeCore(rest as NodeChange<CGNode>[]);
    },
    [onNodesChangeCore],
  );

  const onNodeDragStart: OnNodeDrag<GraphFlowNode> = useCallback((_event, node) => {
    // One history entry per drag, before the first pixel moves — the simulation
    // will keep changing positions after this, and none of that is user intent.
    if (!useStore.getState().readonly) useStore.getState().pushHistory();
    simRef.current?.fix(node.id, node.position.x + halfOf(node.id), node.position.y + halfOf(node.id));
    simRef.current?.reheat(0.3);
  }, [halfOf]);

  const onNodeDrag: OnNodeDrag<GraphFlowNode> = useCallback((_event, node) => {
    simRef.current?.fix(node.id, node.position.x + halfOf(node.id), node.position.y + halfOf(node.id));
  }, [halfOf]);

  /** Let go and the graph takes the node back — then remembers where it landed. */
  const onNodeDragStop: OnNodeDrag<GraphFlowNode> = useCallback((_event, node) => {
    simRef.current?.release(node.id);
    simRef.current?.reheat(0.25);
    if (isGhostId(node.id)) return;
    // Take the positions now, not only when the layout settles: until then they
    // live in the simulation alone, and leaving the board inside that second
    // flushed nothing. The settle still arms a save for where everything lands.
    flushRef.current = true;
    settleRef.current();
    flushRef.current = true;
  }, []);

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const state = useStore.getState();
    if (!state.openNodeId || params.nodes.length !== 1) return;
    const picked = params.nodes[0];
    if (picked.id !== state.openNodeId) state.openEditor(picked.id);
  }, []);

  /**
   * A mention made real (§4.2): the ghost's own place becomes the new entity's
   * first position, so the constellation does not jump, and the link that
   * summoned it resolves the moment the title lands on the canvas.
   */
  const materialise = useCallback(
    async (ghostId: string, title: string) => {
      const point = simRef.current?.positions().get(ghostId);
      const half = halfOf(ghostId);
      const position = point
        ? { x: Math.round(point.x - half), y: Math.round(point.y - half) }
        : { x: 0, y: 0 };
      const created = await createNode(position, { title });
      if (created) openEditor(created);
    },
    [createNode, halfOf, openEditor],
  );

  /** A dot is a thing, not a card: one click is enough to read it (§3.3). */
  const onNodeClick: NodeMouseHandler<GraphFlowNode> = useCallback(
    (_event, node) => {
      if (node.type === 'ghost') {
        // A ghost is an invitation to create the thing (§4.2) — not an offer
        // this viewer can accept. It still draws; clicking it does nothing.
        if (!readOnly) void materialise(node.id, (node.data as { title: string }).title);
        return;
      }
      openEditor(node.id);
    },
    [openEditor, materialise, readOnly],
  );

  /** Anchored on the dot, which only the simulation knows the position of. */
  const drill = useCallback(
    (nodeId: string) => {
      const point = simRef.current?.positions().get(nodeId);
      drillDown(
        nodeId,
        point
          ? flow.flowToScreenPosition({ x: point.x, y: point.y + halfOf(nodeId) + 8 })
          : undefined,
      );
    },
    [drillDown, flow, halfOf],
  );

  /** The ring says there is a board inside; double-click goes there (§3.1). */
  const onNodeDoubleClick: NodeMouseHandler<GraphFlowNode> = useCallback(
    (_event, node) => {
      const stored = useStore.getState().nodes.find((n) => n.id === node.id);
      if (stored && isCard(stored) && stored.data.childBoards?.length) drill(node.id);
    },
    [drill],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) connect(connection.source, connection.target);
    },
    [connect],
  );

  const createAt = useCallback(
    (client: { x: number; y: number }, connectFrom?: string) => {
      if (readOnly) return;
      const point = flow.screenToFlowPosition(client);
      void createNode({ x: Math.round(point.x), y: Math.round(point.y) }, { connectFrom, editing: false });
    },
    [createNode, flow, readOnly],
  );

  /** Dropping a link on empty canvas creates the next entity, already linked. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      createAt({ x: point.clientX, y: point.clientY }, state.fromNode.id);
    },
    [createAt],
  );

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: { id: string }) => {
      event.preventDefault();
      // Only a drawn edge is an object you can rename or delete — and only on a
      // board that is yours to change (§5).
      if (readOnly || edge.id.startsWith('derived:')) return;
      setEdgeMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
    },
    [readOnly],
  );

  useGraphKeyboard({
    onExport,
    onPalette,
    onCreate: () => createAt({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
    onDrill: drill,
    // Leaves ⌘K and ⌘E — find and export read; everything else writes.
    disabled: readOnly,
  });

  useEffect(() => {
    if (readOnly) return;
    canvasActions.createAtCenter = () =>
      createAt({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    canvasActions.focusNode = (nodeId: string) => {
      const point = simRef.current?.positions().get(nodeId);
      if (point) void flow.setCenter(point.x, point.y, { zoom: 1.2, duration: 240 });
    };
    return () => {
      delete canvasActions.createAtCenter;
      delete canvasActions.focusNode;
    };
  }, [createAt, flow, readOnly]);

  // ---- rendering ----

  /**
   * Everything but the hovered node and its direct connections dims (§3.1).
   * A node can vanish under the cursor (archived, undone) without ever sending
   * a leave, so the halo is only live while the node it belongs to still is.
   */
  const lit = hovered ? (neighbours.get(hovered) ?? null) : null;

  /** The filter dims rather than hides, so you keep the shape of the board (§3.2). */
  const needle = controls.filter.trim().toLowerCase();
  const matches = useCallback(
    (title: string) => !needle || title.toLowerCase().includes(needle),
    [needle],
  );

  const dimClass = useCallback(
    (id: string, title: string) => {
      if (!matches(title)) return 'is-dim';
      if (lit) return lit.has(id) ? 'is-lit' : 'is-dim';
      return undefined;
    },
    [matches, lit],
  );

  const decorated = useMemo(
    () =>
      cards.map((card) => {
        const dot = dots.get(card.id) ?? MIN_DOT;
        return {
          ...card,
          width: dot,
          height: dot,
          hidden: !controls.orphans && (degree.get(card.id) ?? 0) === 0,
          data: { ...card.data, dot, fill: fills.get(card.id), showLabel: controls.labels },
        };
      }),
    [cards, dots, fills, degree, controls.orphans, controls.labels],
  );

  const flowNodes = useMemo(() => {
    const placed = decorated.map((node) => {
      const point = layout.get(node.id);
      const half = (node.width ?? MIN_DOT) / 2;
      return {
        ...node,
        position: point ? { x: point.x - half, y: point.y - half } : node.position,
        className: dimClass(node.id, node.data.title),
      };
    }) as GraphFlowNode[];

    const drawn = liveGhosts.map((ghost) => {
      const dot = dots.get(ghost.id) ?? MIN_DOT;
      const point = layout.get(ghost.id);
      const half = dot / 2;
      return {
        id: ghost.id,
        type: 'ghost' as const,
        position: point ? { x: point.x - half, y: point.y - half } : { x: 0, y: 0 },
        width: dot,
        height: dot,
        selectable: false,
        className: dimClass(ghost.id, ghost.title),
        data: {
          title: ghost.title,
          dot,
          mentions: ghost.sources.length,
          showLabel: controls.labels,
        },
      } satisfies GhostFlowNode;
    });

    return [...placed, ...drawn] as GraphFlowNode[];
  }, [decorated, layout, dimClass, liveGhosts, dots, controls.labels]);

  /**
   * Which side a line leaves and enters is presentation, derived from where the
   * simulation has put the two dots this frame.
   */
  const flowEdges = useMemo(() => {
    const centre = new Map<string, { x: number; y: number }>();
    for (const node of flowNodes) {
      const point = layout.get(node.id);
      const half = (node.width ?? MIN_DOT) / 2;
      centre.set(node.id, point ?? { x: node.position.x + half, y: node.position.y + half });
    }

    const sides = (source: string, target: string) => {
      const from = centre.get(source);
      const to = centre.get(target);
      if (!from || !to) return {};
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      return {
        sourceHandle: horizontal ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top',
        targetHandle: horizontal ? (dx >= 0 ? 'left' : 'right') : dy >= 0 ? 'top' : 'bottom',
      };
    };

    const shade = (source: string, target: string) => {
      const dim = lit && !(lit.has(source) && lit.has(target));
      return dim ? 'is-dim' : lit ? 'is-lit' : undefined;
    };

    return [
      ...drawnEdges.map((edge) => ({
        ...edge,
        className: shade(edge.source, edge.target),
        data: { ...(edge.data ?? {}), showLabels: controls.edgeLabels },
        ...sides(edge.source, edge.target),
      })),
      ...derivedEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'derived',
        selectable: false,
        focusable: false,
        className: shade(edge.source, edge.target),
        data: { toGhost: edge.toGhost },
        ...sides(edge.source, edge.target),
      })),
    ];
  }, [drawnEdges, derivedEdges, flowNodes, layout, lit, controls.edgeLabels]);

  const wrapClass = [
    'cg-graph',
    lit ? 'cg-graph--hovering' : '',
    needle ? 'cg-graph--filtering' : '',
    readOnly ? 'cg-graph--readonly' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapClass}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onSelectionChange={onSelectionChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeMouseEnter={(_e, node) => setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={() => setHovered(null)}
        onDoubleClick={(event: React.MouseEvent) => {
          const target = event.target as HTMLElement;
          if (!target.classList.contains('react-flow__pane')) return;
          createAt({ x: event.clientX, y: event.clientY });
        }}
        // Dragging a dot is a layout hint the simulation caches back to the
        // board, so it is a write like any other; connecting two is one outright.
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        // A pan or zoom of your own carries an event; a fitView does not — so
        // touching the viewport calls off the re-frame the settle would do.
        onMoveStart={(event) => {
          if (event) refitRef.current = false;
        }}
        onMoveEnd={(event, vp) => {
          // Same distinction as onMoveStart: a fitView arrives without an event.
          // Cache where it landed, but do not call it a change the user made —
          // opening a graph would otherwise dirty the board and write it.
          if (event) setViewport(vp);
          else useStore.setState({ viewport: vp });
        }}
        defaultViewport={viewport}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={24}
        panOnScroll
        panOnDrag={[1, 2]}
        selectionOnDrag
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
            nodeColor="var(--text-low)"
            nodeStrokeColor="var(--line-hair)"
          />
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
        <div className="chrome-bottom-left">
          <ZoomPill fitPadding={0.25} minimap={{ active: showMinimap, onToggle: onToggleMinimap }} />
        </div>
      </div>

      {/*
       * Outside the chrome layer on purpose: board chrome sits *under* the
       * editor panel everywhere in this app, and the controls are board chrome.
       */}
      <div className="cg-graph__controls">
        <ControlsPanel
          controls={controls}
          onChange={setControls}
          keys={keys}
          counts={{ drawn: edges.length, derived: derived.length, ghosts: ghosts.length }}
        />
      </div>
    </div>
  );
}

export function GraphCanvas(props: BoardCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
