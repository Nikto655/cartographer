import type { Board, BoardFrame, BoardNode, PromoteFrameResult } from '@cartograph/shared';
import { DEFAULT_NODE_SIZE, DEFAULT_SHAPE, defaultNodeType } from '@cartograph/shared';
import { resolveColor } from '../../core/config.js';
import { badRequest, notFound } from '../../core/errors.js';
import { mintId } from '../../core/ids.js';
import { frameAround } from '../../core/layout.js';
import { withLock } from '../../core/locks.js';
import { type Workspace, exists, movePath, writeJson, writeText } from '../../core/storage.js';
import { newNodeFile } from '../../core/markdown.js';
import { createBoard, getBoard, readBoardFile, writeBoardFile } from '../boards/index.js';
import { createSnapshot } from '../snapshots/index.js';

/**
 * A frame, optionally around nodes that already exist (v1.7 §3, `create_frame`).
 *
 * Frames have no file behind them, so this is a `board.json` edit and nothing
 * more. The box is sized to enclose its members because membership on the canvas
 * is decided by containment — a frame that did not contain the nodes it claims
 * would be corrected the moment anybody dragged anything.
 */
export async function createFrame(
  ws: Workspace,
  boardId: string,
  title: string,
  memberNodeIds: readonly string[] = [],
  color?: string | null,
): Promise<BoardFrame> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const members = board.nodes.filter((n) => memberNodeIds.includes(n.id));
    const missing = memberNodeIds.filter((id) => !board.nodes.some((n) => n.id === id));
    if (missing.length) {
      throw badRequest(`No node ${missing.map((id) => `“${id}”`).join(', ')} on board “${boardId}”.`);
    }

    const token = await resolveColor(color);
    const frame: BoardFrame = {
      id: mintId('frame'),
      title: (title ?? '').trim() || 'Section',
      ...frameAround(board, members),
      // Absent renders as slate, which is the canvas's "no opinion" tint rather
      // than a chosen colour — see FrameNode's `--frame-tint` fallback.
      ...(token ? { color: token } : {}),
    };
    // A node belongs to one frame; joining this one leaves whichever it was in.
    for (const member of members) member.frameId = frame.id;

    board.frames.push(frame);
    await writeBoardFile(ws, board);
    return frame;
  });
}

/**
 * Retitles, recolours or collapses a frame. An absent key is left alone;
 * `color: null` removes the colour, putting the box back to the untinted default.
 *
 * The box itself is not settable here — a frame's geometry follows its members
 * (`moveNodes` refits it), so there is nothing for a caller to set that would
 * not immediately be overwritten by the next thing that moved a node.
 */
export async function updateFrame(
  ws: Workspace,
  boardId: string,
  frameId: string,
  patch: { title?: string; color?: string | null; collapsed?: boolean },
): Promise<BoardFrame> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const frame = board.frames.find((f) => f.id === frameId);
    if (!frame) throw notFound(`Frame not found: ${frameId}`);

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw badRequest('A frame title cannot be empty.');
      frame.title = title;
    }
    if (patch.color !== undefined) {
      const token = await resolveColor(patch.color);
      if (token) frame.color = token;
      else delete frame.color;
    }
    if (patch.collapsed !== undefined) {
      if (patch.collapsed) frame.collapsed = true;
      else delete frame.collapsed; // absent already means open
    }

    await writeBoardFile(ws, board);
    return frame;
  });
}

/**
 * Moves nodes into a frame, or out of every frame when `frameId` is null
 * (v1.7 §3, `move_to_frame`).
 *
 * The frame grows to cover anything it has just taken in, and never shrinks. On
 * the canvas membership *is* containment — that is how dragging a node into a
 * box joins it — so a node recorded as a member while sitting outside the box is
 * a board that disagrees with itself, and the disagreement is resolved the
 * moment anybody drags anything. Growing the box is the smaller intrusion: it
 * moves no node, and it leaves the two facts saying the same thing.
 */
export async function setFrameMembership(
  ws: Workspace,
  boardId: string,
  nodeIds: readonly string[],
  frameId: string | null,
): Promise<BoardNode[]> {
  return withLock(ws.boardFile(boardId), async () => {
    const board = await readBoardFile(ws, boardId);
    const frame = frameId === null ? null : board.frames.find((f) => f.id === frameId);
    if (frameId !== null && !frame) throw notFound(`Frame not found: ${frameId}`);

    const moved: BoardNode[] = [];
    for (const nodeId of nodeIds) {
      const node = board.nodes.find((n) => n.id === nodeId);
      if (!node) throw badRequest(`No node “${nodeId}” on board “${boardId}”.`);
      if (frameId === null) delete node.frameId;
      else node.frameId = frameId;
      moved.push(node);
    }

    if (frame) {
      const members = board.nodes.filter((n) => n.frameId === frame.id);
      const wanted = frameAround(board, members);
      // Union with what the author already had: a frame drawn deliberately large
      // stays large, and only the sides that fell short move.
      const right = Math.max(
        frame.position.x + frame.size.width,
        wanted.position.x + wanted.size.width,
      );
      const bottom = Math.max(
        frame.position.y + frame.size.height,
        wanted.position.y + wanted.size.height,
      );
      frame.position = {
        x: Math.min(frame.position.x, wanted.position.x),
        y: Math.min(frame.position.y, wanted.position.y),
      };
      frame.size = {
        width: right - frame.position.x,
        height: bottom - frame.position.y,
      };
    }

    await writeBoardFile(ws, board);
    return moved;
  });
}

/**
 * Frame → sub-board (§3.2). One atomic server operation: the JSON for both
 * boards is staged in memory first and the file moves happen last, so a failure
 * leaves the volume exactly as it was.
 *
 * Promote is not client-undoable, so a snapshot is taken before anything moves.
 */
export async function promoteFrame(
  ws: Workspace,
  boardId: string,
  frameId: string,
): Promise<PromoteFrameResult> {
  const parent = await readBoardFile(ws, boardId);
  const frame = parent.frames.find((f) => f.id === frameId);
  if (!frame) throw notFound(`Frame not found: ${frameId}`);

  const members = parent.nodes.filter((n) => n.frameId === frameId);
  if (members.some((n) => n.childBoards?.length)) {
    throw badRequest('Promote a frame whose members have no sub-boards of their own.');
  }

  await createSnapshot(ws, boardId);

  const child = await createBoard(ws, { name: frame.title || 'Section', parentBoard: parent.id });
  const memberIds = new Set(members.map((n) => n.id));

  // Positions are kept relative to the frame origin so the layout survives the move.
  child.nodes = members.map((node) => ({
    ...node,
    frameId: undefined,
    position: {
      x: Math.round(node.position.x - frame.position.x),
      y: Math.round(node.position.y - frame.position.y),
    },
  }));

  const internal = parent.edges.filter((e) => memberIds.has(e.source) && memberIds.has(e.target));
  child.edges = internal.map((e) => ({ ...e }));
  child.frames = [];
  child.texts = [];

  // The frame becomes a drill-down node in the parent; crossing edges re-point to it.
  const replacementId = await uniqueNodeId(ws, parent, child.id);
  const replacement: BoardNode = {
    id: replacementId,
    type: defaultNodeType(parent.boardType),
    title: frame.title || 'Section',
    position: { ...frame.position },
    size: { ...DEFAULT_NODE_SIZE },
    shape: DEFAULT_SHAPE,
    status: majorityStatus(members),
    childBoards: [child.id],
  };

  const internalIds = new Set(internal.map((e) => e.id));
  const remainingEdges = parent.edges
    .filter((e) => !internalIds.has(e.id))
    .map((e) => ({
      ...e,
      source: memberIds.has(e.source) ? replacementId : e.source,
      target: memberIds.has(e.target) ? replacementId : e.target,
    }))
    .filter((e) => e.source !== e.target);

  // Drop duplicates created by collapsing several members onto one node.
  const seen = new Set<string>();
  parent.edges = remainingEdges.filter((e) => {
    const key = `${e.source}->${e.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  parent.nodes = parent.nodes.filter((n) => !memberIds.has(n.id));
  parent.nodes.push(replacement);
  parent.frames = parent.frames.filter((f) => f.id !== frameId);

  /*
   * Everything above is in memory. Below, the directories move first and the
   * two board.json files are committed only once they all landed.
   *
   * The order matters: writing the JSON first and then failing halfway through
   * the moves left the parent claiming it had handed the nodes over while some
   * were still sitting in it — a board inconsistent with its own files, with no
   * way back but the snapshot. Moves are rewound on failure, so a crash here
   * leaves the volume exactly as it was found.
   */
  const moved: Array<{ from: string; to: string }> = [];
  try {
    for (const node of members) {
      const from = ws.nodeDir(boardId, node.id);
      if (!(await exists(from))) continue;
      const to = ws.nodeDir(child.id, node.id);
      await movePath(from, to);
      moved.push({ from, to });
    }
  } catch (err) {
    for (const { from, to } of moved.reverse()) {
      await movePath(to, from).catch(() => {});
    }
    throw err;
  }

  // Both halves announced: the child is a board that did not exist a moment ago,
  // and the parent gained the card that drills into it. `writeJson` here left the
  // new board off every open shelf until a reload.
  await writeBoardFile(ws, child);
  await writeBoardFile(ws, parent);

  // The replacement node needs a file of its own, like any other node.
  await writeReplacementFile(ws, parent.id, replacement);

  return { board: await getBoard(ws, parent.id), childBoardId: child.id };
}

async function uniqueNodeId(ws: Workspace, board: Board, base: string): Promise<string> {
  const taken = new Set(board.nodes.map((n) => n.id));
  let candidate = base;
  let n = 1;
  while (taken.has(candidate) || (await exists(ws.nodeDir(board.id, candidate)))) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

function majorityStatus(members: BoardNode[]): string {
  const counts = new Map<string, number>();
  for (const member of members) counts.set(member.status, (counts.get(member.status) ?? 0) + 1);
  let best = 'sketched';
  let bestCount = -1;
  for (const [status, count] of counts) {
    if (count > bestCount) {
      best = status;
      bestCount = count;
    }
  }
  return best;
}

async function writeReplacementFile(ws: Workspace, boardId: string, node: BoardNode): Promise<void> {
  const file = ws.nodeFile(boardId, node.id);
  if (await exists(file)) return;
  await writeText(file, newNodeFile(node.id, node.title, node.status));
}
