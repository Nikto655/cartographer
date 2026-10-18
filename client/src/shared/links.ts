/**
 * The link layer's client half (v1.5 §4.1) — core, because both worlds resolve
 * `[[…]]` the same way; only what a resolved link *means* is per-world (§4.2).
 *
 * Resolution happens against the live canvas rather than the server's computed
 * `links[]` so a title you just typed is linkable before the board reloads.
 */
import { useMemo } from 'react';
import { indexTitles, isAmbiguousTitle, isCrossBoardLink, parseWikiLinks, resolveWikiLink } from '@cartograph/shared';
import { isCard, useStore } from './store';

function nodeTitles(): { id: string; title: string }[] {
  return useStore
    .getState()
    .nodes.filter(isCard)
    .map((node) => ({ id: node.id, title: node.data.title }))
    .filter((node) => node.title.trim().length > 0);
}

/** What the `[[` popover offers first: every node title on the open board. */
export function boardNodeTitles(): string[] {
  return nodeTitles().map((node) => node.title);
}

/**
 * The open board's own sub-boards, as link targets.
 *
 * Read off `summaries` rather than `node.data.childBoards`, so this is every
 * child of the board you are on rather than the children of one node — the same
 * set the breadcrumb and the dashboard call its sub-boards. `summaries` is
 * workspace-scoped, so browsing somebody else's shared tree offers *their*
 * children and never your own boards that happen to share a name.
 */
function subBoards(): { id: string; title: string }[] {
  const { board, summaries } = useStore.getState();
  if (!board) return [];
  return summaries
    .filter((summary) => summary.parentBoard === board.id)
    .map((summary) => ({ id: summary.id, title: summary.name }))
    .filter((summary) => summary.title.trim().length > 0);
}

/** What the `[[` popover offers below the nodes. */
export function boardSubBoardTitles(): string[] {
  return subBoards().map((summary) => summary.title);
}

/**
 * Every other board in the workspace — the third list, below the sub-boards.
 *
 * A board does not have to be a child of this one to be worth pointing at, and
 * nothing about the mechanism required it to be: the target is a board id, and
 * `boardHref` reaches any of them. Sub-boards keep a section of their own
 * because "the children of what I am reading" is a different question from
 * "anything on the shelf", and it is nearly always the shorter answer.
 *
 * The open board itself is left out — a link to where you already are.
 */
function otherBoards(): { id: string; title: string }[] {
  const { board, summaries } = useStore.getState();
  const childIds = new Set(subBoards().map((child) => child.id));
  return summaries
    .filter((summary) => summary.id !== board?.id && !childIds.has(summary.id))
    .map((summary) => ({ id: summary.id, title: summary.name }))
    .filter((summary) => summary.title.trim().length > 0);
}

export function otherBoardTitles(): string[] {
  return otherBoards().map((summary) => summary.title);
}

/**
 * Title → board id across the whole workspace, sub-boards included.
 *
 * One index for rendering, where the section a board was listed under does not
 * matter — a written title either names a board or it does not. Only the
 * popover keeps the two lists apart, and that is a presentation choice.
 *
 * Deliberately a *second* index consulted after the node one, rather than more
 * entries in the same map. Nodes keep winning every title they already claimed,
 * so no note anywhere changes meaning by this feature existing — a board link is
 * only ever what a node link was not.
 */
export function useBoardTitleIndex(): Map<string, string | null> {
  const key = useStore((state) =>
    state.summaries.map((summary) => `${summary.id}=${summary.name}`).join('\n'),
  );
  const openId = useStore((state) => state.board?.id ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => indexTitles([...subBoards(), ...otherBoards()]), [key, openId]);
}


/**
 * Title → node id for the open board, `null` where a title is ambiguous.
 * Keyed on a flat id/title string: dragging touches every node object, and a
 * rendered preview should only re-parse when a *title* actually changes.
 */
export function useNodeTitleIndex(): Map<string, string | null> {
  const key = useStore((state) =>
    state.nodes
      .filter(isCard)
      .map((node) => `${node.id}=${node.data.title}`)
      .join('\n'),
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => indexTitles(nodeTitles()), [key]);
}

/** Node id → title, for anything that has to name the other end of a link. */
export function useTitleById(): Map<string, string> {
  const key = useStore((state) =>
    state.nodes
      .filter(isCard)
      .map((node) => `${node.id}=${node.data.title}`)
      .join('\n'),
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Map(nodeTitles().map((node) => [node.id, node.title])), [key]);
}

/** One `[[…]]` occurrence, resolved against the board as it stands right now. */
export interface LiveLink {
  sourceId: string;
  /** As written between the brackets. */
  title: string;
  targetId: string | null;
  /** Two nodes share this title, so it resolves to nothing on purpose (§4.1). */
  ambiguous: boolean;
  /** Reserved `[[board/node]]` syntax: inert everywhere, never a missing thing. */
  crossBoard: boolean;
}

/**
 * Every mention on the board, live. The store's cache says who wrote what; the
 * canvas says what those titles mean today — so a node created a second ago
 * already answers for the links pointing at it.
 *
 * Mentions from nodes that are no longer on the canvas (archived, undone) drop
 * out here rather than being tracked, since the canvas already knows.
 */
export function useLiveLinks(): LiveLink[] {
  const links = useStore((state) => state.links);
  const index = useNodeTitleIndex();
  const liveIds = useStore((state) =>
    state.nodes
      .filter(isCard)
      .map((node) => node.id)
      .join('\n'),
  );

  return useMemo(() => {
    const live = new Set(liveIds ? liveIds.split('\n') : []);
    return links
      .filter((link) => live.has(link.sourceId))
      .map((link) => ({
        sourceId: link.sourceId,
        title: link.targetTitle,
        targetId: resolveWikiLink(index, link.targetTitle),
        ambiguous: isAmbiguousTitle(index, link.targetTitle),
        crossBoard: isCrossBoardLink(link.targetTitle),
      }));
  }, [links, index, liveIds]);
}

/** The titles one note mentions, in written order — what the store caches per node. */
export function mentionedTitles(body: string): string[] {
  return parseWikiLinks(body).map((link) => link.title);
}
