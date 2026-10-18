/**
 * ALL filesystem access lives here (architecture principle 1 & 2).
 * Nothing outside this module may import `node:fs`.
 */
// First import in the process: `DATA_DIR` below is read at import time (§ env.ts).
import './env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { badRequest } from './errors.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));

/** A node is a directory holding these two files (v1.5 §2.1). */
export const NODE_FILE = 'node.md';
export const NODE_DATA_FILE = 'data.json';

/**
 * Instance-wide files: facts about the system and the operator's configuration,
 * owned by nobody. These are the only paths that are not user-scoped, which is
 * why they sit apart from `Workspace` rather than on it.
 *
 * `config.json` stays global on purpose: it is the deployment's vocabulary —
 * which statuses, shapes and colours exist — not anybody's content. A board
 * carries status *ids*, so a per-user config would make the same board render
 * differently (or not at all) once it is shared or browsed by an admin, and it
 * is the operator who edits the file on the volume, not a user through the app.
 */
export const systemPaths = {
  data: () => DATA_DIR,
  usersDir: () => path.join(DATA_DIR, 'users'),
  configFile: () => path.join(DATA_DIR, 'config.json'),
  /** System facts, not content (v1.6 §1) — see core/db.ts. */
  dbFile: () => path.join(DATA_DIR, 'app.db'),
};

/**
 * One user's slice of the volume (v1.6 §4): `boards/ archive/ snapshots/`,
 * exactly today's layout, under `users/{user-id}/`.
 *
 * Escaping a root is structurally impossible rather than checked: the root is
 * fixed when the object is built, every segment appended to it goes through
 * `safeId`/`safeTimestamp`, and no builder here accepts a caller-supplied path.
 * The flat `paths` object this replaced is gone, so there is no unscoped builder
 * left to reach for — a service function that wants a file must be handed a
 * workspace, which makes "forgot to scope it" unwritable rather than merely
 * forbidden.
 */
export interface Workspace {
  readonly userId: string;
  readonly root: string;
  /**
   * False when this workspace belongs to someone else and we are only looking.
   *
   * Route handlers are guarded by `writableWorkspaceOf`, but two *read* paths
   * write opportunistically — `getBoard` reconciles its cache against the node
   * files, and `readNodeData` migrates a v1 sidecar or deletes an empty one.
   * Those run below the handler, so the guard never sees them, and browsing
   * someone's board would edit their files. This flag is how a read says no.
   */
  readonly canWrite: boolean;
  boardsDir(): string;
  boardDir(boardId: string): string;
  boardFile(boardId: string): string;
  nodesDir(boardId: string): string;
  nodeDir(boardId: string, nodeId: string): string;
  nodeFile(boardId: string, nodeId: string): string;
  nodeDataFile(boardId: string, nodeId: string): string;
  archiveRoot(): string;
  archiveBoardsDir(): string;
  /**
   * Where a board goes when its owner deletes it from the Archive.
   *
   * A third resting place, not a second archive. `archive/` is the owner's own
   * undo — they can see it and put it back. `deleted/` is out of their world
   * entirely: nothing in their API surface reads it. The files stay because a
   * deletion a person makes in a moment of tidying is the one they most often
   * regret, and because a Super Admin has to be able to answer "where did that
   * board go" months later. Only an admin sees in here, and only an admin can
   * empty it.
   */
  deletedRoot(): string;
  deletedBoardsDir(): string;
  archiveNodesRoot(): string;
  archiveNodesDir(boardId: string): string;
  /** An archived node keeps its directory, suffixed with a timestamp on collision. */
  archivedNodeDir(boardId: string, name: string): string;
  snapshotsRoot(): string;
  snapshotsDir(boardId: string): string;
  snapshotDir(boardId: string, ts: string): string;
  /**
   * Folders, assignments and favourites (v1.8 §1). A file beside `boards/`,
   * `archive/` and `snapshots/` rather than a table, because it is content
   * organisation: it belongs to the user's slice of the volume, so a backup or
   * export of that volume carries it, and `app.db` keeps holding only facts
   * about the system (principle 5).
   */
  foldersFile(): string;
}

function workspaceAt(userId: string, root: string, canWrite = true): Workspace {
  const boardsDir = () => path.join(root, 'boards');
  const boardDir = (boardId: string) => path.join(boardsDir(), safeId(boardId));
  const nodesDir = (boardId: string) => path.join(boardDir(boardId), 'nodes');
  const nodeDir = (boardId: string, nodeId: string) =>
    path.join(nodesDir(boardId), safeId(nodeId));
  const archiveRoot = () => path.join(root, 'archive');
  const deletedRoot = () => path.join(root, 'deleted');
  const archiveNodesRoot = () => path.join(archiveRoot(), 'nodes');
  const archiveNodesDir = (boardId: string) => path.join(archiveNodesRoot(), safeId(boardId));
  const snapshotsRoot = () => path.join(root, 'snapshots');
  const snapshotsDir = (boardId: string) => path.join(snapshotsRoot(), safeId(boardId));

  return {
    userId,
    root,
    canWrite,
    boardsDir,
    boardDir,
    boardFile: (boardId) => path.join(boardDir(boardId), 'board.json'),
    nodesDir,
    nodeDir,
    nodeFile: (boardId, nodeId) => path.join(nodeDir(boardId, nodeId), NODE_FILE),
    nodeDataFile: (boardId, nodeId) => path.join(nodeDir(boardId, nodeId), NODE_DATA_FILE),
    archiveRoot,
    deletedRoot,
    deletedBoardsDir: () => path.join(deletedRoot(), 'boards'),
    archiveBoardsDir: () => path.join(archiveRoot(), 'boards'),
    archiveNodesRoot,
    archiveNodesDir,
    archivedNodeDir: (boardId, name) =>
      path.join(archiveNodesDir(boardId), safeArchiveName(name)),
    snapshotsRoot,
    snapshotsDir,
    snapshotDir: (boardId, ts) => path.join(snapshotsDir(boardId), safeTimestamp(ts)),
    foldersFile: () => path.join(root, 'folders.json'),
  };
}

const workspaces = new Map<string, Workspace>();
const readOnlyWorkspaces = new Map<string, Workspace>();

/** The workspace for a user id — one object per user per process. */
export function workspaceFor(userId: string): Workspace {
  const cached = workspaces.get(userId);
  if (cached) return cached;
  const ws = workspaceAt(userId, path.join(systemPaths.usersDir(), safeId(userId)));
  workspaces.set(userId, ws);
  return ws;
}

/**
 * The same paths, marked not-ours. Handed to anyone browsing another person's
 * workspace — a share recipient or an admin — so the opportunistic writes on
 * the read path can tell whose files they are about to touch.
 */
export function readOnlyWorkspaceFor(userId: string): Workspace {
  const cached = readOnlyWorkspaces.get(userId);
  if (cached) return cached;
  const ws = workspaceAt(userId, path.join(systemPaths.usersDir(), safeId(userId)), false);
  readOnlyWorkspaces.set(userId, ws);
  return ws;
}

/**
 * The pre-v1.6 volume seen as a workspace rooted at `/data` itself. It exists so
 * the one-shot tenancy migration (§8.1) can snapshot and move boards that do not
 * live under a user yet; nothing else may use it.
 */
export function legacyWorkspace(): Workspace {
  return workspaceAt('(legacy)', DATA_DIR);
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
/*
 * Anchored on a digit, which every timestamp starts with. The unanchored form
 * this replaced also matched `..` — dots and dashes were all it asked for — so
 * `snapshots/{board}/..` was a buildable path, and a crafted restore could point
 * at the snapshots root instead of one snapshot.
 */
const TS_RE = /^[0-9][0-9TZ:.-]*$/;

export function isSafeId(id: string): boolean {
  return typeof id === 'string' && ID_RE.test(id) && id.length <= 120;
}

/** Guards every path segment that comes from a request. */
export function safeId(id: string): string {
  if (!isSafeId(id)) throw badRequest(`Invalid id: ${JSON.stringify(id)}`);
  return id;
}

export function safeTimestamp(ts: string): string {
  if (typeof ts !== 'string' || !TS_RE.test(ts) || ts.length > 40) {
    throw badRequest(`Invalid snapshot timestamp: ${JSON.stringify(ts)}`);
  }
  return ts;
}

/** Archive entries are `{id}` or, after a collision, `{id}--{timestamp}`. */
export function safeArchiveName(name: string): string {
  const at = typeof name === 'string' ? name.lastIndexOf('--') : -1;
  if (at < 0) return safeId(name);
  safeId(name.slice(0, at));
  safeTimestamp(name.slice(at + 2));
  return name;
}

/**
 * Joins a directory entry name onto a directory this module produced. Archive
 * lookups and the node-directory migration work from `listFiles`/`listDirs`
 * results, which are names rather than paths — this keeps that last join here,
 * where every other path is built.
 */
export function entryPath(dir: string, name: string): string {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/]/.test(name)) {
    throw badRequest(`Invalid directory entry: ${JSON.stringify(name)}`);
  }
  return path.join(dir, name);
}

export function slugify(input: string): string {
  const slug = (input ?? '')
    .toString()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'untitled';
}

/** Appends -2, -3 … until `taken` says the slug is free. */
export async function uniqueSlug(base: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  while (await taken(candidate)) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}

export function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---- primitives ----

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Write via temp file + rename so a crash can never leave a half-written file. */
export async function writeText(file: string, content: string): Promise<void> {
  await ensureDir(path.dirname(file));
  // Unique per call, not per millisecond: two writes to the same file in the
  // same tick previously produced the same temp path, interleaved their bytes
  // and renamed the result over the original. This is the primitive the whole
  // "files are the database" design rests on.
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

export async function readJson<T>(file: string): Promise<T | null> {
  const text = await readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`Malformed JSON in ${file}: ${(err as Error).message}`);
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * When this path last changed *identity* — created, renamed, moved.
 *
 * `ctime`, not `mtime`: a rename does not touch mtime, so an archived board's
 * mtime is still the moment its last node file was written. Measured on the
 * real volume, mtime and the board's own `updatedAt` were identical to the
 * second, which is exactly the thing we are trying not to sort by.
 *
 * Only a fallback. It is reset by any copy that does not preserve metadata —
 * `cp -R` included — so anything shelved from now on carries its own stamp and
 * this answers only for what was already there.
 */
export async function changedAt(target: string): Promise<string | null> {
  try {
    const stat = await fs.stat(target);
    return new Date(stat.ctimeMs).toISOString();
  } catch {
    return null;
  }
}

export async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function copyDir(from: string, to: string): Promise<void> {
  await ensureDir(path.dirname(to));
  await fs.cp(from, to, { recursive: true });
}

export async function movePath(from: string, to: string): Promise<void> {
  await ensureDir(path.dirname(to));
  await fs.rename(from, to);
}

export async function removePath(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}


/**
 * Archive, never delete (architecture principle 6).
 * Moves `from` under the archive directory, suffixing with a timestamp on collision.
 */
export async function archivePath(from: string, archiveDir: string, name: string): Promise<string> {
  await ensureDir(archiveDir);
  let target = path.join(archiveDir, name);
  if (await exists(target)) {
    target = path.join(archiveDir, `${name}--${timestampSlug()}`);
  }
  await movePath(from, target);
  return target;
}

/**
 * Called once at boot. It deliberately creates no `boards/` at the top level any
 * more: an empty legacy directory recreated on every boot would look like data
 * still waiting to be migrated (§8.1).
 */
export async function initDataDir(): Promise<void> {
  await ensureDir(systemPaths.usersDir());
}

const ensured = new Set<string>();

/** Shapes one user's root. Called from the request guard; a no-op after the first hit. */
export async function ensureWorkspace(ws: Workspace): Promise<void> {
  if (ensured.has(ws.root)) return;
  await ensureDir(ws.boardsDir());
  await ensureDir(ws.archiveBoardsDir());
  await ensureDir(ws.archiveNodesRoot());
  await ensureDir(ws.snapshotsRoot());
  ensured.add(ws.root);
}

/** Every workspace on the volume — what the boot-time migrations iterate over. */
export async function listWorkspaces(): Promise<Workspace[]> {
  const ids = await listDirs(systemPaths.usersDir());
  return ids.filter(isSafeId).map(workspaceFor);
}
