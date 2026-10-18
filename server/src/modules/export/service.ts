import type { Board, ExportPayload, ExportResult, NodeContent } from '@cartograph/shared';
import { getBoard } from '../boards/index.js';
import { getNodeContent } from '../nodes/index.js';
import { type Workspace, slugify } from '../../core/storage.js';

function heading(level: number, text: string): string {
  return `${'#'.repeat(Math.min(level, 6))} ${text}`;
}

function fence(lang: string, code: string): string {
  return ['```' + lang, code.replace(/\s+$/, ''), '```'].join('\n');
}

/** Sidecar v2: the marked output is called out, the rest render under their labels. */
function renderData(content: NodeContent): string[] {
  const out: string[] = [];

  for (const item of content.incoming) {
    out.push(
      `**Receives from ${item.sourceTitle}: ${item.snippet.label}**`,
      fence(item.snippet.lang || 'txt', item.snippet.code),
    );
  }

  const data = content.data;
  if (!data) return out;

  for (const snippet of data.snippets) {
    const isOutput = snippet.id === data.outSnippetId;
    out.push(
      isOutput ? `**Passes forward: ${snippet.label}**` : `**${snippet.label}**`,
      fence(snippet.lang || 'txt', snippet.code),
    );
  }
  return out;
}

/**
 * A graph is held together by relationships rather than by a path, so each entity
 * carries both layers as a list (§7.5): the edges drawn on the canvas and the
 * `[[…]]` mentions derived from the notes. Maps say nothing here — there a link
 * is documentation, not structure (§4.2), and their export is untouched.
 */
function relationshipsOf(board: Board): Map<string, string[]> {
  const byNode = new Map<string, string[]>();
  if (board.boardType !== 'graph') return byNode;

  const titleOf = new Map(board.nodes.map((n) => [n.id, n.title]));
  // Always the same four groups in the same order, whatever order the board
  // happens to store its edges and notes in: a re-export must not reshuffle.
  const groups: Map<string, string[]>[] = [new Map(), new Map(), new Map(), new Map()];
  const add = (group: number, nodeId: string, line: string) => {
    const lines = groups[group].get(nodeId) ?? [];
    // The same relationship can be written twice in one note; it is still one.
    if (!lines.includes(line)) lines.push(line);
    groups[group].set(nodeId, lines);
  };

  for (const edge of board.edges) {
    const source = titleOf.get(edge.source);
    const target = titleOf.get(edge.target);
    if (!source || !target) continue;
    const label = edge.label?.trim() ? ` — ${edge.label.trim()}` : '';
    add(0, edge.source, `Connects to ${target}${label}`);
    add(1, edge.target, `Connects from ${source}${label}`);
  }

  for (const link of board.links ?? []) {
    const target = link.targetId ? titleOf.get(link.targetId) : undefined;
    // An unresolved mention is a ghost on the canvas; in a hand-off doc it is a
    // name with nothing behind it yet, and worth saying so.
    add(2, link.sourceId, target ? `Mentions ${target}` : `Mentions ${link.targetTitle} — not on this graph`);
    if (link.targetId && link.targetId !== link.sourceId) {
      add(3, link.targetId, `Mentioned by ${titleOf.get(link.sourceId) ?? link.sourceId}`);
    }
  }

  for (const node of board.nodes) {
    const lines = groups.flatMap((group) => group.get(node.id) ?? []);
    if (lines.length) byNode.set(node.id, lines);
  }
  return byNode;
}

async function renderNodes(
  ws: Workspace,
  board: Board,
  nodeIds: string[],
  descend: boolean,
  level: number,
  seenBoards: Set<string>,
  blocks: string[],
  mayRead: (boardId: string) => boolean,
): Promise<void> {
  const relationships = relationshipsOf(board);

  for (const nodeId of nodeIds) {
    const node = board.nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    const content = await getNodeContent(ws, board.id, nodeId).catch(() => null);
    blocks.push(heading(level, node.title));
    if (content?.body.trim()) blocks.push(content.body.trim());
    if (content) blocks.push(...renderData(content));

    const relations = relationships.get(nodeId);
    if (relations?.length) {
      blocks.push('**Relationships**', relations.map((line) => `- ${line}`).join('\n'));
    }

    for (const childId of descend ? (node.childBoards ?? []) : []) {
      if (seenBoards.has(childId)) continue;
      // Descent is a read of another board, so it answers to the same
      // visibility rule as opening one. A share that withheld its sub-boards
      // must not hand them over through the export button instead.
      if (!mayRead(childId)) continue;
      seenBoards.add(childId);
      const child = await getBoard(ws, childId).catch(() => null);
      if (!child) continue;
      blocks.push(heading(level + 1, `${child.name} — sub-board`));
      await renderNodes(ws, child, orderedIds(child), descend, level + 2, seenBoards, blocks, mayRead);
    }
  }
}

/** Depth-first order for a whole board: follow edges from roots, then leftovers. */
function orderedIds(board: Board): string[] {
  const incoming = new Set(board.edges.map((e) => e.target));
  const roots = board.nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
  const visited = new Set<string>();
  const order: string[] = [];

  const walk = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    order.push(id);
    for (const edge of board.edges.filter((e) => e.source === id)) walk(edge.target);
  };

  for (const root of roots) walk(root);
  for (const node of board.nodes) walk(node.id);
  return order;
}

export async function exportPath(
  ws: Workspace,
  boardId: string,
  payload: ExportPayload,
  /** Defaults to "everything in this workspace" — the caller's own boards. */
  mayRead: (id: string) => boolean = () => true,
): Promise<ExportResult> {
  const board = await getBoard(ws, boardId);
  const nodeIds = payload.nodeIds?.length ? payload.nodeIds : orderedIds(board);
  const title = payload.title?.trim() || board.name;

  const blocks: string[] = [];
  await renderNodes(ws, board, nodeIds, payload.descend ?? false, 1, new Set([boardId]), blocks, mayRead);

  const markdown = `${blocks.join('\n\n').trim()}\n`;
  return { filename: `${slugify(title)}.md`, markdown };
}
