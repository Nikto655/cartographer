/**
 * Content search across one workspace (v1.7 §3, `search_nodes`).
 *
 * **No index.** Files are the database, and an index would be a second copy of
 * the truth that goes stale the moment somebody edits a `node.md` in their
 * editor — which is a supported thing to do here. So this walks the boards and
 * reads the files, every time. On a personal instance that is milliseconds; the
 * caps below are what keeps it that way when it isn't.
 *
 * Everything it can reach is scoped by the `Workspace` it is handed, exactly
 * like every other read. There is no cross-workspace search and no way to ask
 * for one.
 */
import type { Board } from '@cartograph/shared';
import { parseNodeFile } from '../../core/markdown.js';
import { badRequest } from '../../core/errors.js';
import { type Workspace, listDirs, readJson, readText } from '../../core/storage.js';

export interface SearchHit {
  boardId: string;
  boardName: string;
  nodeId: string;
  title: string;
  /** The match with enough either side to recognise it, on one line. */
  snippet: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** True when a cap stopped the walk — there may be more than this. */
  truncated: boolean;
}

export const MAX_RESULTS = 50;
/**
 * A ceiling on files opened per search, not on matches. Without it a workspace
 * of a few thousand nodes turns one impatient agent's retry loop into a disk
 * scan per attempt.
 */
const MAX_FILES_SCANNED = 4_000;

/** Enough context to tell a real match from a substring of another word. */
const CONTEXT = 70;

function snippetAround(haystack: string, at: number, length: number): string {
  const from = Math.max(0, at - CONTEXT);
  const to = Math.min(haystack.length, at + length + CONTEXT);
  // Collapsed to one line: a note's line breaks are its own, and a hit rendered
  // across six of them stops being scannable.
  const text = haystack.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${text}${to < haystack.length ? '…' : ''}`;
}

/**
 * Titles, descriptions and note bodies, case-insensitively. `boardId` narrows it
 * to one board; absent means the whole workspace.
 */
export async function searchNodes(
  ws: Workspace,
  query: string,
  options: { boardId?: string; limit?: number } = {},
): Promise<SearchResult> {
  const needle = (query ?? '').trim().toLowerCase();
  if (!needle) throw badRequest('Give me something to search for.');

  const limit = Math.min(Math.max(options.limit ?? MAX_RESULTS, 1), MAX_RESULTS);
  const boardIds = options.boardId ? [options.boardId] : await listDirs(ws.boardsDir());

  const hits: SearchHit[] = [];
  let scanned = 0;

  for (const boardId of boardIds) {
    const board = await readJson<Board>(ws.boardFile(boardId));
    if (!board) continue;

    for (const node of board.nodes ?? []) {
      if (hits.length >= limit || scanned >= MAX_FILES_SCANNED) {
        return { hits, truncated: true };
      }
      scanned += 1;

      const raw = await readText(ws.nodeFile(boardId, node.id));
      if (raw === null) continue;
      const { frontmatter, body } = parseNodeFile(raw, node.id);

      // One haystack rather than three passes: a hit is a hit, and the caller
      // wants to see it in context regardless of which field it landed in.
      const haystack = [frontmatter.title, frontmatter.description ?? '', body].join('\n');
      const at = haystack.toLowerCase().indexOf(needle);
      if (at < 0) continue;

      hits.push({
        boardId: board.id ?? boardId,
        boardName: board.name ?? boardId,
        nodeId: node.id,
        title: frontmatter.title,
        snippet: snippetAround(haystack, at, needle.length),
      });
    }
  }

  return { hits, truncated: false };
}
