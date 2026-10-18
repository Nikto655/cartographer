/**
 * The link layer's server half (v1.5 §4.1). There is no stored index: note files
 * are truth, so links are recomputed from their bodies on every board read, and
 * rewritten in place when a node's title changes.
 *
 * The grammar itself lives in @cartograph/shared so the client resolves links the
 * same way this does.
 */
import type { BoardLink, BoardWarning } from '@cartograph/shared';
import {
  indexTitles,
  isAmbiguousTitle,
  parseWikiLinks,
  resolveWikiLink,
  rewriteWikiLinks,
} from '@cartograph/shared';
import { parseNodeFile, serializeNodeFile } from './markdown.js';
import { type Workspace, readText, writeText } from './storage.js';

/** A node as the link layer sees it: an id, a title to match, a body to scan. */
export interface LinkSource {
  id: string;
  title: string;
  body: string;
}

export interface BoardLinks {
  links: BoardLink[];
  warnings: BoardWarning[];
}

export function computeLinks(sources: readonly LinkSource[]): BoardLinks {
  const index = indexTitles(sources);
  const links: BoardLink[] = [];
  // One warning per ambiguous title, not per occurrence — a board says a thing once.
  const ambiguous = new Map<string, string>();

  for (const source of sources) {
    for (const { title } of parseWikiLinks(source.body)) {
      links.push({
        sourceId: source.id,
        targetTitle: title,
        targetId: resolveWikiLink(index, title),
      });
      if (isAmbiguousTitle(index, title) && !ambiguous.has(title.toLowerCase())) {
        ambiguous.set(
          title.toLowerCase(),
          `More than one node is called “${title}” — links to it resolve to nothing until one is renamed.`,
        );
      }
    }
  }

  return {
    links,
    warnings: [...ambiguous.values()].map((message) => ({ code: 'ambiguous-link', message })),
  };
}

/**
 * Rewrites `[[Old]]` → `[[New]]` across every note on the board. Called from
 * inside the rename operation, after the node directory has moved, so the ids it
 * is handed are the current ones. Returns how many files changed.
 */
export async function rewriteLinkTitles(
  ws: Workspace,
  boardId: string,
  nodeIds: readonly string[],
  oldTitle: string,
  newTitle: string,
): Promise<number> {
  if (oldTitle === newTitle) return 0;
  let changed = 0;

  for (const nodeId of nodeIds) {
    const file = ws.nodeFile(boardId, nodeId);
    const raw = await readText(file);
    if (raw === null) continue;
    const { frontmatter, body } = parseNodeFile(raw, nodeId);
    const next = rewriteWikiLinks(body, oldTitle, newTitle);
    if (next === body) continue; // untouched files stay byte-identical
    await writeText(file, serializeNodeFile(frontmatter, next));
    changed += 1;
  }

  return changed;
}
