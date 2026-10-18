/**
 * Copying a selection (v1.6 §6). Duplicate-in-place and paste-into-another-board
 * are the same operation with a different placement, so there is one algorithm
 * here and two callers — the rules §6.1 lists (new ids, internal edges kept,
 * boundary edges dropped, frames carried, `childBoard` cleared) cannot diverge
 * between them because there is nowhere for them to diverge.
 *
 * Nothing in this file knows what a map or a graph is. A node is a directory and
 * a `type` string; the target world resolves a type it does not recognise to its
 * own default (v1.5 registry), which is the whole of "cross-board-type paste is
 * allowed" — there is no branch for it.
 */
import type {
  Board,
  BoardEdge,
  BoardFrame,
  BoardNode,
  ClipboardSelection,
  CopyResult,
} from '@cartograph/shared';
import { badRequest } from '../../core/errors.js';
import { newNodeFile, parseNodeFile, serializeNodeFile } from '../../core/markdown.js';
import {
  type Workspace,
  copyDir,
  exists,
  readText,
  uniqueSlug,
  writeText,
} from '../../core/storage.js';
import { getBoard, nodeIdTaken, readBoardFile, writeBoardFile } from '../boards/index.js';

/** Where the copies land. Exactly one of the two is set (§6.1 vs §6.2). */
export type CopyPlacement =
  /** Duplicate in place: every element moves by the same fixed amount. */
  | { kind: 'offset'; dx: number; dy: number }
  /** Paste: the group's bounding box is centred on a point the client picked. */
  | { kind: 'centre'; x: number; y: number };

export interface CopySide {
  ws: Workspace;
  boardId: string;
}

/** §6.1's offset, in flow units. */
export const DUPLICATE_OFFSET = 24;

let seq = 0;

/**
 * Frames and edges live only in board.json, so their ids are opaque strings
 * rather than path segments — the same shape the canvas mints locally.
 */
function mintId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 5)}`;
}

const idList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && !!id) : [];

/** A selection off the wire is a list of strings and nothing more is assumed. */
export function readSelection(payload: unknown): ClipboardSelection {
  const raw = (payload ?? {}) as Partial<ClipboardSelection>;
  const selection = { nodeIds: idList(raw.nodeIds), frameIds: idList(raw.frameIds) };
  if (!selection.nodeIds.length && !selection.frameIds.length) {
    throw badRequest('Nothing was selected to copy.');
  }
  return selection;
}

/**
 * What the selection actually covers on the source board: the named frames, and
 * the named nodes *plus* every member of a named frame. Selecting a frame is how
 * "frames with their contents" (§6.1) is expressed — a frame whose members were
 * left behind would copy as an empty box.
 */
function resolve(board: Board, selection: ClipboardSelection) {
  const frameIds = new Set(
    selection.frameIds.filter((id) => board.frames.some((frame) => frame.id === id)),
  );
  const nodeIds = new Set(selection.nodeIds);
  for (const node of board.nodes) {
    if (node.frameId && frameIds.has(node.frameId)) nodeIds.add(node.id);
  }
  return {
    frames: board.frames.filter((frame) => frameIds.has(frame.id)),
    nodes: board.nodes.filter((node) => nodeIds.has(node.id)),
  };
}

/** The group's footprint, so a paste can be centred on the viewport. */
function boundingBox(nodes: BoardNode[], frames: BoardFrame[]) {
  const boxes = [
    ...nodes.map((n) => ({ ...n.position, ...(n.size ?? { width: 0, height: 0 }) })),
    ...frames.map((f) => ({ ...f.position, ...f.size })),
  ];
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { minX, minY, maxX, maxY };
}

function shift(
  placement: CopyPlacement,
  nodes: BoardNode[],
  frames: BoardFrame[],
): { dx: number; dy: number } {
  if (placement.kind === 'offset') return { dx: placement.dx, dy: placement.dy };
  const box = boundingBox(nodes, frames);
  return {
    dx: Math.round(placement.x - (box.minX + box.maxX) / 2),
    dy: Math.round(placement.y - (box.minY + box.maxY) / 2),
  };
}

/**
 * A copy keeps its title unless the target board already carries it, in which
 * case it gets §6.1's suffix. Duplicating in place always collides — which is
 * why "duplicate" reads as " copy" — while pasting into a board that never had
 * the node keeps the name the author chose.
 */
function titleFor(title: string, taken: Set<string>): string {
  const key = title.trim().toLowerCase();
  return taken.has(key) ? `${title} copy` : title;
}

export async function copySelection(
  source: CopySide,
  target: CopySide,
  selection: ClipboardSelection,
  placement: CopyPlacement,
): Promise<CopyResult> {
  const sourceBoard = await readBoardFile(source.ws, source.boardId);
  // Duplicating in place reads and writes one file: two objects would mean the
  // second write silently dropped whatever the first one added.
  const sameBoard = source.ws.root === target.ws.root && source.boardId === target.boardId;
  const targetBoard = sameBoard ? sourceBoard : await readBoardFile(target.ws, target.boardId);

  const picked = resolve(sourceBoard, selection);
  if (!picked.nodes.length && !picked.frames.length) {
    throw badRequest('Nothing in that selection is still on the board.');
  }

  const { dx, dy } = shift(placement, picked.nodes, picked.frames);

  const frameMap = new Map<string, string>();
  const newFrames: BoardFrame[] = [];
  for (const frame of picked.frames) {
    const id = mintId('frame');
    frameMap.set(frame.id, id);
    newFrames.push({
      ...frame,
      id,
      position: { x: frame.position.x + dx, y: frame.position.y + dy },
    });
  }

  const titles = new Set(targetBoard.nodes.map((n) => n.title.trim().toLowerCase()));
  const claimed = new Set<string>();
  const nodeMap = new Map<string, string>();
  const newNodes: BoardNode[] = [];

  for (const node of picked.nodes) {
    // The file is truth: its frontmatter title is the one being copied, even if
    // board.json's cache has drifted.
    const raw = await readText(source.ws.nodeFile(source.boardId, node.id));
    const parsed = raw === null ? null : parseNodeFile(raw, node.id);
    const title = titleFor(parsed?.frontmatter.title ?? node.title, titles);
    titles.add(title.trim().toLowerCase());

    const newId = await uniqueSlug(title, async (candidate) => {
      if (claimed.has(candidate)) return true;
      if (targetBoard.nodes.some((n) => n.id === candidate)) return true;
      return nodeIdTaken(target.ws, target.boardId, candidate);
    });
    claimed.add(newId);
    nodeMap.set(node.id, newId);

    // One directory copy carries the body, the Data sidecar and anything else a
    // future node file grows — which is why a classic node pasted into a graph
    // arrives whole rather than converted (§6.2).
    if (await exists(source.ws.nodeDir(source.boardId, node.id))) {
      await copyDir(
        source.ws.nodeDir(source.boardId, node.id),
        target.ws.nodeDir(target.boardId, newId),
      );
    }
    await writeText(
      target.ws.nodeFile(target.boardId, newId),
      parsed
        ? serializeNodeFile({ ...parsed.frontmatter, id: newId, title }, parsed.body)
        : newNodeFile(newId, title),
    );

    const copy: BoardNode = {
      ...node,
      id: newId,
      title,
      position: { x: node.position.x + dx, y: node.position.y + dy },
      // Membership follows the selection: into a copied frame when one came
      // along, into the original when duplicating inside the same board, and
      // nowhere at all when the frame was left behind in another board.
      frameId: node.frameId
        ? (frameMap.get(node.frameId) ?? (sameBoard ? node.frameId : undefined))
        : undefined,
    };
    // A copy points at no sub-board (§6.1): copying a whole tree is a
    // board-level operation, never a side effect of duplicating a node.
    delete copy.childBoards;
    // Server-computed on every read; board.json must not carry them.
    delete copy.hasData;
    delete copy.passesData;
    delete copy.coverage;
    delete copy.description;
    delete copy.tags;
    newNodes.push(copy);
  }

  // Internal means both ends were copied. Everything else crossed the selection
  // boundary and is dropped — an edge to a node that stayed behind would either
  // dangle or quietly re-point the copy at the original.
  const newEdges: BoardEdge[] = [];
  for (const edge of sourceBoard.edges) {
    const from = nodeMap.get(edge.source);
    const to = nodeMap.get(edge.target);
    if (!from || !to) continue;
    newEdges.push({ ...edge, id: mintId('edge'), source: from, target: to });
  }

  targetBoard.frames.push(...newFrames);
  targetBoard.nodes.push(...newNodes);
  targetBoard.edges.push(...newEdges);
  await writeBoardFile(target.ws, targetBoard);

  return {
    board: await getBoard(target.ws, target.boardId),
    nodeIds: newNodes.map((n) => n.id),
    frameIds: newFrames.map((f) => f.id),
  };
}
