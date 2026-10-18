/**
 * What a link *means* on a graph (v1.5 §4.2): the second edge layer, and the
 * things that are only mentioned so far.
 *
 * The core link layer says who wrote `[[…]]` about what; this file turns that
 * into geometry. Nothing here is ever stored — board.json holds drawn edges and
 * nothing else, so a derived edge exists exactly as long as a note says so, and
 * a ghost exactly as long as nothing answers to its name.
 */
import { useMemo } from 'react';
import { linkKey } from '@cartograph/shared';
import { useLiveLinks } from '@/shared/links';

/** An edge the notes imply. Same two endpoints as a drawn edge, drawn fainter. */
export interface DerivedEdge {
  id: string;
  source: string;
  target: string;
  /** True when the far end is a ghost — the mention has nothing real to land on. */
  toGhost: boolean;
}

/** A title mentioned by somebody and owned by nobody. */
export interface Ghost {
  /** Canvas-only id; never reaches the store or a file. */
  id: string;
  /** As first written — what the entity will be called if it is clicked into being. */
  title: string;
  /** Nodes whose notes mention it. */
  sources: string[];
}

/*
 * Ghost ids share a namespace with real node ids on the canvas, so they carry a
 * prefix a slug can never produce, and are otherwise slug-shaped: React Flow
 * puts an id straight into the DOM, and punctuation there is only trouble.
 */
const GHOST_PREFIX = 'ghost--';

const ghostId = (title: string): string =>
  `${GHOST_PREFIX}${encodeURIComponent(linkKey(title)).replace(/%/g, '-')}`;
export const isGhostId = (id: string): boolean => id.startsWith(GHOST_PREFIX);

/** One line per pair, whichever way round the mention was written. */
const pairId = (a: string, b: string): string =>
  a < b ? `derived:${a}|${b}` : `derived:${b}|${a}`;

/**
 * The derived layer for the open board. Self-mentions are dropped (a note that
 * names itself is not a relationship), ambiguous titles resolve to nothing on
 * purpose and so raise no ghost, and reserved `[[board/node]]` syntax stays
 * inert — a cross-board link is not a missing thing (§4.1).
 */
export function useDerivedLayer(): { derived: DerivedEdge[]; ghosts: Ghost[] } {
  const links = useLiveLinks();

  return useMemo(() => {
    const derived = new Map<string, DerivedEdge>();
    const ghosts = new Map<string, Ghost>();

    for (const link of links) {
      if (link.crossBoard || link.ambiguous) continue;

      if (link.targetId) {
        if (link.targetId === link.sourceId) continue;
        const id = pairId(link.sourceId, link.targetId);
        if (!derived.has(id)) {
          derived.set(id, { id, source: link.sourceId, target: link.targetId, toGhost: false });
        }
        continue;
      }

      const key = ghostId(link.title);
      const ghost = ghosts.get(key);
      if (ghost) {
        if (!ghost.sources.includes(link.sourceId)) ghost.sources.push(link.sourceId);
      } else {
        ghosts.set(key, { id: key, title: link.title, sources: [link.sourceId] });
      }
      const id = pairId(link.sourceId, key);
      if (!derived.has(id)) {
        derived.set(id, { id, source: link.sourceId, target: key, toGhost: true });
      }
    }

    return { derived: [...derived.values()], ghosts: [...ghosts.values()] };
  }, [links]);
}
