import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Board,
  BoardEdge,
  BoardNode,
  BoardSummary,
  BoardText,
  CreateBoardPayload,
  EdgeShape,
  EdgeSide,
  EdgeStyle,
  GraphPayload,
  NodeShape,
  ShelvedBoard,
} from '@cartograph/shared';
import { DEFAULT_NODE_SIZE, MIN_NODE_SIZE, asBoardType, defaultNodeType } from '@cartograph/shared';
import { coverageOf, parseNodeFile, serializeNodeFile } from '../../core/markdown.js';
import { computeLinks, type LinkSource } from '../../core/links.js';
import { outputSnippet, readNodeData } from '../../core/data.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { mintId } from '../../core/ids.js';
import { type ArrangeOptions, arrange, frameAround, gridPlacer } from '../../core/layout.js';
import { withLock } from '../../core/locks.js';
import { emitBoardChange, emitBoardIdentityChange } from '../../core/boardEvents.js';
import { assertKnownShape, resolveColor, statusIds } from '../../core/config.js';
// One direction only: boards knows about folders, folders knows nothing about
// boards. See modules/folders/service.ts for why that decides how pruning works.
import { readFolders } from '../folders/index.js';
import {
  archivePath,
  changedAt,
  copyDir,
  ensureDir,
  ensureWorkspace,
  exists,
  listDirs,
  movePath,
  nowIso,
  readJson,
  readText,
  removePath,
  safeArchiveName,
  safeId,
  slugify,
  type Workspace,
  uniqueSlug,
  writeJson,
  writeText,
} from '../../core/storage.js';

// ---- reads ----

export async function boardExists(ws: Workspace, boardId: string): Promise<boolean> {
  return exists(ws.boardFile(boardId));
}

/** Raw board.json, no computed fields. */
export async function readBoardFile(ws: Workspace, boardId: string): Promise<Board> {
  const board = await readJson<Board>(ws.boardFile(boardId));
  if (!board) throw notFound(`Board not found: ${boardId}`);
  // v1.0 files predate frames/texts — hydrate lazily, no migration script (§6).
  board.nodes ??= [];
  board.edges ??= [];
  board.frames ??= [];
  board.texts ??= [];
  // Boards written before v1.5 have no world; they are all maps (§2.2).
  board.boardType = asBoardType(board.boardType);
  const fallbackType = defaultNodeType(board.boardType);
  // A node used to hold at most one sub-board; it now holds a list.
  for (const node of board.nodes) {
    if (node.childBoard && !node.childBoards) node.childBoards = [node.childBoard];
    delete node.childBoard;
    if (node.childBoards?.length === 0) delete node.childBoards;
    if (!node.type) node.type = fallbackType;
  }
  return board;
}

export async function writeBoardFile(ws: Workspace, board: Board): Promise<Board> {
  board.updatedAt = nowIso();
  await writeJson(ws.boardFile(board.id), board);
  /*
   * Announced here because this is the one function that stamps `updatedAt` —
   * "the board changed" and "its timestamp moved" are the same moment, so there
   * is no way to write a board through the normal path and forget to say so.
   * After the write, never before: a listener must not learn about a state that
   * is not yet on disk.
   */
  emitBoardChange({ userId: ws.userId, boardId: board.id });
  return board;
}

/**
 * Full board with per-node `hasData` / `coverage`, and title/status re-synced
 * from the files (files are truth, §4 sync rule). The `[[…]]` links are read out
 * of the same bodies while we have them (v1.5 §4.1).
 */
export async function getBoard(ws: Workspace, boardId: string): Promise<Board> {
  const board = await readBoardFile(ws, boardId);
  let dirty = false;

  const nodes: BoardNode[] = [];
  const sources: LinkSource[] = [];
  for (const node of board.nodes) {
    const raw = await readText(ws.nodeFile(boardId, node.id));
    if (raw === null) {
      nodes.push({ ...node, hasData: false, coverage: 'empty' });
      continue;
    }
    const { frontmatter, body } = parseNodeFile(raw, node.id);
    sources.push({ id: node.id, title: frontmatter.title, body });
    const data = await readNodeData(ws, boardId, node.id);
    // Frontmatter owns the type too; board.json only caches it.
    const type = frontmatter.type ?? node.type;

    if (frontmatter.title !== node.title || frontmatter.status !== node.status || type !== node.type) {
      dirty = true;
    }

    nodes.push({
      ...node,
      type,
      title: frontmatter.title,
      status: frontmatter.status,
      description: frontmatter.description,
      // Read out with the rest of the frontmatter so a world can group by tag
      // without opening every file (v1.5 §3.2).
      tags: frontmatter.tags,
      hasData: !!data,
      passesData: !!outputSnippet(data),
      coverage: coverageOf(body),
    });
  }

  board.nodes = nodes;
  // Persist the reconciliation so board.json stops lying — but only in our own
  // workspace. Reading someone else's board must not edit it (v1.6 §5).
  if (dirty && ws.canWrite) {
    await writeJson(ws.boardFile(boardId), board);
  }

  // Attached after the write: links are computed, and board.json must not cache them.
  const { links, warnings } = computeLinks(sources);
  board.links = links;
  if (warnings.length) board.warnings = warnings;
  return board;
}

export async function listBoards(ws: Workspace): Promise<BoardSummary[]> {
  const ids = await listDirs(ws.boardsDir());
  const known = await statusIds();
  // Once for the whole scan, not once per board (v1.8 §7). A read only: the
  // dashboard must never rewrite folders.json just for being opened, and this
  // path also runs in workspaces we are only visiting.
  const { assignments, favorites } = await readFolders(ws);
  const starred = new Set(favorites);
  const summaries: BoardSummary[] = [];

  for (const id of ids) {
    const board = await readJson<Board>(ws.boardFile(id));
    if (!board) continue;
    const statusCounts: Record<string, number> = {};
    for (const s of known) statusCounts[s] = 0;
    for (const node of board.nodes ?? []) {
      statusCounts[node.status] = (statusCounts[node.status] ?? 0) + 1;
    }
    summaries.push({
      id: board.id ?? id,
      name: board.name ?? id,
      // The browser tells worlds apart at a glance (§3.4), so the world travels
      // with the summary rather than costing a full board read per card.
      boardType: asBoardType(board.boardType),
      parentBoard: board.parentBoard,
      nodeCount: (board.nodes ?? []).length,
      statusCounts,
      updatedAt: board.updatedAt ?? new Date(0).toISOString(),
      // Organisation, merged in and never stored on the board itself.
      folderId: assignments[board.id ?? id],
      favorite: starred.has(board.id ?? id) || undefined,
    });
  }

  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}

// ---- writes ----

/**
 * Serializes anything that mints a board slug in one workspace.
 *
 * `uniqueSlug` is check-then-act with an `await` in the middle: it asks whether
 * a directory exists, then the caller writes it. Two creates of the same name
 * overlapping both got the answer "free" and both wrote `board.json` to the same
 * path — the second silently replaced the first. Measured before the fix: six
 * concurrent creates of one name produced three boards and lost three.
 *
 * Keyed on the workspace's `boards/` directory, so two people never wait on each
 * other — only two writers inside one workspace do, which is the only pair that
 * can collide. Never taken while a `board.json` lock is held: the parent-link
 * write below deliberately sits outside it, because `core/locks.ts` forbids
 * nesting and this is exactly where it would have crept in.
 */
export function withBoardRegistry<T>(ws: Workspace, job: () => Promise<T>): Promise<T> {
  return withLock(ws.boardsDir(), job);
}

export async function createBoard(ws: Workspace, payload: CreateBoardPayload): Promise<Board> {
  const name = (payload.name ?? '').trim();
  if (!name) throw badRequest('Board name is required.');

  // Minting the slug and claiming the directory have to be one step, or two
  // callers pick the same name — see `withBoardRegistry`.
  const board = await withBoardRegistry(ws, async () => {
    const id = await uniqueSlug(name, (candidate) => boardSlugTaken(ws, candidate));
    const fresh: Board = {
      id,
      name,
      boardType: asBoardType(payload.boardType),
      parentBoard: payload.parentBoard ? safeId(payload.parentBoard) : undefined,
      parentNode: payload.parentNode ? safeId(payload.parentNode) : undefined,
      nodes: [],
      edges: [],
      frames: [],
      texts: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await ensureDir(ws.nodesDir(id));
    // Through `writeBoardFile`, not `writeJson`: that is the function that says
    // a board changed, and a board arriving is the change the shelf most needs
    // to hear about. Written directly, a board an agent created was invisible
    // to every open dashboard until someone reloaded the page.
    await writeBoardFile(ws, fresh);
    return fresh;
  });

  /*
   * Outside the registry lock, under the *parent's* own lock. Two sub-boards
   * created under one parent at once are the same read-modify-write race one
   * level up — without this, one of the two `childBoards` entries is lost and
   * the sub-board becomes unreachable from the card that made it.
   */
  if (board.parentBoard && board.parentNode) {
    const parentId = board.parentBoard;
    const nodeId = board.parentNode;
    await withLock(ws.boardFile(parentId), async () => {
      const parent = await readBoardFile(ws, parentId);
      const node = parent.nodes.find((n) => n.id === nodeId);
      if (!node) throw notFound(`Parent node not found: ${nodeId}`);
      node.childBoards = [...(node.childBoards ?? []), board.id];
      await writeBoardFile(ws, parent);
    });
  }

  return board;
}

export async function renameBoard(ws: Workspace, boardId: string, name: string): Promise<Board> {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw badRequest('Board name is required.');

  const board = await readBoardFile(ws, boardId);
  board.name = trimmed;

  const desired = slugify(trimmed);
  let newId = board.id;
  if (desired !== board.id) {
    // Claimed and taken in one step: a rename racing a create for the same name
    // would otherwise move this board onto the other's directory.
    newId = await withBoardRegistry(ws, async () => {
      const candidateId = await uniqueSlug(
        desired,
        async (candidate) => candidate !== board.id && (await boardSlugTaken(ws, candidate)),
      );
      if (candidateId !== board.id) await movePath(ws.boardDir(board.id), ws.boardDir(candidateId));
      return candidateId;
    });
  }

  if (newId !== board.id) {
    const oldId = board.id;
    if (await exists(ws.snapshotsDir(oldId))) {
      await movePath(ws.snapshotsDir(oldId), ws.snapshotsDir(newId));
    }
    board.id = newId;
    await writeJson(ws.boardFile(newId), board);
    await repointBoardReferences(ws, oldId, newId);
    // A board id is a slug and slugs are reusable, so anything keyed on the old
    // one has to follow it now — see core/boardEvents.
    emitBoardIdentityChange({ userId: ws.userId, oldId, newId });
  }

  return writeBoardFile(ws, board);
}

/** Rewrites every `childBoard` / `parentBoard` reference after a board slug change. */
async function repointBoardReferences(ws: Workspace, oldId: string, newId: string): Promise<void> {
  for (const id of await listDirs(ws.boardsDir())) {
    const other = await readJson<Board>(ws.boardFile(id));
    if (!other) continue;
    let changed = false;
    if (other.parentBoard === oldId) {
      other.parentBoard = newId;
      changed = true;
    }
    for (const node of other.nodes ?? []) {
      if (node.childBoard === oldId) {
        node.childBoard = newId;
        changed = true;
      }
      if (node.childBoards?.includes(oldId)) {
        node.childBoards = node.childBoards.map((id) => (id === oldId ? newId : id));
        changed = true;
      }
    }
    if (changed) {
      other.updatedAt = nowIso();
      await writeJson(ws.boardFile(id), other);
    }
  }
}

/**
 * The autosave endpoint. Persists graph state and syncs any changed
 * title/status down into the node frontmatter (server owns all writes).
 */
export async function saveGraph(
  ws: Workspace,
  boardId: string,
  payload: GraphPayload,
): Promise<Board> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    /*
     * Refuse a write built on a board that has since changed.
     *
     * This endpoint takes the *whole* graph, so a stale payload does not merge —
     * it replaces, and anything added meanwhile is dropped by omission. That is
     * not hypothetical: a node an agent created over MCP was deleted this way,
     * its `node.md` left orphaned on disk with nothing pointing at it.
     *
     * Checked inside the lock, against the file we just read, or the comparison
     * would race the very writes it exists to catch. Optional by design: only
     * the canvas holds a base to compare, and only the canvas can clobber.
     */
    if (payload.baseUpdatedAt && board.updatedAt && payload.baseUpdatedAt !== board.updatedAt) {
      /*
       * A moved timestamp is the question, not the answer. The canvas advances
       * it itself every time it creates a node, archives one or pastes — all of
       * which write the board through another route — so "the board changed"
       * describes the ordinary case as often as the dangerous one, and refusing
       * on it alone rejected saves that would have lost nothing. That is what
       * made a chip impossible to draw: creating the node moved the timestamp,
       * and the save that would have recorded it as a chip was refused.
       *
       * The loss is specific and worth naming: a node on disk that the payload
       * does not mention is a node this save would drop by omission. Nodes are
       * the only part with files behind them, and the only part that can arrive
       * from somewhere the canvas cannot see. Deletion has its own route, so an
       * omission is never how the canvas asks for one.
       */
      const mentioned = new Set((payload.nodes ?? []).map((n) => n.id));
      const wouldDrop = payload.nodes ? board.nodes.filter((n) => !mentioned.has(n.id)) : [];
      if (wouldDrop.length) {
        throw conflict(
          `This board changed somewhere else while you had it open — ${wouldDrop.length} node${
            wouldDrop.length === 1 ? '' : 's'
          } would be lost. Reload before saving again.`,
        );
      }
    }
    const previous = new Map(board.nodes.map((n) => [n.id, n]));
    const existingIds = new Set(previous.keys());

    // Each part of the graph is applied only when the payload carries it: an absent
    // key means "leave this alone", so a partial payload can never empty a map.
    const nodes: BoardNode[] = [];
    for (const incoming of payload.nodes ?? []) {
      if (!existingIds.has(incoming.id)) continue; // nodes are created through the nodes module only
      const prev = previous.get(incoming.id)!;
      const merged: BoardNode = {
        ...prev,
        position: incoming.position ?? prev.position,
        size: incoming.size ?? prev.size,
        shape: incoming.shape ?? prev.shape,
        color: incoming.color,
        title: (incoming.title ?? prev.title).trim() || prev.title,
        status: incoming.status ?? prev.status,
        childBoards: prev.childBoards,
        type: prev.type, // the world owns node types; the canvas never changes one
        variant: incoming.variant === 'chip' ? 'chip' : undefined,
        frameId: incoming.frameId,
        showDescription: incoming.showDescription,
      };
      delete merged.hasData;
      delete merged.passesData;
      delete merged.coverage;
      delete merged.description; // frontmatter owns it; board.json must not cache it
      nodes.push(merged);

      if (merged.title !== prev.title || merged.status !== prev.status) {
        await syncFrontmatter(ws, boardId, merged.id, { title: merged.title, status: merged.status });
      }
    }

    if (payload.nodes) board.nodes = nodes;
    const nodeIds = new Set(board.nodes.map((n) => n.id));
    board.edges = (payload.edges ?? board.edges ?? [])
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label || undefined,
        style: e.style === 'dashed' ? 'dashed' : undefined,
        sourceSide: asSide(e.sourceSide),
        targetSide: asSide(e.targetSide),
        shape: e.shape === 'angled' ? 'angled' : undefined,
        bends: asBends(e.bends),
      }));

    // Frames and texts have no files behind them: board.json is the whole story.
    board.frames = (payload.frames ?? board.frames ?? []).map((frame) => ({
      id: frame.id,
      title: (frame.title ?? '').trim() || 'Section',
      position: frame.position,
      size: frame.size,
      color: frame.color,
      collapsed: frame.collapsed || undefined,
    }));
    const frameIds = new Set(board.frames.map((f) => f.id));
    for (const node of board.nodes) {
      if (node.frameId && !frameIds.has(node.frameId)) delete node.frameId;
    }
    board.texts = (payload.texts ?? board.texts ?? [])
      .filter((text) => (text.text ?? '').trim().length > 0)
      .map((text) => ({
        id: text.id,
        text: text.text,
        position: text.position,
        size: text.size ?? 'md',
        // Rounded and floored: a sub-pixel width is noise in a file meant to be
        // read, and a box narrower than this cannot hold a word.
        width: text.width ? Math.max(80, Math.round(text.width)) : undefined,
        bold: text.bold || undefined,
        italic: text.italic || undefined,
        underline: text.underline || undefined,
      }));

    if (payload.viewport) board.viewport = payload.viewport;

    return writeBoardFile(ws, board);
  });
}


/** Where one node should end up. Canvas coordinates: +x right, +y down. */
export interface NodeMove {
  nodeId: string;
  position: { x: number; y: number };
}

/**
 * Repositions nodes, and refits any frame whose members moved.
 *
 * Without this a caller could place a node but never move one, so the only way
 * to tidy a board it had already drawn was to build a second board — which is
 * how you end up with duplicates instead of a corrected map.
 *
 * **Frames follow their members rather than being positioned.** A frame is the
 * box around a group, and on the canvas membership *is* containment, so a
 * re-layout that moved the nodes and left the boxes behind would produce a board
 * disagreeing with itself. This refits exactly — shrinking as well as growing —
 * because unlike `setFrameMembership`, which only learns a node has joined, this
 * is the caller deliberately rearranging the geometry.
 */
export async function moveNodes(
  ws: Workspace,
  boardId: string,
  moves: readonly NodeMove[],
): Promise<{ moved: number; framesRefit: number }> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const byId = new Map(board.nodes.map((n) => [n.id, n]));

    // Validated before anything is applied, so a typo in the last move cannot
    // leave the first nine written and the board half-rearranged.
    for (const move of moves) {
      if (!byId.has(move.nodeId)) {
        throw badRequest(`No node “${move.nodeId}” on board “${boardId}”.`);
      }
      const { x, y } = move.position ?? {};
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw badRequest(
          `Position for “${move.nodeId}” must be two finite numbers; got ${JSON.stringify(move.position)}.`,
        );
      }
    }

    const framesRefit = applyMoves(board, moves);
    await writeBoardFile(ws, board);
    return { moved: moves.length, framesRefit };
  });
}

/**
 * Writes the positions onto a board already in hand and refits whatever frames
 * that disturbs. No lock and no IO of its own: the two callers are both already
 * inside `withLock` on this board, and taking it again would queue behind
 * itself forever (`core/locks.ts`).
 */
function applyMoves(board: Board, moves: readonly NodeMove[]): number {
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const touchedFrames = new Set<string>();
  for (const move of moves) {
    const node = byId.get(move.nodeId);
    if (!node) continue;
    // Rounded on the way in: the canvas works in whole units, and a stored
    // fraction shows up later as a node that will not line up with any other.
    node.position = { x: Math.round(move.position.x), y: Math.round(move.position.y) };
    if (node.frameId) touchedFrames.add(node.frameId);
  }

  for (const frame of board.frames) {
    if (!touchedFrames.has(frame.id)) continue;
    const members = board.nodes.filter((n) => n.frameId === frame.id);
    if (!members.length) continue; // an emptied frame keeps the box its author drew
    const fitted = frameAround(board, members);
    frame.position = fitted.position;
    frame.size = fitted.size;
  }
  return touchedFrames.size;
}

/**
 * Arrange a selection by naming a shape instead of a coordinate per node (§1.10).
 *
 * The layout itself is `core/layout.ts` and knows nothing about workspaces; this
 * is the part that reads the board, hands it the geometry, and writes the answer
 * back through the same path `moveNodes` uses — so frames refit here for exactly
 * the same reason they refit there.
 *
 * `flow` is given the board's edges rather than only the selection's, filtered
 * down inside: an agent naming eight nodes should not also have to work out
 * which edges are between them.
 *
 * Omitting `nodeIds` means the whole board, which is the common case after a
 * build and saves the caller listing thirty ids back to us.
 */
export async function arrangeNodes(
  ws: Workspace,
  boardId: string,
  nodeIds: readonly string[] | undefined,
  options: ArrangeOptions,
): Promise<{ arranged: number; framesRefit: number; layout: string }> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const byId = new Map(board.nodes.map((n) => [n.id, n]));

    // Validated before anything moves, the same rule as `moveNodes`: a typo in
    // the last id must not leave the first nine rearranged.
    if (nodeIds) {
      for (const id of nodeIds) {
        if (!byId.has(id)) throw badRequest(`No node “${id}” on board “${boardId}”.`);
      }
    }

    const chosen = nodeIds?.length
      ? nodeIds.map((id) => byId.get(id)!)
      : board.nodes;
    if (chosen.length < 2) {
      // One node has no arrangement, and saying so is friendlier than writing
      // the position it already had and reporting success.
      throw badRequest('Give me at least two nodes to arrange.');
    }

    const positions = arrange(
      chosen.map((n) => ({
        id: n.id,
        position: n.position,
        size: n.size ?? DEFAULT_NODE_SIZE,
      })),
      board.edges,
      options,
    );

    const framesRefit = applyMoves(
      board,
      [...positions].map(([nodeId, position]) => ({ nodeId, position })),
    );
    await writeBoardFile(ws, board);
    return { arranged: positions.size, framesRefit, layout: options.layout };
  });
}

/**
 * How one node should look. Every field is optional and an absent one is left
 * alone; `color: null` is how a colour is *removed*, which is a different thing
 * from not mentioning it.
 */
export interface NodeStyle {
  nodeId: string;
  color?: string | null;
  shape?: NodeShape;
  size?: { width: number; height: number };
  variant?: 'card' | 'chip' | null;
  showDescription?: boolean | null;
}

/**
 * A node bigger than this is a mistake rather than a choice — a caller that
 * meant 240 and sent 240000 should get a sentence back, not a board with one
 * card the size of a district.
 */
const MAX_NODE_SIZE = { width: 2000, height: 2000 };

function assertSize(size: { width: number; height: number }, nodeId: string): void {
  const { width, height } = size ?? {};
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw badRequest(`Size for “${nodeId}” must be two finite numbers; got ${JSON.stringify(size)}.`);
  }
  if (width < MIN_NODE_SIZE.width || height < MIN_NODE_SIZE.height) {
    throw badRequest(
      `Size for “${nodeId}” is below the minimum ${MIN_NODE_SIZE.width}×${MIN_NODE_SIZE.height}.`,
    );
  }
  if (width > MAX_NODE_SIZE.width || height > MAX_NODE_SIZE.height) {
    throw badRequest(
      `Size for “${nodeId}” is above the maximum ${MAX_NODE_SIZE.width}×${MAX_NODE_SIZE.height}.`,
    );
  }
}

/**
 * The appearance half of a node, all of which lives in `board.json` rather than
 * in the file (v1.0 §3: presentation is the cache's business, prose is the
 * file's). Separate from `patchNode` for exactly that reason — that one edits
 * frontmatter and can rename a node's directory, and colouring a card should
 * never be able to move a file.
 */
export async function styleNodes(
  ws: Workspace,
  boardId: string,
  styles: readonly NodeStyle[],
): Promise<{ styled: number; framesRefit: number }> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const byId = new Map(board.nodes.map((n) => [n.id, n]));

    // Everything is validated before anything is applied, so a bad colour in the
    // last entry cannot leave the first nine painted.
    const resolved: { node: BoardNode; style: NodeStyle; color?: string }[] = [];
    for (const style of styles) {
      const node = byId.get(style.nodeId);
      if (!node) throw badRequest(`No node “${style.nodeId}” on board “${boardId}”.`);
      if (style.shape !== undefined) await assertKnownShape(style.shape);
      if (style.size !== undefined) assertSize(style.size, style.nodeId);
      resolved.push({
        node,
        style,
        color: style.color === undefined ? undefined : await resolveColor(style.color),
      });
    }

    const resized = new Set<string>();
    for (const { node, style, color } of resolved) {
      if (style.size !== undefined) {
        node.size = {
          width: Math.round(style.size.width),
          height: Math.round(style.size.height),
        };
        if (node.frameId) resized.add(node.frameId);
      }
      if (style.color !== undefined) {
        if (color) node.color = color;
        else delete node.color; // back to auto — coverage decides the fill again
      }
      if (style.shape !== undefined) node.shape = style.shape;
      if (style.variant !== undefined) {
        if (style.variant === 'chip') node.variant = 'chip';
        else delete node.variant; // absent already means the ordinary card
      }
      if (style.showDescription !== undefined) {
        if (style.showDescription === null) delete node.showDescription;
        else node.showDescription = style.showDescription;
      }
    }

    /*
     * A resized node has a new footprint, so a frame holding it may no longer
     * cover it — the same disagreement `moveNodes` refits away, arrived at by
     * growing rather than moving. Nothing else here changes geometry, so only
     * frames whose members were resized are touched.
     */
    for (const frame of board.frames) {
      if (!resized.has(frame.id)) continue;
      const members = board.nodes.filter((n) => n.frameId === frame.id);
      if (!members.length) continue;
      const fitted = frameAround(board, members);
      frame.position = fitted.position;
      frame.size = fitted.size;
    }

    await writeBoardFile(ws, board);
    return { styled: resolved.length, framesRefit: resized.size };
  });
}

/**
 * A freestanding label on the canvas (v1.0 §4.3): a heading over a band, a
 * caption, a note-to-self. It has no file, no panel and no edges — which is
 * exactly why it is not a node with the chrome switched off.
 */
export interface NewTextInput {
  text: string;
  position?: { x: number; y: number };
  size?: BoardText['size'];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

const TEXT_SIZES: readonly BoardText['size'][] = ['sm', 'md', 'lg'];
/** Nominal, only so auto-placement has something to space against. */
const TEXT_BOX = { width: 240, height: 40 };

function assertTextSize(size: string | undefined): BoardText['size'] | undefined {
  if (size === undefined) return undefined;
  if (!TEXT_SIZES.includes(size as BoardText['size'])) {
    throw badRequest(`Unknown text size “${size}”. Use one of: ${TEXT_SIZES.join(', ')}.`);
  }
  return size as BoardText['size'];
}

/** Empty is not a label. The canvas drops one on commit; so does this. */
function requireText(value: string): string {
  const text = (value ?? '').trim();
  if (!text) throw badRequest('A text annotation cannot be empty.');
  return text;
}

export async function createTexts(
  ws: Workspace,
  boardId: string,
  inputs: readonly NewTextInput[],
): Promise<BoardText[]> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const place = gridPlacer(board);
    const created: BoardText[] = [];

    for (const input of inputs) {
      const text = requireText(input.text);
      const size = assertTextSize(input.size) ?? 'md';
      created.push({
        id: mintId('text'),
        text,
        position: input.position ?? place(TEXT_BOX),
        size,
        // Written only when true, matching how the canvas's own save stores them.
        ...(input.bold ? { bold: true } : {}),
        ...(input.italic ? { italic: true } : {}),
        ...(input.underline ? { underline: true } : {}),
      });
    }

    board.texts.push(...created);
    await writeBoardFile(ws, board);
    return created;
  });
}

/** Field-wise edit. An absent key is left alone; a `false` flag clears it. */
export async function updateText(
  ws: Workspace,
  boardId: string,
  textId: string,
  patch: {
    text?: string;
    position?: { x: number; y: number };
    size?: BoardText['size'];
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  },
): Promise<BoardText> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const annotation = board.texts.find((t) => t.id === textId);
    if (!annotation) throw notFound(`Text not found: ${textId}`);

    if (patch.text !== undefined) annotation.text = requireText(patch.text);
    if (patch.size !== undefined) annotation.size = assertTextSize(patch.size)!;
    if (patch.position !== undefined) {
      const { x, y } = patch.position;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw badRequest(`Position must be two finite numbers; got ${JSON.stringify(patch.position)}.`);
      }
      annotation.position = { x: Math.round(x), y: Math.round(y) };
    }
    for (const flag of ['bold', 'italic', 'underline'] as const) {
      if (patch[flag] === undefined) continue;
      if (patch[flag]) annotation[flag] = true;
      else delete annotation[flag];
    }

    await writeBoardFile(ws, board);
    return annotation;
  });
}

/**
 * Removes annotations by id. Like an edge, a text has no file behind it — this
 * is a `board.json` edit, not the destructive operation "archive, never delete"
 * is about. The canvas already deletes one by emptying it.
 */
export async function removeTexts(
  ws: Workspace,
  boardId: string,
  textIds: readonly string[],
): Promise<{ removed: number; notFound: number }> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const wanted = new Set(textIds);
    const before = board.texts.length;
    board.texts = board.texts.filter((t) => !wanted.has(t.id));
    const removed = before - board.texts.length;

    if (removed) await writeBoardFile(ws, board);
    return { removed, notFound: wanted.size - removed };
  });
}

/** One edge to draw. `id` is the server's to mint — nothing outside names an edge. */
export interface NewEdgeInput {
  source: string;
  target: string;
  label?: string;
  style?: EdgeStyle;
}

/**
 * Draws edges without touching anything else (v1.7 §3, `link_nodes`).
 *
 * `saveGraph` is the canvas's endpoint and takes the entire graph, because that
 * is what the canvas has. Something that has just created five nodes has no
 * graph to send back, and making it read, merge and rewrite one to draw a line
 * is how a partial payload ends up emptying a board.
 *
 * Duplicates are skipped rather than refused: an agent re-running a step it is
 * unsure it finished should end up with the board it meant, not an error and
 * two lines between the same pair.
 */
export async function addEdges(
  ws: Workspace,
  boardId: string,
  inputs: readonly NewEdgeInput[],
): Promise<{ added: BoardEdge[]; skipped: number }> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const nodeIds = new Set(board.nodes.map((n) => n.id));
    const seen = new Set(board.edges.map((e) => `${e.source}->${e.target}`));
    const added: BoardEdge[] = [];
    let skipped = 0;

    for (const input of inputs) {
      // Checked before anything is written, so a typo in the tenth edge does not
      // leave the first nine drawn.
      if (!nodeIds.has(input.source)) {
        throw badRequest(`No node “${input.source}” on board “${boardId}”.`);
      }
      if (!nodeIds.has(input.target)) {
        throw badRequest(`No node “${input.target}” on board “${boardId}”.`);
      }
      const key = `${input.source}->${input.target}`;
      if (input.source === input.target || seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      added.push({
        id: mintId('edge'),
        source: input.source,
        target: input.target,
        ...(input.label?.trim() ? { label: input.label.trim() } : {}),
        ...(input.style === 'dashed' ? { style: 'dashed' as const } : {}),
      });
    }

    if (!added.length) return { added, skipped };
    board.edges.push(...added);
    await writeBoardFile(ws, board);
    return { added, skipped };
  });
}

/**
 * Removes edges by id (v1.7). The counterpart to `addEdges`: something that can
 * only ever draw lines cannot fix a line it drew wrong, and "restore the
 * snapshot" is a heavy answer to a mislabelled arrow.
 *
 * This is not the "archive, never delete" rule bending. An edge has no file
 * behind it — it lives in `board.json` and nowhere else, and `saveGraph` has
 * always dropped edges wholesale when the canvas sends a list without them.
 * Removing one here is ordinary board editing, not a destructive operation.
 *
 * Ids that are not on the board are counted, not refused: an idempotent retry
 * should end in the board the caller meant.
 */
export async function removeEdges(
  ws: Workspace,
  boardId: string,
  edgeIds: readonly string[],
): Promise<{ removed: number; notFound: number }> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const wanted = new Set(edgeIds);
    const before = board.edges.length;
    board.edges = board.edges.filter((edge) => !wanted.has(edge.id));
    const removed = before - board.edges.length;

    if (removed) await writeBoardFile(ws, board);
    return { removed, notFound: wanted.size - removed };
  });
}

/** Relabels or restyles one edge. An absent key leaves that part alone. */
/** Anything that is not one of the four faces is not a pin. */
function asSide(value: unknown): EdgeSide | undefined {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left'
    ? value
    : undefined;
}

/**
 * Bend offsets, in canvas units from the source end.
 *
 * Deliberately unbounded — a bend is meant to go wherever it is dragged, and
 * the route it belongs to is built so that no value can make a connector meet a
 * card from the wrong side. What is checked is that they are numbers at all,
 * and that there are no more of them than any route has bends to spend them on.
 */
const MAX_BENDS = 4;
function asBends(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const clean = value
    .slice(0, MAX_BENDS)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    .map((n) => Math.round(n * 100) / 100);
  return clean.length === value.slice(0, MAX_BENDS).length && clean.length ? clean : undefined;
}

export async function updateEdge(
  ws: Workspace,
  boardId: string,
  edgeId: string,
  patch: {
    label?: string;
    style?: EdgeStyle;
    sourceSide?: EdgeSide | null;
    targetSide?: EdgeSide | null;
    shape?: EdgeShape;
    bends?: number[] | null;
  },
): Promise<BoardEdge> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const edge = board.edges.find((e) => e.id === edgeId);
    if (!edge) throw notFound(`Edge not found: ${edgeId}`);

    if (patch.label !== undefined) {
      const label = patch.label.trim();
      // An empty label is how a label is removed — `undefined` keeps board.json
      // free of keys that mean nothing, as the canvas's own save does.
      if (label) edge.label = label;
      else delete edge.label;
    }
    if (patch.style !== undefined) {
      if (patch.style === 'dashed') edge.style = 'dashed';
      else delete edge.style;
    }
    // `null` is how a pin is released — distinct from `undefined`, which is the
    // caller not mentioning that end at all.
    if (patch.sourceSide !== undefined) {
      if (patch.sourceSide === null) delete edge.sourceSide;
      else edge.sourceSide = asSide(patch.sourceSide);
    }
    if (patch.targetSide !== undefined) {
      if (patch.targetSide === null) delete edge.targetSide;
      else edge.targetSide = asSide(patch.targetSide);
    }
    if (patch.shape !== undefined) {
      const was = edge.shape ?? 'curved';
      if (patch.shape === 'angled') edge.shape = 'angled';
      else delete edge.shape;
      // A shape change forgets the bends, wherever it comes from — they describe
      // turns the other shape does not have. Bends sent in the same call are the
      // caller saying otherwise, and are applied just below.
      if (was !== patch.shape && patch.bends === undefined) delete edge.bends;
    }
    // `null`, or an empty list, puts the bends back where the plain route wants
    // them — the same way "auto" releases a pin above.
    if (patch.bends !== undefined) {
      const bends = patch.bends === null ? undefined : asBends(patch.bends);
      if (bends) edge.bends = bends;
      else delete edge.bends;
    }

    await writeBoardFile(ws, board);
    return edge;
  });
}

async function syncFrontmatter(
  ws: Workspace,
  boardId: string,
  nodeId: string,
  patch: { title?: string; status?: string },
): Promise<void> {
  const file = ws.nodeFile(boardId, nodeId);
  const raw = await readText(file);
  if (raw === null) return;
  const { frontmatter, body } = parseNodeFile(raw, nodeId);
  if (patch.title !== undefined) frontmatter.title = patch.title;
  if (patch.status !== undefined) frontmatter.status = patch.status;
  await writeText(file, serializeNodeFile(frontmatter, body));
}

export async function duplicateBoard(ws: Workspace, boardId: string): Promise<Board> {
  const board = await readBoardFile(ws, boardId);
  // Same claim-the-name-and-the-directory-together rule as `createBoard`.
  const newId = await withBoardRegistry(ws, async () => {
    const id = await uniqueSlug(`${board.name} copy`, (candidate) => boardSlugTaken(ws, candidate));
    await copyDir(ws.boardDir(boardId), ws.boardDir(id));
    return id;
  });

  const copy = await readBoardFile(ws, newId);
  copy.id = newId;
  copy.name = `${board.name} copy`;
  copy.createdAt = nowIso();
  // A duplicated drill-down node keeps pointing at the original child board.
  await writeJson(ws.boardFile(newId), copy);
  return writeBoardFile(ws, copy);
}

export async function archiveBoard(ws: Workspace, boardId: string): Promise<{ archived: string }> {
  const board = await readBoardFile(ws, boardId);

  if (board.parentBoard && (await boardExists(ws, board.parentBoard))) {
    const parent = await readBoardFile(ws, board.parentBoard);
    let changed = false;
    for (const node of parent.nodes) {
      if (node.childBoards?.includes(boardId)) {
        node.childBoards = node.childBoards.filter((id) => id !== boardId);
        if (!node.childBoards.length) delete node.childBoards;
        changed = true;
      }
    }
    if (changed) await writeBoardFile(ws, parent);
  }

  // Children survive as top-level boards (§7.5).
  for (const id of await listDirs(ws.boardsDir())) {
    if (id === boardId) continue;
    const other = await readJson<Board>(ws.boardFile(id));
    if (other?.parentBoard === boardId) {
      delete other.parentBoard;
      delete other.parentNode;
      other.updatedAt = nowIso();
      await writeJson(ws.boardFile(id), other);
    }
  }

  const target = await archivePath(ws.boardDir(boardId), ws.archiveBoardsDir(), boardId);
  const archivedAs = path.basename(target);
  await stampShelved(target);

  /*
   * Snapshots and archived nodes are keyed on the board slug too, and the slug
   * is free the instant the board directory moves. Left where they are, the
   * next board named the same thing would list this board's snapshots and be
   * overwritten by restoring one. They travel with the board instead, under the
   * same archived name, so recovering everything is still one `mv` away.
   */
  if (await exists(ws.snapshotsDir(boardId))) {
    await movePath(ws.snapshotsDir(boardId), path.join(ws.archiveRoot(), 'snapshots', archivedAs));
  }
  if (await exists(ws.archiveNodesDir(boardId))) {
    await movePath(ws.archiveNodesDir(boardId), ws.archiveNodesDir(archivedAs));
  }

  // Anything else keyed on the slug lets go now — see core/boardEvents.
  emitBoardIdentityChange({ userId: ws.userId, oldId: boardId, newId: null });
  return { archived: archivedAs };
}

// ---- helpers shared with the nodes module ----

/**
 * Whether a board slug is already taken in this workspace.
 *
 * The *directory*, not `board.json`: a leftover directory with no board file
 * still owns the slug, and a copy that ignored it would merge itself into the
 * remains of something else. Every place that mints a board id asks here, so
 * the four of them cannot drift apart again.
 */
export async function boardSlugTaken(ws: Workspace, candidate: string): Promise<boolean> {
  return exists(path.join(ws.boardsDir(), candidate));
}

export async function nodeIdTaken(
  ws: Workspace,
  boardId: string,
  candidate: string,
): Promise<boolean> {
  return exists(ws.nodeDir(boardId, candidate));
}


/*
 * ---- the shelf below the shelf (v1.9) ----
 *
 * Three resting places, and the difference between them is who can see them:
 *
 *   boards/          live
 *   archive/boards/  the owner's own undo — listed, restorable, theirs
 *   deleted/boards/  out of the owner's world; only an admin sees it
 *
 * A board moves down one step at a time and never skips. "Delete" from the
 * Archive moves rather than removes, because a person tidying up is the one who
 * most often wants it back, and because an admin has to be able to answer
 * "where did that board go" long afterwards.
 */

/**
 * Record when a board landed where it now is.
 *
 * Written straight through `writeJson` rather than `writeBoardFile`, on purpose:
 * that helper stamps `updatedAt` and announces a change, and neither is true
 * here. Archiving a board is not editing it, and there is no live board left to
 * announce. A failure is swallowed — the fallbacks in `shelvedAt` cover it, and
 * refusing to archive because a timestamp would not write is the worse outcome.
 */
async function stampShelved(dir: string): Promise<void> {
  try {
    const file = path.join(dir, 'board.json');
    const board = await readJson<Record<string, unknown>>(file);
    if (board) await writeJson(file, { ...board, shelvedAt: nowIso() });
  } catch {
    /* best effort */
  }
}

/** The name is in the file; nothing is cached about a board that is not live. */
async function shelvedAt(dir: string, entry: string): Promise<ShelvedBoard | null> {
  const at = path.join(dir, entry);
  const board = await readJson<Board & { shelvedAt?: string }>(path.join(at, 'board.json'));
  if (!board) return null;
  const updatedAt = board.updatedAt ?? new Date(0).toISOString();
  return {
    entry,
    id: board.id ?? entry,
    name: board.name ?? entry,
    boardType: asBoardType(board.boardType),
    nodeCount: board.nodes?.length ?? 0,
    updatedAt,
    // The stamp if it has one; otherwise when the directory was last moved,
    // which is what archiving does to it. `updatedAt` only as a last resort —
    // it is the wrong question, but it is better than nothing to sort by.
    shelvedAt: board.shelvedAt ?? (await changedAt(at)) ?? updatedAt,
  };
}

async function listShelved(dir: string): Promise<ShelvedBoard[]> {
  const entries = await listDirs(dir);
  const out: ShelvedBoard[] = [];
  for (const entry of entries) {
    const board = await shelvedAt(dir, entry);
    // A directory with no readable board.json is not something to show anyone;
    // it is also not an error worth failing the whole list over.
    if (board) out.push(board);
  }
  // Most recently shelved first — on these lists that is what "newest" means.
  return out.sort((a, b) => b.shelvedAt.localeCompare(a.shelvedAt));
}

/** What the owner sees in the Archive tab. */
export function listArchivedBoards(ws: Workspace): Promise<ShelvedBoard[]> {
  return listShelved(ws.archiveBoardsDir());
}

/** What a Super Admin sees, and nobody else — see `deletedRoot`. */
export function listDeletedBoards(ws: Workspace): Promise<ShelvedBoard[]> {
  return listShelved(ws.deletedBoardsDir());
}

/**
 * Archive → live. The slug may have been taken by a board made since, so this
 * mints a fresh one rather than refusing: coming back under a suffixed name is
 * a better answer than not coming back.
 */
export async function restoreBoard(ws: Workspace, entry: string): Promise<Board> {
  const name = safeArchiveName(entry);
  const from = path.join(ws.archiveBoardsDir(), name);
  if (!(await exists(from))) throw notFound(`No archived board to restore: ${entry}`);

  const shelved = await shelvedAt(ws.archiveBoardsDir(), name);
  const wanted = shelved?.id ?? name;

  const id = await withBoardRegistry(ws, async () => {
    const candidate = await uniqueSlug(wanted, (slug) => boardSlugTaken(ws, slug));
    await movePath(from, ws.boardDir(candidate));
    return candidate;
  });

  // The directory is back but `board.json` still calls itself by its old id,
  // and everything downstream keys on that field rather than on the path.
  const board = await readBoardFile(ws, id) as Board & { shelvedAt?: string };
  board.id = id;
  // It is not shelved any more. Left in place it would be stale metadata on a
  // live board, and archiving it again restamps it regardless.
  delete board.shelvedAt;
  /*
   * Deliberately dropped: a parent that no longer exists, or that never took
   * this board back into its `childBoards`, would leave the restored board
   * invisible — nested under something that does not list it. It comes back as
   * a board of its own, which is at least reachable.
   */
  delete board.parentBoard;
  delete board.parentNode;
  await writeBoardFile(ws, board);

  const snapshots = path.join(ws.archiveRoot(), 'snapshots', name);
  if (await exists(snapshots)) await movePath(snapshots, ws.snapshotsDir(id));
  if (await exists(ws.archiveNodesDir(name))) {
    await movePath(ws.archiveNodesDir(name), ws.archiveNodesDir(id));
  }

  /*
   * A restore can come back under a different slug — the name may have been
   * taken while it was away — and anything keyed on the old one has to follow,
   * or the board returns unfiled and unstarred. That would break the promise
   * `folders` is built on: an assignment for an absent board is kept precisely
   * so a restore lands it back where it lived, and it cannot land anywhere if
   * nobody says the id moved.
   *
   * Only when it actually changed. Announcing a no-op rename would make every
   * listener do work to arrive where it already was.
   */
  if (id !== wanted) {
    emitBoardIdentityChange({ userId: ws.userId, oldId: wanted, newId: id });
  }
  return board;
}

/**
 * Archive → deleted. Moves, never removes: the owner stops seeing it, the files
 * stay, and only a Super Admin can go further. This is the "delete" a person is
 * offered, and it is deliberately not one.
 */
export async function deleteArchivedBoard(ws: Workspace, entry: string): Promise<{ deleted: string }> {
  const name = safeArchiveName(entry);
  const from = path.join(ws.archiveBoardsDir(), name);
  if (!(await exists(from))) throw notFound(`No archived board to delete: ${entry}`);

  const target = await archivePath(from, ws.deletedBoardsDir(), name);
  // Re-stamped: on the admin's list this field answers "when did they delete
  // it", which is a different question from when they archived it.
  await stampShelved(target);
  // Snapshots and archived nodes travel with it, or a later board reusing the
  // slug would inherit them — the same rule archiving already follows.
  const movedAs = path.basename(target);
  const snapshots = path.join(ws.archiveRoot(), 'snapshots', name);
  if (await exists(snapshots)) {
    await movePath(snapshots, path.join(ws.deletedRoot(), 'snapshots', movedAs));
  }
  if (await exists(ws.archiveNodesDir(name))) {
    await movePath(ws.archiveNodesDir(name), path.join(ws.deletedRoot(), 'nodes', movedAs));
  }
  return { deleted: movedAs };
}

/**
 * The one place in this system that destroys anything, and it is a Super
 * Admin's to call. Everything else moves files; this removes them, and there is
 * nothing behind it — which is why the route is admin-only and the UI asks
 * twice. It takes a workspace because a board belongs to a person even after
 * they have stopped being able to see it.
 */
export async function purgeDeletedBoard(ws: Workspace, entry: string): Promise<{ purged: string }> {
  const name = safeArchiveName(entry);
  const from = path.join(ws.deletedBoardsDir(), name);
  if (!(await exists(from))) throw notFound(`No deleted board to purge: ${entry}`);

  await removePath(from);
  await removePath(path.join(ws.deletedRoot(), 'snapshots', name));
  await removePath(path.join(ws.deletedRoot(), 'nodes', name));
  return { purged: name };
}

/*
 * ---- the starter workspace (v1.9) ----
 *
 * Every new account opens on the same boards: the docs, as boards, in a folder.
 * They are both the explanation of the app and a demonstration of it, which is
 * the point — an empty canvas explains nothing, and a page of prose about a
 * visual tool is the wrong medium for its own subject.
 *
 * Copied from `templates/starter/`, which is a *capture of real boards* rather
 * than something a seed script rebuilds from code (see scripts/make-template.mjs).
 * A reconstruction drifts from the boards it describes every time either side is
 * edited; a copy cannot.
 *
 * Slugs are per-workspace, so a fresh account has nothing to collide with and
 * the ids, `parentBoard` links and `childBoards` in the copied files stay
 * self-consistent without rewriting a thing.
 */
// `__dirname` does not exist in ESM, and referencing it makes Node refuse to
// decide the module format at all — the server would not boot. Same derivation
// `index.ts` uses for CLIENT_DIR.
const TEMPLATE_DIR =
  process.env.TEMPLATE_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../templates/starter');

interface StarterManifest {
  folder: { name: string; color?: string };
  roots: string[];
  boards: string[];
}

/**
 * Plant the starter boards in a brand-new workspace.
 *
 * Best-effort by design: a missing or damaged template must not stop an account
 * being created. Somebody who cannot sign in is a worse outcome than somebody
 * whose first screen is empty, and the second is obvious and fixable while the
 * first looks like the app is broken.
 *
 * Refuses to run on a workspace that already has boards, so it can never
 * overwrite anyone's work if it is called twice.
 */
export async function seedStarterWorkspace(ws: Workspace): Promise<number> {
  try {
    const manifest = await readJson<StarterManifest>(path.join(TEMPLATE_DIR, 'manifest.json'));
    if (!manifest?.boards?.length) return 0;

    await ensureWorkspace(ws);
    const existing = await listDirs(ws.boardsDir());
    if (existing.length > 0) return 0;

    const copied: string[] = [];
    for (const id of manifest.boards) {
      const from = path.join(TEMPLATE_DIR, 'boards', id);
      if (!(await exists(from))) continue;
      await copyDir(from, ws.boardDir(id));
      copied.push(id);
    }
    if (!copied.length) return 0;

    /*
     * The folder is written directly rather than through `createFolder` +
     * `fileBoards`: this runs before the account has ever been used, there is
     * no concurrent writer to lock against, and one write is easier to reason
     * about than three. Colour is taken verbatim — the template came from a
     * deployment that already validated it.
     */
    const folderId = mintId('folder');
    const roots = manifest.roots?.filter((id) => copied.includes(id)) ?? copied;
    await writeJson(ws.foldersFile(), {
      folders: [{ id: folderId, name: manifest.folder.name, ...(manifest.folder.color ? { color: manifest.folder.color } : {}), order: 0 }],
      assignments: Object.fromEntries(roots.map((id) => [id, folderId])),
      favorites: [],
    });
    return copied.length;
  } catch {
    // See above — an account without its welcome boards still works.
    return 0;
  }
}
