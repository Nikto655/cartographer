/**
 * One-shot volume migrations. Everything here is idempotent: it runs on every
 * boot and does nothing once the volume is already in the current shape. Two of
 * them live here now — the v1.5 node-directory move below, and the v1.6 move of
 * the whole volume under a user root (see `runTenancyMigration`).
 *
 * v1.5 §2.1 — a node was a `{id}.md` + `{id}.data.json` pair sitting beside its
 * siblings; it is now a directory:
 *
 *     nodes/{id}/node.md
 *     nodes/{id}/data.json
 *
 * The move is per board and all-or-nothing: a failure part-way rewinds the moves
 * already made, so a board is never left half in each layout. The caller
 * snapshots first (see `runNodeDirMigration`) — this module owns no policy about
 * when a snapshot is taken, which is what keeps it free of module imports.
 */
import {
  NODE_DATA_FILE,
  NODE_FILE,
  type Workspace,
  entryPath,
  exists,
  legacyWorkspace,
  listDirs,
  listFiles,
  movePath,
  removePath,
  workspaceFor,
} from './storage.js';

/** `{id}.md`, `{id}.data.json`, and their `--{timestamp}` archive collision forms. */
const LEGACY_ENTRY_RE = /^(.+?)(\.data\.json|\.md)(--.+)?$/;

interface Move {
  from: string;
  /** The per-node directory `to` lands in — kept so a rewind can clean it up. */
  nodeDir: string;
  to: string;
}

function legacyMoves(dir: string, names: string[]): Move[] {
  const moves: Move[] = [];
  for (const name of names) {
    const match = LEGACY_ENTRY_RE.exec(name);
    if (!match) continue; // anything unrecognised (stray .tmp, notes, …) is left alone
    const [, base, suffix, stamp = ''] = match;
    const nodeDir = entryPath(dir, `${base}${stamp}`);
    moves.push({
      from: entryPath(dir, name),
      nodeDir,
      to: entryPath(nodeDir, suffix === '.md' ? NODE_FILE : NODE_DATA_FILE),
    });
  }
  return moves;
}

/** Empty for a directory already in the new layout — that is the idempotency check. */
async function pendingMoves(dir: string): Promise<Move[]> {
  return legacyMoves(dir, await listFiles(dir));
}

async function removeIfEmpty(dir: string): Promise<void> {
  const [files, dirs] = await Promise.all([listFiles(dir), listDirs(dir)]);
  if (files.length === 0 && dirs.length === 0) await removePath(dir);
}

/**
 * Moves one directory's worth of legacy node files into per-node directories.
 * Returns the number of files moved; 0 means there was nothing to do.
 */
async function applyMoves(moves: Move[]): Promise<number> {
  const done: Move[] = [];
  try {
    for (const move of moves) {
      await movePath(move.from, move.to);
      done.push(move);
    }
  } catch (err) {
    // Rewind, newest first, so the board is left exactly as it was found.
    for (const move of done.reverse()) {
      await movePath(move.to, move.from).catch(() => undefined);
    }
    for (const move of done) {
      await removeIfEmpty(move.nodeDir).catch(() => undefined);
    }
    throw err;
  }
  return done.length;
}

/** True when this board still stores its nodes as loose files. */
export async function boardNeedsNodeDirs(ws: Workspace, boardId: string): Promise<boolean> {
  return (await pendingMoves(ws.nodesDir(boardId))).length > 0;
}

export async function migrateBoardNodeDirs(ws: Workspace, boardId: string): Promise<number> {
  return applyMoves(await pendingMoves(ws.nodesDir(boardId)));
}

export async function migrateArchivedNodeDirs(ws: Workspace, boardId: string): Promise<number> {
  return applyMoves(await pendingMoves(ws.archiveNodesDir(boardId)));
}

export interface MigrationDeps {
  /** Taken before a board is touched. Injected so core keeps importing no modules. */
  snapshot: (ws: Workspace, boardId: string) => Promise<unknown>;
  log: (message: string) => void;
}

/**
 * Boot hook, now once per workspace. Every board that still holds loose node
 * files is snapshotted and then migrated; a board that fails is rewound and
 * reported, and the rest still migrate. The failure is rethrown at the end so a
 * bad volume is loud, not silently half-converted.
 */
export async function runNodeDirMigration(
  workspaces: readonly Workspace[],
  { snapshot, log }: MigrationDeps,
): Promise<void> {
  const failures: string[] = [];

  for (const ws of workspaces) {
    for (const boardId of await listDirs(ws.boardsDir())) {
      try {
        if (!(await boardNeedsNodeDirs(ws, boardId))) continue;
        const { timestamp } = (await snapshot(ws, boardId)) as { timestamp?: string };
        const moved = await migrateBoardNodeDirs(ws, boardId);
        log(
          `Migrated ${moved} node file(s) to node directories in ${boardId} (snapshot ${timestamp}).`,
        );
      } catch (err) {
        failures.push(`${ws.userId}/${boardId}: ${(err as Error).message}`);
      }
    }

    for (const boardId of await listDirs(ws.archiveNodesRoot())) {
      try {
        const moved = await migrateArchivedNodeDirs(ws, boardId);
        if (moved > 0) log(`Migrated ${moved} archived node file(s) for ${boardId}.`);
      } catch (err) {
        failures.push(`${ws.userId}/archive/${boardId}: ${(err as Error).message}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Node-directory migration failed (data left untouched): ${failures.join('; ')}`);
  }
}

// ---- v1.6 §8.1: one volume, one owner → one volume, one root per user ----

export interface TenancyDeps extends MigrationDeps {
  /**
   * Who inherits the pre-accounts volume — the bootstrap admin. Null on a fresh
   * install, where there is nothing to inherit and nobody to inherit it.
   */
  adminUserId: string | null;
  /** Said once per boot on an already-migrated volume; not worth an info line. */
  debug: (message: string) => void;
}

interface DirMove {
  label: string;
  from: string;
  to: string;
}

/**
 * Moves the legacy top-level `boards/ archive/ snapshots/` under the bootstrap
 * admin's root (v1.6 §4). Three renames, so the content itself is never rewritten
 * — but they are gated and reversible all the same:
 *
 * - **Snapshot-gated.** Every legacy board is snapshotted first, through the same
 *   `createSnapshot` the v1.5 node-directory migration uses. The snapshots land
 *   in the legacy `snapshots/` tree and ride along with the move, so each board
 *   arrives under the admin with a fresh restore point.
 * - **Idempotent.** Nothing at the old paths means nothing to do; `initDataDir`
 *   no longer recreates them, so a migrated volume stays quiet on every boot.
 * - **All-or-nothing.** A rename that fails part-way rewinds the ones already
 *   made, leaving a working pre-migration volume rather than half of each layout.
 *
 * A source *and* its destination both existing is not something to resolve by
 * guessing — it means an interrupted run, and it stops the boot.
 */
export async function runTenancyMigration({
  adminUserId,
  snapshot,
  log,
  debug,
}: TenancyDeps): Promise<void> {
  const legacy = legacyWorkspace();
  const legacyDirs = () => [
    { label: 'boards', from: legacy.boardsDir() },
    { label: 'archive', from: legacy.archiveRoot() },
    { label: 'snapshots', from: legacy.snapshotsRoot() },
  ];

  const present = async () => {
    const found: { label: string; from: string }[] = [];
    for (const dir of legacyDirs()) if (await exists(dir.from)) found.push(dir);
    return found;
  };

  const found = await present();
  if (!adminUserId) {
    // A fresh install has neither; anything else is a volume nobody can own yet.
    if (found.length > 0) {
      log('Legacy top-level data found but no user exists to own it — left untouched.');
    } else {
      debug('No users yet — nothing to move under a user root.');
    }
    return;
  }
  if (found.length === 0) {
    debug('Volume is already multi-tenant — nothing to migrate.');
    return;
  }

  const admin = workspaceFor(adminUserId);
  const target = (label: string) =>
    label === 'boards' ? admin.boardsDir() : label === 'archive' ? admin.archiveRoot() : admin.snapshotsRoot();

  for (const dir of found) {
    if (await exists(target(dir.label))) {
      throw new Error(
        `Multi-tenant migration stopped: both ${dir.from} and ${target(dir.label)} exist. ` +
          'A previous run was interrupted — reconcile the two by hand before starting again.',
      );
    }
  }

  // Gate first, on the boards where they still live.
  const boardIds = await listDirs(legacy.boardsDir());
  for (const boardId of boardIds) await snapshot(legacy, boardId);

  // Re-read: snapshotting may have just created the legacy snapshots directory.
  const moves: DirMove[] = (await present()).map((dir) => ({ ...dir, to: target(dir.label) }));

  const done: DirMove[] = [];
  try {
    for (const move of moves) {
      await movePath(move.from, move.to);
      done.push(move);
    }
  } catch (err) {
    for (const move of done.reverse()) {
      await movePath(move.to, move.from).catch(() => undefined);
    }
    throw new Error(
      `Multi-tenant migration failed and was rolled back (volume left as found): ${(err as Error).message}`,
    );
  }

  log(
    `Moved ${moves.map((m) => m.label).join(', ')} under users/${adminUserId} ` +
      `(${boardIds.length} board(s) snapshotted first).`,
  );
}
