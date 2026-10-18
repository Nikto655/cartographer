import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

/**
 * The graph world's layout engine (v1.5 §3.1). d3-force owns where entities sit;
 * React Flow keeps rendering, selection, zoom and edge creation. Nothing in here
 * knows about React Flow or the store — it takes ids and radii, it gives back
 * centre points.
 */

export interface SimSeat {
  id: string;
  /** Drawn radius, so collision keeps big dots from swallowing small ones. */
  radius: number;
  /** Last-settled cache from board.json, when the board has one (§2.2). */
  x?: number;
  y?: number;
}

export interface SimEdge {
  source: string;
  target: string;
}

interface SimEntity extends SimulationNodeDatum {
  id: string;
  radius: number;
}

/** What the controls panel can move while the simulation runs (§3.2). */
export interface ForceSettings {
  /** How hard entities push each other apart. Positive; applied as charge. */
  repel: number;
  linkDistance: number;
  /** Pull towards the origin — high gathers the board, zero lets islands drift. */
  centre: number;
}

export interface GraphSimulation {
  /** Reconcile membership; reheats only when the graph actually changed. */
  sync: (seats: SimSeat[], edges: SimEdge[]) => void;
  /** Retune the running simulation — sliders must be felt, not applied on reload. */
  tune: (settings: ForceSettings) => void;
  positions: () => Map<string, { x: number; y: number }>;
  /** Held by the cursor: pinned exactly where the drag put it. */
  fix: (id: string, x: number, y: number) => void;
  release: (id: string) => void;
  reheat: (alpha?: number) => void;
  stop: () => void;
}

/* Calibrated against Obsidian's feel at ~50 nodes: loose clusters, readable gaps. */
const CHARGE_MAX_DISTANCE = 720;
const LINK_STRENGTH = 0.42;
const COLLIDE_PAD = 7;

/** Where the sliders sit when nobody has touched them, and how far they travel. */
export const FORCE_DEFAULTS: ForceSettings = { repel: 340, linkDistance: 84, centre: 0.05 };
export const FORCE_RANGE = {
  repel: { min: 40, max: 1200, step: 10 },
  linkDistance: { min: 24, max: 260, step: 2 },
  centre: { min: 0, max: 0.3, step: 0.005 },
};
/** Phyllotaxis spacing for the first seating — spirals fill space evenly. */
const SEAT_SPREAD = 34;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * A board's layout must feel familiar every time it opens, so the one source of
 * randomness d3 uses is replaced with a stream derived from the board id
 * (mulberry32 over an FNV-1a hash). Same board, same graph, same picture.
 */
function seededRandom(seed: string): () => number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSimulation(options: {
  seed: string;
  onTick: () => void;
  onSettle: () => void;
}): GraphSimulation {
  const random = seededRandom(options.seed);
  const entities = new Map<string, SimEntity>();
  let seated = 0;

  const linkForce = forceLink<SimEntity, SimulationLinkDatum<SimEntity>>([])
    .id((entity) => entity.id)
    .distance(FORCE_DEFAULTS.linkDistance)
    .strength(LINK_STRENGTH);
  const chargeForce = forceManyBody<SimEntity>()
    .strength(-FORCE_DEFAULTS.repel)
    .distanceMax(CHARGE_MAX_DISTANCE);
  // forceCenter recentres the whole cloud but exerts no pull, so unconnected
  // entities would drift forever; these hold every island near the origin.
  const xForce = forceX<SimEntity>(0).strength(FORCE_DEFAULTS.centre);
  const yForce = forceY<SimEntity>(0).strength(FORCE_DEFAULTS.centre);

  const simulation: Simulation<SimEntity, SimulationLinkDatum<SimEntity>> = forceSimulation<SimEntity>([])
    .randomSource(random)
    .force('charge', chargeForce)
    .force('link', linkForce)
    .force('centre', forceCenter(0, 0).strength(0.25))
    .force('x', xForce)
    .force('y', yForce)
    .force('collide', forceCollide<SimEntity>((entity) => entity.radius + COLLIDE_PAD))
    .velocityDecay(0.42)
    .on('tick', options.onTick)
    .on('end', options.onSettle);

  /** Deterministic first placement — d3 only randomises what has no position. */
  const seat = (index: number) => {
    const angle = index * GOLDEN_ANGLE;
    const radius = SEAT_SPREAD * Math.sqrt(index + 1);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  };

  return {
    sync(seats, edges) {
      let changed = false;
      let placedBlind = false;
      const live = new Set(seats.map((s) => s.id));

      for (const id of [...entities.keys()]) {
        if (!live.has(id)) {
          entities.delete(id);
          changed = true;
        }
      }

      for (const next of seats) {
        const existing = entities.get(next.id);
        if (existing) {
          if (existing.radius !== next.radius) existing.radius = next.radius;
          continue;
        }
        const cached = next.x !== undefined && next.y !== undefined;
        if (!cached) placedBlind = true;
        const placement = cached ? { x: next.x, y: next.y } : seat(seated);
        seated += 1;
        entities.set(next.id, { id: next.id, radius: next.radius, ...placement });
        changed = true;
      }

      const links = edges
        .filter((edge) => entities.has(edge.source) && entities.has(edge.target))
        .map((edge) => ({ source: edge.source, target: edge.target }));

      simulation.nodes([...entities.values()]);
      // forceLink rewrites source/target into node references, so it always gets
      // fresh objects rather than the caller's.
      linkForce.links(links as SimulationLinkDatum<SimEntity>[]);
      // Opening a board whose layout is entirely cached should look like coming
      // back to it, not like watching it form: just enough heat to relax.
      if (changed) {
        simulation.alpha(Math.max(simulation.alpha(), placedBlind ? 0.7 : 0.25)).restart();
      }
    },

    tune(settings) {
      chargeForce.strength(-settings.repel);
      linkForce.distance(settings.linkDistance);
      xForce.strength(settings.centre);
      yForce.strength(settings.centre);
      // Just enough heat that the change is visible where the eye already is,
      // without throwing a settled board back into formation.
      simulation.alpha(Math.max(simulation.alpha(), 0.3)).restart();
    },

    positions() {
      const out = new Map<string, { x: number; y: number }>();
      for (const entity of entities.values()) {
        out.set(entity.id, { x: entity.x ?? 0, y: entity.y ?? 0 });
      }
      return out;
    },

    fix(id, x, y) {
      const entity = entities.get(id);
      if (!entity) return;
      entity.fx = x;
      entity.fy = y;
      entity.x = x;
      entity.y = y;
    },

    release(id) {
      const entity = entities.get(id);
      if (!entity) return;
      entity.fx = null;
      entity.fy = null;
    },

    reheat(alpha = 0.35) {
      simulation.alpha(Math.max(simulation.alpha(), alpha)).restart();
    },

    stop() {
      simulation.on('tick', null).on('end', null).stop();
    },
  };
}
