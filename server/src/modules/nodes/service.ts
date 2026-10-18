import path from 'node:path';
import type {
  BoardNode,
  CreateNodePayload,
  IncomingData,
  NodeContent,
  NodeFrontmatter,
  NodeShape,
  PatchNodePayload,
} from '@cartograph/shared';
import { DEFAULT_NODE_SIZE, DEFAULT_SHAPE, DEFAULT_STATUS, defaultNodeType } from '@cartograph/shared';
import { assertKnownShape, assertKnownStatus, resolveColor } from '../../core/config.js';
import { badRequest, notFound } from '../../core/errors.js';
import { withLock } from '../../core/locks.js';
import { gridPlacer } from '../../core/layout.js';
import {
  coverageOf,
  parseNodeFile,
  serializeNodeFile,
  validateRawNodeFile,
} from '../../core/markdown.js';
import { isEmpty as dataIsEmpty, outputSnippet, readNodeData, writeNodeData } from '../../core/data.js';
import { rewriteLinkTitles } from '../../core/links.js';
import {
  type Workspace,
  archivePath,
  ensureDir,
  exists,
  listDirs,
  movePath,
  readText,
  slugify,
  today,
  uniqueSlug,
  writeText,
} from '../../core/storage.js';
import { boardExists, nodeIdTaken, readBoardFile, writeBoardFile } from '../boards/index.js';

function requireNode(nodes: BoardNode[], nodeId: string): BoardNode {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) throw notFound(`Node not found: ${nodeId}`);
  return node;
}

/**
 * One node in a batch create (v1.7 §3). Everything but the title is optional,
 * because the thing asking may be describing a process rather than drawing one:
 * an absent position is placed rather than defaulted (`core/layout`), and a body
 * written at creation time saves a second round trip per node.
 *
 * Server-local rather than in `packages/shared` — the client has no batch create
 * and naming a payload both sides do not send is how a shared type starts
 * describing one caller's habits.
 */
export interface NewNodeInput {
  title: string;
  description?: string;
  body?: string;
  status?: string;
  /** A palette id or token; validated against the deployment's colours. */
  color?: string;
  /** Read by the graph world's colour-by-tag grouping (v1.5 §3.2). */
  tags?: string[];
  shape?: NodeShape;
  frameId?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  /** Which token drew it and when. Set by the MCP layer only (v1.7 §4). */
  createdBy?: { token: string; at: string };
}

/**
 * Creates any number of nodes under one lock and one `board.json` write.
 *
 * Batch-shaped because that is how the callers arrive: an agent lays down a
 * whole flow at once, and doing it one-at-a-time would take the board's lock
 * fifty times and rewrite the whole file behind each one. Nothing is written
 * until every node in the batch has a file, so a bad title halfway through
 * leaves the board exactly as it was.
 */
export async function createNodes(
  ws: Workspace,
  boardId: string,
  inputs: readonly NewNodeInput[],
): Promise<BoardNode[]> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const place = gridPlacer(board);
    const frameIds = new Set(board.frames.map((f) => f.id));
    const created: BoardNode[] = [];

    for (const input of inputs) {
      const title = (input.title ?? '').trim() || 'Untitled';
      // Asked against the batch as it grows, not just the board as it was found:
      // two nodes called the same thing in one call must not claim one slug.
      const id = await uniqueSlug(title, async (candidate) => {
        if (board.nodes.some((n) => n.id === candidate)) return true;
        return nodeIdTaken(ws, boardId, candidate);
      });

      // Validated rather than trusted: a caller that is not the canvas has not
      // just read the deployment's status list, and may be guessing.
      const status = input.status?.trim()
        ? await assertKnownStatus(input.status.trim())
        : DEFAULT_STATUS;
      // Same rule as status: a shape or colour is only ever set to one this
      // deployment defines, whoever is asking.
      if (input.shape !== undefined) await assertKnownShape(input.shape);
      const color = await resolveColor(input.color);
      const description = input.description?.trim();
      const body = input.body ?? '\n';
      const frontmatter: NodeFrontmatter = {
        id,
        title,
        created: today(),
        status,
        tags: (input.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean),
        ...(description ? { description } : {}),
      };

      await ensureDir(ws.nodeDir(boardId, id));
      await writeText(ws.nodeFile(boardId, id), serializeNodeFile(frontmatter, body));

      const size = input.size ?? { ...DEFAULT_NODE_SIZE };
      const node: BoardNode = {
        id,
        // Left out of the frontmatter: absent already means "this world's default".
        type: defaultNodeType(board.boardType),
        title,
        position: input.position ?? place(size),
        size,
        shape: input.shape ?? DEFAULT_SHAPE,
        status,
        ...(color ? { color } : {}),
        // A frame that isn't on this board is dropped rather than refused — the
        // node is still worth having, and membership is decided by containment
        // the moment anyone drags it.
        ...(input.frameId && frameIds.has(input.frameId) ? { frameId: input.frameId } : {}),
        ...(input.createdBy ? { createdVia: 'mcp' as const, createdBy: input.createdBy } : {}),
      };
      board.nodes.push(node);
      created.push({ ...node, hasData: false, coverage: coverageOf(body) });
    }

    await writeBoardFile(ws, board);
    return created;
  });
}

/**
 * The single-node route's shape. One implementation underneath, so the canvas
 * and an agent cannot end up creating subtly different nodes.
 */
export async function createNode(
  ws: Workspace,
  boardId: string,
  payload: CreateNodePayload,
): Promise<BoardNode> {
  const [node] = await createNodes(ws, boardId, [
    {
      title: payload.title,
      position: payload.position,
      shape: payload.shape,
      size: payload.size,
    },
  ]);
  return node;
}


export async function getNodeContent(
  ws: Workspace,
  boardId: string,
  nodeId: string,
): Promise<NodeContent> {
  const raw = await readText(ws.nodeFile(boardId, nodeId));
  if (raw === null) throw notFound(`Node file not found: ${nodeId}`);
  const { frontmatter, body } = parseNodeFile(raw, nodeId);
  const data = await readNodeData(ws, boardId, nodeId);
  return { frontmatter, body, data, incoming: await incomingFor(ws, boardId, nodeId) };
}

/**
 * What flows into a node: for every inbound edge, the source's marked output
 * snippet. Computed from the graph on every read — there is no stored copy to
 * drift out of date (§5.1).
 */
export async function incomingFor(
  ws: Workspace,
  boardId: string,
  nodeId: string,
): Promise<IncomingData[]> {
  const board = await readBoardFile(ws, boardId);
  const incoming: IncomingData[] = [];

  for (const edge of board.edges.filter((e) => e.target === nodeId)) {
    const source = board.nodes.find((n) => n.id === edge.source);
    if (!source) continue;
    const snippet = outputSnippet(await readNodeData(ws, boardId, source.id));
    if (!snippet) continue;
    incoming.push({
      edgeId: edge.id,
      sourceId: source.id,
      sourceTitle: source.title,
      snippet,
    });
  }
  return incoming;
}

export async function getRaw(ws: Workspace, boardId: string, nodeId: string): Promise<string> {
  const raw = await readText(ws.nodeFile(boardId, nodeId));
  if (raw === null) throw notFound(`Node file not found: ${nodeId}`);
  return raw;
}

export async function putBody(
  ws: Workspace,
  boardId: string,
  nodeId: string,
  body: string,
): Promise<NodeContent> {
  return withLock(ws.boardFile(boardId), async () => {
    const file = ws.nodeFile(boardId, nodeId);
    const raw = await readText(file);
    if (raw === null) throw notFound(`Node file not found: ${nodeId}`);
    const parsed = parseNodeFile(raw, nodeId);
    await writeText(file, serializeNodeFile(parsed.frontmatter, body ?? ''));
    await touchBoard(ws, boardId);
    return getNodeContent(ws, boardId, nodeId);
  });
}


/**
 * Adds to a note instead of replacing it (v1.7 §3, `appendBody`).
 *
 * `putBody` takes the whole body, which makes "document this as you go" a
 * read-modify-write the caller has to perform across two round trips — and an
 * agent doing that loses whatever a person typed in between. Here the read and
 * the write are the same critical section, so nothing can land between them.
 */
export async function appendBody(
  ws: Workspace,
  boardId: string,
  nodeId: string,
  text: string,
): Promise<NodeContent> {
  return withLock(ws.boardFile(boardId), async () => {
    const file = ws.nodeFile(boardId, nodeId);
    const raw = await readText(file);
    if (raw === null) throw notFound(`Node file not found: ${nodeId}`);
    const { frontmatter, body } = parseNodeFile(raw, nodeId);
    const existing = body.replace(/\s+$/, '');
    // A blank line between the old prose and the new: markdown needs it to start
    // a new paragraph, and appending to an empty note must not open with one.
    const joined = existing ? `${existing}\n\n${text}` : text;
    await writeText(file, serializeNodeFile(frontmatter, joined));
    await touchBoard(ws, boardId);
    return getNodeContent(ws, boardId, nodeId);
  });
}

export async function putData(
  ws: Workspace,
  boardId: string,
  nodeId: string,
  data: unknown,
): Promise<NodeContent> {
  return withLock(ws.boardFile(boardId), async () => {
    if (!(await exists(ws.nodeFile(boardId, nodeId)))) throw notFound(`Node file not found: ${nodeId}`);
    await writeNodeData(ws, boardId, nodeId, data);
    await touchBoard(ws, boardId);
    return getNodeContent(ws, boardId, nodeId);
  });
}


export async function putRaw(
  ws: Workspace,
  boardId: string,
  nodeId: string,
  raw: string,
): Promise<NodeContent> {
  return withLock(ws.boardFile(boardId), async () => {
    const current = await readText(ws.nodeFile(boardId, nodeId));
    if (current === null) throw notFound(`Node file not found: ${nodeId}`);
    const existing = parseNodeFile(current, nodeId);
    const parsed = validateRawNodeFile(raw, existing.frontmatter.id);

    await writeText(ws.nodeFile(boardId, nodeId), serializeNodeFile(parsed.frontmatter, parsed.body));

    // board.json is a display cache — resync it from the file we just trusted.
    const board = await readBoardFile(ws, boardId);
    const node = requireNode(board.nodes, nodeId);
    node.title = parsed.frontmatter.title;
    node.status = parsed.frontmatter.status;
    await writeBoardFile(ws, board);

    return getNodeContent(ws, boardId, nodeId);
  });
}


export interface PatchResult {
  node: BoardNode;
  content: NodeContent;
  /** Set when a title change moved the file pair to a new slug. */
  renamedFrom?: string;
}

/**
 * Frontmatter edits. A title change renames the node directory, the board.json
 * node id, every edge that referenced it and every `[[Old Title]]` written in the
 * board's notes — all inside this one function (principle 2). The frontmatter
 * `id` never changes, so history survives renames (§3).
 */
export async function patchNode(
  ws: Workspace,
  boardId: string,
  nodeId: string,
  patch: PatchNodePayload,
): Promise<PatchResult> {
  return withLock(ws.boardFile(boardId), async () => {
    const file = ws.nodeFile(boardId, nodeId);
    const raw = await readText(file);
    if (raw === null) throw notFound(`Node file not found: ${nodeId}`);

    const board = await readBoardFile(ws, boardId);
    const node = requireNode(board.nodes, nodeId);
    const { frontmatter, body } = parseNodeFile(raw, nodeId);
    const previousTitle = frontmatter.title;

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw badRequest('Title cannot be empty.');
      frontmatter.title = title;
      node.title = title;
    }
    if (patch.status !== undefined) {
      // Same rule as creation: a status is only ever set to one this deployment
      // defines, whoever is asking.
      const status = await assertKnownStatus(patch.status);
      frontmatter.status = status;
      node.status = status;
    }
    if (patch.tags !== undefined) {
      frontmatter.tags = patch.tags.map((t) => String(t).trim()).filter(Boolean);
    }
    if (patch.description !== undefined) {
      const description = patch.description.trim();
      if (description) frontmatter.description = description;
      else delete frontmatter.description;
    }

    let newId = nodeId;
    if (patch.title !== undefined) {
      const desired = slugify(frontmatter.title);
      // Naming a node that was never written to is creation, not a rename:
      // the permanent id follows the first real title instead of "untitled".
      const untouched =
        frontmatter.id === nodeId &&
        body.trim().length === 0 &&
        !(await exists(ws.nodeDataFile(boardId, nodeId)));
      if (desired !== nodeId) {
        newId = await uniqueSlug(desired, async (candidate) => {
          if (candidate === nodeId) return true; // force a fresh slug rather than a no-op collision
          if (board.nodes.some((n) => n.id === candidate)) return true;
          return nodeIdTaken(ws, boardId, candidate);
        });
        if (untouched) frontmatter.id = newId;
      }
    }

    await writeText(file, serializeNodeFile(frontmatter, body));

    if (newId !== nodeId) {
      // The node is a directory: the whole thing moves, sidecar and all.
      await movePath(ws.nodeDir(boardId, nodeId), ws.nodeDir(boardId, newId));
      node.id = newId;
      for (const edge of board.edges) {
        if (edge.source === nodeId) edge.source = newId;
        if (edge.target === nodeId) edge.target = newId;
      }
    }

    // Same operation, after the move so these ids are the live ones: every note
    // that pointed at the old title now points at the new one (v1.5 §4.1).
    if (frontmatter.title !== previousTitle) {
      await rewriteLinkTitles(
        ws,
        boardId,
        board.nodes.map((n) => n.id),
        previousTitle,
        frontmatter.title,
      );
    }

    await writeBoardFile(ws, board);
    const content = await getNodeContent(ws, boardId, newId);
    return {
      node: {
        ...node,
        hasData: content.data !== null,
        passesData: !!outputSnippet(content.data),
        coverage: coverageOf(content.body),
      },
      content,
      renamedFrom: newId !== nodeId ? nodeId : undefined,
    };
  });
}


/*
 * Duplicating used to live here, one node at a time. It is a selection operation
 * now (v1.6 §6.1) and moved whole to modules/clipboard, which duplicates one node
 * and twenty by the same code path.
 */

export async function archiveNode(
  ws: Workspace,
  boardId: string,
  nodeId: string,
): Promise<{ archived: string }> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    requireNode(board.nodes, nodeId);

    // One move: the node directory carries its body and sidecar with it.
    const target = await archivePath(
      ws.nodeDir(boardId, nodeId),
      ws.archiveNodesDir(boardId),
      nodeId,
    );

    board.nodes = board.nodes.filter((n) => n.id !== nodeId);
    board.edges = board.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    await writeBoardFile(ws, board);

    return { archived: path.basename(target) };
  });
}


/**
 * Links an existing board under a node. The child learns its parent, the node
 * learns its child — one operation, both files written here.
 */
export async function linkSubBoard(
  ws: Workspace,
  boardId: string,
  nodeId: string,
  childId: string,
): Promise<BoardNode> {
  return withLock(ws.boardFile(boardId), async () => {
    if (childId === boardId) throw badRequest('A board cannot be its own sub-board.');

    const board = await readBoardFile(ws, boardId);
    const node = requireNode(board.nodes, nodeId);
    const child = await readBoardFile(ws, childId);

    // Walk up from this board: linking an ancestor would close a loop.
    const seen = new Set<string>([boardId]);
    let cursor = board.parentBoard;
    while (cursor && !seen.has(cursor)) {
      if (cursor === childId) throw badRequest('That board already contains this one.');
      seen.add(cursor);
      cursor = (await readBoardFile(ws, cursor)).parentBoard;
    }

    if (node.childBoards?.includes(childId)) return node;

    // A board has one parent; linking moves it if it had another.
    if (child.parentBoard && child.parentBoard !== boardId) {
      const previous = await readBoardFile(ws, child.parentBoard);
      let changed = false;
      for (const other of previous.nodes) {
        if (other.childBoards?.includes(childId)) {
          other.childBoards = other.childBoards.filter((id) => id !== childId);
          if (!other.childBoards.length) delete other.childBoards;
          changed = true;
        }
      }
      if (changed) await writeBoardFile(ws, previous);
    }

    child.parentBoard = boardId;
    child.parentNode = nodeId;
    await writeBoardFile(ws, child);

    node.childBoards = [...(node.childBoards ?? []), childId];
    await writeBoardFile(ws, board);
    return node;
  });
}


/** Drops the reference only — the board stays, as a top-level board. */
export async function unlinkSubBoard(
  ws: Workspace,
  boardId: string,
  nodeId: string,
  childId: string,
): Promise<BoardNode> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const node = requireNode(board.nodes, nodeId);

    node.childBoards = (node.childBoards ?? []).filter((id) => id !== childId);
    if (!node.childBoards.length) delete node.childBoards;
    await writeBoardFile(ws, board);

    if (await boardExists(ws, childId)) {
      const child = await readBoardFile(ws, childId);
      if (child.parentBoard === boardId) {
        delete child.parentBoard;
        delete child.parentNode;
        await writeBoardFile(ws, child);
      }
    }
    return node;
  });
}


/**
 * The other half of "archive, never delete": puts an archived node directory back
 * and re-registers the node. This is what makes undo of an archive real on disk.
 */
export async function restoreNode(
  ws: Workspace,
  boardId: string,
  nodeId: string,
  placement?: Partial<BoardNode>,
): Promise<BoardNode> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);

    if (!(await exists(ws.nodeDir(boardId, nodeId)))) {
      const archived = await findArchived(ws, boardId, nodeId);
      if (!archived) throw notFound(`No archived node to restore: ${nodeId}`);
      await movePath(ws.archivedNodeDir(boardId, archived), ws.nodeDir(boardId, nodeId));
    }

    const raw = await readText(ws.nodeFile(boardId, nodeId));
    const parsed = raw ? parseNodeFile(raw, nodeId) : null;

    const existing = board.nodes.find((n) => n.id === nodeId);
    const node: BoardNode = existing ?? {
      id: nodeId,
      title: parsed?.frontmatter.title ?? nodeId,
      position: placement?.position ?? { x: 0, y: 0 },
      size: placement?.size ?? { ...DEFAULT_NODE_SIZE },
      shape: placement?.shape ?? DEFAULT_SHAPE,
      color: placement?.color,
      status: parsed?.frontmatter.status ?? DEFAULT_STATUS,
      type: parsed?.frontmatter.type ?? defaultNodeType(board.boardType),
      childBoards: placement?.childBoards,
    };
    if (!existing) board.nodes.push(node);
    await writeBoardFile(ws, board);

    const data = await readNodeData(ws, boardId, nodeId);
    return {
      ...node,
      hasData: !dataIsEmpty(data),
      passesData: !!outputSnippet(data),
      coverage: coverageOf(parsed?.body ?? ''),
    };
  });
}


/** The archived directory for a node id, newest first. */
async function findArchived(
  ws: Workspace,
  boardId: string,
  nodeId: string,
): Promise<string | null> {
  const dirs = await listDirs(ws.archiveNodesDir(boardId));
  if (dirs.includes(nodeId)) return nodeId;
  // Collisions are stored as {id}--{timestamp} — take the most recent.
  const candidates = dirs.filter((d) => d.startsWith(`${nodeId}--`)).sort();
  return candidates[candidates.length - 1] ?? null;
}

async function touchBoard(ws: Workspace, boardId: string): Promise<void> {
  const board = await readBoardFile(ws, boardId);
  await writeBoardFile(ws, board);
}
