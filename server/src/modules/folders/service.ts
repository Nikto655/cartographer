/**
 * `folders.json` — one user's organisation metadata (v1.8 §1): the folders they
 * made, which board sits in which, and which boards are starred. Read and
 * written whole; there is no per-folder CRUD (§7), because the whole file is
 * smaller than the ceremony would be.
 *
 * **This module must not import `boards`.** `boards.listBoards` merges folder
 * membership into every summary, so the dependency runs boards → folders and
 * only that way. That is also why pruning here takes no board list: this code
 * cannot know which boards exist, and deliberately does not need to.
 */
import type { Folder, FoldersFile } from '@cartograph/shared';
import type { BoardIdentityChange } from '../../core/boardEvents.js';
import { resolveColor } from '../../core/config.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { mintId } from '../../core/ids.js';
import { withLock } from '../../core/locks.js';
import { readJson, type Workspace, workspaceFor, writeJson } from '../../core/storage.js';

const MAX_NAME_LENGTH = 60;

/**
 * A ceiling, not a quota. Folders are a flat shelf you scan by eye; past a few
 * dozen the grid stops being an aid and starts being a second search problem.
 */
const MAX_FOLDERS = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const emptyFile = (): FoldersFile => ({ folders: [], assignments: {}, favorites: [] });

/**
 * What survives a read, and why the two halves differ:
 *
 * - An assignment whose **folder** is gone is dropped. The folder was deleted;
 *   the mapping points at nothing and never will again.
 * - An assignment whose **board** is not on the shelf is **kept**. §5 is
 *   explicit: an archived board's assignment stays dormant so a restore lands
 *   it back where it lived. §1's looser "missing boards/folders are pruned"
 *   reads like it says otherwise — the specific rule wins. Pruning by absence
 *   would quietly discard exactly the case §5 asks us to preserve, and the loss
 *   is invisible until somebody restores a board a month later and finds it
 *   unfiled. Favourites are kept for absent boards for the same reason.
 */
function normalizeAssignments(raw: unknown, folderIds: Set<string>): Record<string, string> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [boardId, folderId] of Object.entries(raw)) {
    if (typeof folderId !== 'string' || !folderIds.has(folderId)) continue;
    out[boardId] = folderId;
  }
  return out;
}

function normalizeFavorites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const boardId of raw) {
    if (typeof boardId === 'string' && boardId) seen.add(boardId);
  }
  return [...seen];
}

/**
 * Order is renumbered 0..n-1 on both read and write, so the file can never
 * develop gaps, ties or negatives that the grid would have to reason about. A
 * hand-edited file with `order: 5, 5, 1` still renders in a defined sequence.
 */
function normalizeFolders(raw: unknown): Folder[] {
  if (!Array.isArray(raw)) return [];
  const kept: Folder[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === 'string' ? entry.id : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const color = typeof entry.color === 'string' && entry.color ? entry.color : undefined;
    kept.push({
      id,
      name,
      ...(color ? { color } : {}),
      order: typeof entry.order === 'number' && Number.isFinite(entry.order) ? entry.order : kept.length,
    });
  }
  kept.sort((a, b) => a.order - b.order);
  return kept.map((folder, index) => ({ ...folder, order: index }));
}

/**
 * Hydrates to empty when the file is absent — most users will never have one —
 * and drops anything whose shape it cannot use rather than refusing the whole
 * dashboard over one bad entry. Unparseable JSON still throws, as it does for
 * `board.json`: that is corruption to be looked at, not a shape to be tidied.
 */
export async function readFolders(ws: Workspace): Promise<FoldersFile> {
  const raw = await readJson<unknown>(ws.foldersFile());
  if (!isRecord(raw)) return emptyFile();
  const folders = normalizeFolders(raw.folders);
  return {
    folders,
    assignments: normalizeAssignments(raw.assignments, new Set(folders.map((f) => f.id))),
    favorites: normalizeFavorites(raw.favorites),
  };
}

/**
 * The whole file, validated and written (§7). Names and colours are refused
 * when they are wrong — a person typed them and can fix them — while an
 * assignment to a folder that is not in this payload is merely dropped: the
 * client may be sending a delete and a stale mapping in the same breath, and
 * failing that write would leave the folder undeletable.
 */
export async function writeFolders(ws: Workspace, input: unknown): Promise<FoldersFile> {
  // Locked like every other read-modify-write on the volume. The whole-file PUT
  // is one write and needs no lock of its own, but it now shares this file with
  // the per-folder operations below — and an agent filing a board while a
  // browser saves a reorder is a real pair, not a theoretical one.
  return withLock(ws.foldersFile(), () => writeFoldersUnlocked(ws, input));
}

async function writeFoldersUnlocked(ws: Workspace, input: unknown): Promise<FoldersFile> {
  if (!isRecord(input)) throw badRequest('Expected an object with `folders`, `assignments` and `favorites`.');
  if (input.folders !== undefined && !Array.isArray(input.folders)) {
    throw badRequest('`folders` must be an array.');
  }
  const incoming = Array.isArray(input.folders) ? input.folders : [];
  if (incoming.length > MAX_FOLDERS) {
    throw conflict(`At most ${MAX_FOLDERS} folders — merge or delete one before adding another.`);
  }

  const folders: Folder[] = [];
  const ids = new Set<string>();
  for (const entry of incoming) {
    if (!isRecord(entry)) throw badRequest('Each folder must be an object.');

    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) throw badRequest('Give the folder a name — it is the only thing the card shows.');
    if (name.length > MAX_NAME_LENGTH) {
      throw badRequest(`A folder name is at most ${MAX_NAME_LENGTH} characters.`);
    }

    /*
     * Minted here when absent, so a new folder is never named by the client and
     * two clients creating one at once cannot collide. A folder id is never a
     * path segment and never becomes a slug — it only has to be unique inside
     * this file — which is why it does not go through `safeId`.
     */
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : mintId('folder');
    if (id.length > 120) throw badRequest('That folder id is not one we minted.');
    if (ids.has(id)) throw badRequest(`Two folders share the id “${id}”.`);
    ids.add(id);

    // One colour validator for the whole system: takes "sky" or "--node-sky",
    // returns the token, refuses anything this deployment does not define.
    const color = await resolveColor(typeof entry.color === 'string' && entry.color ? entry.color : null);

    // Renumbered from the array order the client sent, so reordering is a drag
    // and a PUT rather than arithmetic on the client.
    folders.push({ id, name, ...(color ? { color } : {}), order: folders.length });
  }

  const file: FoldersFile = {
    folders,
    assignments: normalizeAssignments(input.assignments, ids),
    favorites: normalizeFavorites(input.favorites),
  };
  await writeJson(ws.foldersFile(), file);
  return file;
}

/*
 * ---- per-folder operations (v1.9) ----
 *
 * The whole-file PUT above is the browser's shape: it holds the entire
 * arrangement on screen and sends it back. An agent holds none of that, and
 * making it read, merge and rewrite the file to file one board is exactly how a
 * partial payload ends up erasing somebody's shelf — the same reasoning that
 * gave `addEdges` and `moveNodes` their own service functions rather than
 * pushing every caller through `saveGraph`.
 *
 * Each runs inside `withLock(ws.foldersFile())`, so a person dragging a board in
 * the browser and an agent filing one over MCP cannot lose each other's work.
 * The lock is the *only* thing making that true: both paths write the file
 * whole, so without it the later write wins outright.
 */

/** Case-insensitive, because an agent works from names a person typed. */
function findByName(folders: readonly Folder[], name: string): Folder | undefined {
  const key = name.trim().toLowerCase();
  return folders.find((folder) => folder.name.toLowerCase() === key);
}

/**
 * A folder id or a folder name, resolved to an id. Agents are given names
 * everywhere else (`list_boards` reports the folder's *name*), so accepting one
 * here is what makes the pair usable without an id-tracking step.
 */
export function resolveFolderRef(file: FoldersFile, ref: string): Folder {
  const trimmed = ref.trim();
  const found = file.folders.find((folder) => folder.id === trimmed) ?? findByName(file.folders, trimmed);
  if (!found) {
    const known = file.folders.map((folder) => `“${folder.name}”`).join(', ') || 'none yet';
    throw notFound(`No folder called “${trimmed}”. This workspace has: ${known}.`);
  }
  return found;
}

export interface NewFolderInput {
  name: string;
  /** A palette id ("sky") or token ("--node-sky"); absent leaves it neutral. */
  color?: string | null;
}

/**
 * Adds one folder, leaving every existing folder, assignment and star alone.
 *
 * A repeated name is refused rather than merged: two folders called "Clients"
 * are indistinguishable on the shelf, and an agent that creates one twice by
 * re-running a step should be told so, not quietly given a second.
 */
export async function createFolder(ws: Workspace, input: NewFolderInput): Promise<Folder> {
  const name = (input.name ?? '').trim();
  if (!name) throw badRequest('Give the folder a name — it is the only thing the card shows.');
  if (name.length > MAX_NAME_LENGTH) {
    throw badRequest(`A folder name is at most ${MAX_NAME_LENGTH} characters.`);
  }
  const color = await resolveColor(input.color ?? null);

  return withLock(ws.foldersFile(), async () => {
    const file = await readFolders(ws);
    if (findByName(file.folders, name)) {
      throw conflict(`A folder called “${name}” already exists.`);
    }
    if (file.folders.length >= MAX_FOLDERS) {
      throw conflict(`At most ${MAX_FOLDERS} folders — merge or delete one before adding another.`);
    }
    const folder: Folder = {
      id: mintId('folder'),
      name,
      ...(color ? { color } : {}),
      order: file.folders.length,
    };
    await writeJson(ws.foldersFile(), { ...file, folders: [...file.folders, folder] });
    return folder;
  });
}

export interface FolderPatch {
  name?: string;
  color?: string | null;
}

/** Rename or recolour one folder. Absent fields are left as they are. */
export async function updateFolder(ws: Workspace, ref: string, patch: FolderPatch): Promise<Folder> {
  const name = patch.name === undefined ? undefined : patch.name.trim();
  if (name !== undefined) {
    if (!name) throw badRequest('Give the folder a name — it is the only thing the card shows.');
    if (name.length > MAX_NAME_LENGTH) {
      throw badRequest(`A folder name is at most ${MAX_NAME_LENGTH} characters.`);
    }
  }
  // Outside the lock: resolving a colour reads the deployment config, and
  // holding the file's lock across that is longer than it needs to be.
  const color = patch.color === undefined ? undefined : await resolveColor(patch.color);

  return withLock(ws.foldersFile(), async () => {
    const file = await readFolders(ws);
    const target = resolveFolderRef(file, ref);
    if (name && name.toLowerCase() !== target.name.toLowerCase() && findByName(file.folders, name)) {
      throw conflict(`A folder called “${name}” already exists.`);
    }
    const updated: Folder = {
      ...target,
      ...(name ? { name } : {}),
      ...(patch.color === undefined ? {} : color ? { color } : { color: undefined }),
    };
    if (!updated.color) delete updated.color;
    const folders = file.folders.map((folder) => (folder.id === target.id ? updated : folder));
    await writeJson(ws.foldersFile(), { ...file, folders });
    return updated;
  });
}

export interface FiledBoards {
  folder: string | null;
  filed: string[];
}

/**
 * Files boards into a folder, or unfiles them when `ref` is null.
 *
 * Takes no board list and checks no board exists — deliberately, and for the
 * same reason the pruning rule does: this module cannot import `boards`, so an
 * assignment for a board that is not on the shelf is a thing it is unable to
 * distinguish from one that is merely archived. Filing an id that names nothing
 * therefore writes a dormant line rather than failing, exactly as a restore
 * expects (§5).
 */
export async function fileBoards(
  ws: Workspace,
  boardIds: readonly string[],
  ref: string | null,
): Promise<FiledBoards> {
  const ids = [...new Set(boardIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) throw badRequest('Name at least one board to file.');

  return withLock(ws.foldersFile(), async () => {
    const file = await readFolders(ws);
    const folder = ref === null ? null : resolveFolderRef(file, ref);
    const assignments = { ...file.assignments };
    for (const id of ids) {
      if (folder) assignments[id] = folder.id;
      else delete assignments[id];
    }
    await writeJson(ws.foldersFile(), { ...file, assignments });
    return { folder: folder?.name ?? null, filed: ids };
  });
}

/**
 * Follow a board that changed its id (v1.9 fix).
 *
 * Assignments and favourites key on the board id, and a board id is a slug that
 * *renaming re-slugs*. Nothing told this module, so renaming a filed board left
 * its assignment stranded on the old slug and the board came back unfiled — and
 * its star with it. Reproduced before the fix: `rename-probe` filed and starred,
 * renamed to `rename-probe-renamed`, and the file still said `rename-probe`.
 *
 * This is exactly what `core/boardEvents` exists for. `shares` has followed
 * identity since v1.6 for the same reason; folders simply never subscribed.
 *
 * **An archive is not a rename.** `newId === null` means the board went to
 * `archive/`, and the entry deliberately stays put so a restore lands it back
 * where it lived (§5). That asymmetry is the whole reason this cannot just be
 * "delete the old key".
 *
 * Fire-and-forget: the emitter is synchronous and its listeners must not throw,
 * and a rename that has already moved directories on disk must not be unwound
 * because a folder file would not write.
 */
export function followBoardRename(change: BoardIdentityChange): void {
  const { userId, oldId, newId } = change;
  if (newId === null || newId === oldId) return;

  void withLock(foldersFileFor(userId), async () => {
    const ws = workspaceFor(userId);
    const file = await readFolders(ws);
    const assigned = file.assignments[oldId];
    const starred = file.favorites.includes(oldId);
    if (!assigned && !starred) return;

    const assignments = { ...file.assignments };
    if (assigned) {
      delete assignments[oldId];
      assignments[newId] = assigned;
    }
    const favorites = starred
      ? [...file.favorites.filter((id) => id !== oldId && id !== newId), newId]
      : file.favorites;

    await writeJson(ws.foldersFile(), { ...file, assignments, favorites });
  }).catch(() => {
    /* see above — a rename must not fail because of this */
  });
}

/**
 * The lock key, derived without a workspace so the listener can take it before
 * building one. Same string `withLock(ws.foldersFile())` uses everywhere else —
 * it has to be, or this would run alongside a write rather than after it.
 */
function foldersFileFor(userId: string): string {
  return workspaceFor(userId).foldersFile();
}
