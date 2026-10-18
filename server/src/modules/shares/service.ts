/**
 * Sharing (v1.6 §5). A share is a *fact about the system* — who may look at
 * whose board — so it is a row in `shares` and nothing about it is written to
 * the volume. The board files of the owner are never touched by sharing,
 * unsharing, or being looked at; that is what makes revoke instantaneous and
 * lossless.
 */
import type { Board, BoardSummary, SharedBoardSummary, ShareRecipient } from '@cartograph/shared';
import { execute, newId, queryAll, queryOne } from '../../core/db.js';
import type { BoardIdentityChange } from '../../core/boardEvents.js';
import { conflict, notFound } from '../../core/errors.js';
import {
  type Workspace,
  copyDir,
  ensureDir,
  exists,
  isSafeId,
  removePath,
  nowIso,
  today,
  uniqueSlug,
  workspaceFor,
} from '../../core/storage.js';
import {
  boardExists,
  boardSlugTaken,
  listBoards,
  readBoardFile,
  withBoardRegistry,
  writeBoardFile,
} from '../boards/index.js';
import { getUser } from '../auth/index.js';

interface ShareRow {
  id: string;
  board_id: string;
  owner_id: string;
  recipient_id: string;
  can_duplicate: number;
  include_children: number;
  can_export: number;
  created_at: string;
  /** NULL until the recipient first opens the board — "never", honestly. */
  last_accessed_at: string | null;
}

// ---- the table ----

export function sharesOfBoard(ownerId: string, boardId: string): ShareRow[] {
  return queryAll<ShareRow>(
    `SELECT * FROM shares WHERE owner_id = @owner AND board_id = @board ORDER BY created_at`,
    { owner: ownerId, board: boardId },
  );
}

/** Every share handed to one person, newest first. */
export function sharesToRecipient(recipientId: string): ShareRow[] {
  return queryAll<ShareRow>(
    `SELECT * FROM shares WHERE recipient_id = @me ORDER BY created_at DESC`,
    { me: recipientId },
  );
}

function sharesFromTo(ownerId: string, recipientId: string): ShareRow[] {
  return queryAll<ShareRow>(
    `SELECT * FROM shares WHERE owner_id = @owner AND recipient_id = @me`,
    { owner: ownerId, me: recipientId },
  );
}

/**
 * The one row a duplicate request is allowed to act on. Board ids are slugs, so
 * the table's `UNIQUE(board_id, recipient_id)` makes "this slug, shared to me"
 * address at most one share — which is why the duplicate route needs no owner.
 */
export function shareOfRecipient(recipientId: string, boardId: string): ShareRow | undefined {
  return queryOne<ShareRow>(
    `SELECT * FROM shares WHERE recipient_id = @me AND board_id = @board`,
    { me: recipientId, board: boardId },
  );
}

/** Share, or re-share with different flags — the owner's toggles. */
export function putShare(
  ownerId: string,
  boardId: string,
  recipientId: string,
  canDuplicate: boolean,
  includeChildren: boolean,
  canExport: boolean,
): void {
  const existing = queryOne<ShareRow>(
    `SELECT * FROM shares WHERE board_id = @board AND recipient_id = @me`,
    { board: boardId, me: recipientId },
  );
  if (existing && existing.owner_id !== ownerId) {
    // Two people's boards can carry the same slug; the table can only hold one
    // of them per recipient. Say so rather than failing on a constraint.
    throw conflict(
      'Someone else has already shared a board with this id with that user — rename yours first.',
    );
  }
  if (existing) {
    execute(
      `UPDATE shares SET can_duplicate = @flag, include_children = @kids, can_export = @out
       WHERE id = @id`,
      {
        id: existing.id,
        flag: canDuplicate ? 1 : 0,
        kids: includeChildren ? 1 : 0,
        out: canExport ? 1 : 0,
      },
    );
    return;
  }
  execute(
    `INSERT INTO shares
       (id, board_id, owner_id, recipient_id, can_duplicate, include_children, can_export, created_at)
     VALUES (@id, @board, @owner, @me, @flag, @kids, @out, @created_at)`,
    {
      id: newId(),
      board: boardId,
      owner: ownerId,
      me: recipientId,
      flag: canDuplicate ? 1 : 0,
      kids: includeChildren ? 1 : 0,
      out: canExport ? 1 : 0,
      created_at: nowIso(),
    },
  );
}

/**
 * Keeps the table honest when a board's id moves or the board goes away.
 *
 * Board ids are slugs: renaming frees the old one and archiving frees it too,
 * and the next board named the same thing takes it. A share row left behind
 * would then point at a board its recipient was never given — so it follows the
 * rename, and is deleted when the board is.
 *
 * A rename can collide: if the recipient already holds a share on a board whose
 * slug matches the new id, `UNIQUE(board_id, recipient_id)` cannot hold both.
 * The stale row loses, because keeping it would mean the same silent re-grant
 * this function exists to prevent.
 */
export function followBoardIdentity(change: BoardIdentityChange): void {
  const { userId, oldId, newId } = change;
  if (newId === null) {
    execute('DELETE FROM shares WHERE owner_id = @owner AND board_id = @board', {
      owner: userId,
      board: oldId,
    });
    return;
  }
  execute(
    `DELETE FROM shares
      WHERE owner_id = @owner AND board_id = @old
        AND recipient_id IN (SELECT recipient_id FROM shares WHERE board_id = @new)`,
    { owner: userId, old: oldId, new: newId },
  );
  execute('UPDATE shares SET board_id = @new WHERE owner_id = @owner AND board_id = @old', {
    owner: userId,
    old: oldId,
    new: newId,
  });
}

/**
 * Records that a recipient opened a shared board, on the share row itself —
 * a fact about the arrangement, so it lives where the arrangement lives.
 *
 * The board named is preferred: opening the shared root stamps its own row.
 * A sub-board has no row of its own — visibility came down through a tree —
 * so its open falls back to stamping every share this owner holds out to this
 * recipient, which is almost always the one row the drill-down began from.
 */
export function touchShareAccess(recipientId: string, ownerId: string, boardId: string): void {
  const now = nowIso();
  const direct = execute(
    `UPDATE shares SET last_accessed_at = @now
     WHERE owner_id = @owner AND recipient_id = @me AND board_id = @board`,
    { now, owner: ownerId, me: recipientId, board: boardId },
  );
  if (direct === 0) {
    execute(
      `UPDATE shares SET last_accessed_at = @now
       WHERE owner_id = @owner AND recipient_id = @me`,
      { now, owner: ownerId, me: recipientId },
    );
  }
}

export function removeShare(ownerId: string, boardId: string, recipientId: string): number {
  return execute(
    'DELETE FROM shares WHERE owner_id = @owner AND board_id = @board AND recipient_id = @me',
    { owner: ownerId, board: boardId, me: recipientId },
  );
}

export function recipientsOf(ownerId: string, boardId: string): ShareRecipient[] {
  const rows = sharesOfBoard(ownerId, boardId);
  const recipients: ShareRecipient[] = [];
  for (const row of rows) {
    const user = getUser(row.recipient_id);
    if (!user) continue; // the account is gone; the row goes with it on cascade
    recipients.push({
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      canDuplicate: row.can_duplicate === 1,
      includeChildren: row.include_children === 1,
      canExport: row.can_export === 1,
      sharedAt: row.created_at,
      lastAccessedAt: row.last_accessed_at ?? undefined,
    });
  }
  return recipients;
}

/**
 * Who each of your boards is shared with, keyed by board id — what the dashboard
 * needs to mark a card as shared.
 *
 * A separate lookup rather than a field on `BoardSummary`, for two reasons: a
 * share is a row in the database and a summary describes a file, and `boards`
 * does not import `shares` (the dependency runs the other way).
 *
 * Only boards with a share row of their own appear. A sub-board that a recipient
 * can reach because its parent was shared is not itself a share, and saying so
 * would make the mark impossible to revoke from the card it appears on.
 */
export function shareNamesByBoard(ownerId: string): Record<string, string[]> {
  const rows = queryAll<ShareRow>(
    'SELECT * FROM shares WHERE owner_id = @owner ORDER BY created_at',
    { owner: ownerId },
  );
  const byBoard: Record<string, string[]> = {};
  for (const row of rows) {
    const user = getUser(row.recipient_id);
    if (!user) continue; // account gone; the row goes with it on cascade
    (byBoard[row.board_id] ??= []).push(user.displayName);
  }
  return byBoard;
}

// ---- the shared tree ----

/**
 * Every board a share reaches: the named board, plus its sub-board tree when the
 * share includes children.
 *
 * Walked *down* through `childBoards` — the same edges the drill-down UI walks —
 * rather than up through `parentBoard`, so a board is reachable exactly when a
 * viewer could click their way to it. Missing ids are skipped and a visited set
 * makes a cycle terminate; a tree this walk cannot reach is a board the share
 * does not cover.
 *
 * This is the only place the tree is computed, so it is also the only place the
 * children toggle has to be honoured — every consumer (what you can see, what you
 * may copy, what a duplicate copies) inherits the answer.
 */
export async function sharedTree(
  ws: Workspace,
  rootId: string,
  includeChildren = true,
): Promise<string[]> {
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = [rootId];

  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !isSafeId(id)) continue;
    if (!(await boardExists(ws, id))) continue;
    seen.add(id);
    order.push(id);
    if (!includeChildren) break; // the root alone; its drill-downs stay private
    const board = await readBoardFile(ws, id);
    for (const node of board.nodes) {
      for (const child of node.childBoards ?? []) queue.push(child);
    }
  }
  return order;
}

/** The union of every tree one person has been given in one workspace. */
export async function visibleBoardIds(
  ownerWs: Workspace,
  recipientId: string,
): Promise<Set<string> | null> {
  const rows = sharesFromTo(ownerWs.userId, recipientId);
  if (!rows.length) return null;
  const visible = new Set<string>();
  for (const row of rows) {
    for (const id of await sharedTree(ownerWs, row.board_id, row.include_children === 1)) visible.add(id);
  }
  return visible;
}

/**
 * The boards in one workspace this person may take a copy *out of* (§6.2): the
 * trees of the shares that carry the duplicate flag, and nothing else. Same rows
 * and same flag as the whole-board duplicate — copying a selection is the small
 * version of the same permission, so it must not be the easier one to get.
 */
export async function copyableBoardIds(
  ownerId: string,
  recipientId: string,
): Promise<Set<string>> {
  const ws = workspaceFor(ownerId);
  const copyable = new Set<string>();
  for (const row of sharesFromTo(ownerId, recipientId)) {
    if (row.can_duplicate !== 1) continue;
    for (const id of await sharedTree(ws, row.board_id, row.include_children === 1)) copyable.add(id);
  }
  return copyable;
}

/**
 * The boards in one workspace this person may download as markdown (§5).
 *
 * This is about *files leaving* — the node bodies as `.md`. It is deliberately
 * not what the clipboard reads: pasting a selection into a board of your own is
 * a copy, and copies answer to the duplicate flag above. Two different acts,
 * two flags, and neither stands in for the other.
 */
export async function exportableBoardIds(
  ownerId: string,
  recipientId: string,
): Promise<Set<string>> {
  const ws = workspaceFor(ownerId);
  const exportable = new Set<string>();
  for (const row of sharesFromTo(ownerId, recipientId)) {
    if (row.can_export !== 1) continue;
    for (const id of await sharedTree(ws, row.board_id, row.include_children === 1)) {
      exportable.add(id);
    }
  }
  return exportable;
}

/** The "Shared with me" section (§5): one card per share, with its owner. */
export async function sharedWithMe(recipientId: string): Promise<SharedBoardSummary[]> {
  const rows = sharesToRecipient(recipientId);
  const byOwner = new Map<string, BoardSummary[]>();
  const shared: SharedBoardSummary[] = [];

  for (const row of rows) {
    const owner = getUser(row.owner_id);
    if (!owner) continue;
    const ws = workspaceFor(row.owner_id);
    if (!byOwner.has(row.owner_id)) byOwner.set(row.owner_id, await listBoards(ws));
    const summary = byOwner.get(row.owner_id)!.find((s) => s.id === row.board_id);
    // A share whose board was archived or renamed simply stops appearing; the
    // row is harmless and the owner may still revoke it.
    if (!summary) continue;
    shared.push({
      ...summary,
      // A shared board is a root wherever it sat in the owner's tree — the
      // recipient cannot see its parent, so it must not claim one.
      parentBoard: undefined,
      // Same rule for the owner's organisation (v1.8 §1): shared boards live in
      // their own section and cannot be foldered by the recipient, so the
      // owner's folder id and star would be unusable here as well as private.
      folderId: undefined,
      favorite: undefined,
      ownerId: owner.id,
      ownerName: owner.displayName,
      sharedAt: row.created_at,
      canDuplicate: row.can_duplicate === 1,
      includeChildren: row.include_children === 1,
      canExport: row.can_export === 1,
      boardIds: await sharedTree(ws, row.board_id, row.include_children === 1),
      // A card must not advertise drill-downs the share withholds.
      subBoardCount:
        row.include_children === 1
          ? byOwner.get(row.owner_id)!.filter((s) => s.parentBoard === row.board_id).length
          : 0,
    });
  }
  return shared;
}

// ---- duplicate to my workspace (§5) ----

/**
 * Copies a whole shared tree into the recipient's root. The copy is theirs: new
 * board ids, every internal reference repointed at the new ids, node directories
 * copied byte for byte, and no path back to the original except the
 * `duplicatedFrom` note. Nothing in the owner's workspace is opened for writing.
 *
 * Ids are minted for the whole tree before anything is copied, so the remap is a
 * lookup rather than a second walk, and a slug that is already taken in the
 * recipient's workspace is stepped past exactly as a new board would step past it.
 */
export async function duplicateSharedTree(
  ownerId: string,
  rootId: string,
  target: Workspace,
  includeChildren = true,
): Promise<Board> {
  const ownerWs = workspaceFor(ownerId);
  const owner = getUser(ownerId);
  // A copy can only contain what the share reached: with children withheld, the
  // root arrives alone and its unmapped childBoards are dropped below.
  const ids = await sharedTree(ownerWs, rootId, includeChildren);
  if (!ids.length) throw notFound(`Board not found: ${rootId}`);

  const root = await readBoardFile(ownerWs, rootId);
  const idMap = new Map<string, string>();
  const claimed = new Set<string>();
  /*
   * Every name in the tree claimed in one pass, under the recipient's registry
   * lock — the same rule `createBoard` follows, and needed for the same reason:
   * a copy landing while the recipient creates a board of their own could
   * otherwise settle on one slug twice. `claimed` covers collisions *within*
   * this tree; the lock covers collisions with everyone else.
   */
  await withBoardRegistry(target, async () => {
    for (const oldId of ids) {
      const source = await readBoardFile(ownerWs, oldId);
      const newId = await uniqueSlug(
        source.name,
        async (candidate) => claimed.has(candidate) || boardSlugTaken(target, candidate),
      );
      claimed.add(newId);
      idMap.set(oldId, newId);
      // Claim the directory inside the lock, or the names go stale the moment
      // it is released and the next caller sees them as free.
      await ensureDir(target.nodesDir(newId));
    }
  });

  /*
   * Copy, then rewind if any of it fails. A tree left half-copied puts board
   * directories in the recipient's workspace whose board.json still carries the
   * owner's ids, so the dashboard lists cards that 404 when clicked. Better to
   * leave nothing behind than something unopenable.
   */
  const copied: string[] = [];
  try {
    for (const oldId of ids) {
      const dest = target.boardDir(idMap.get(oldId)!);
      await copyDir(ownerWs.boardDir(oldId), dest);
      copied.push(dest);
    }
  } catch (err) {
    for (const dir of copied.reverse()) await removePath(dir).catch(() => {});
    throw err;
  }

  for (const oldId of ids) {
    const newId = idMap.get(oldId)!;
    const copy = await readBoardFile(target, newId);
    copy.id = newId;
    // The root of the copied tree lands at the recipient's top level: its parent
    // is a board they were never shown and must not reference.
    const parent = copy.parentBoard ? idMap.get(copy.parentBoard) : undefined;
    if (parent) copy.parentBoard = parent;
    else {
      delete copy.parentBoard;
      delete copy.parentNode;
    }
    for (const node of copy.nodes) {
      if (!node.childBoards) continue;
      const mapped = node.childBoards
        .map((child) => idMap.get(child))
        .filter((child): child is string => !!child);
      if (mapped.length) node.childBoards = mapped;
      else delete node.childBoards;
    }
    copy.createdAt = nowIso();
    if (oldId === rootId) {
      copy.duplicatedFrom = {
        ownerName: owner?.displayName ?? 'a former user',
        boardName: root.name,
        date: today(),
      };
    }
    await writeBoardFile(target, copy);
  }

  return readBoardFile(target, idMap.get(rootId)!);
}
