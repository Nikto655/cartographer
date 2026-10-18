/**
 * `[[Title]]` link grammar (v1.5 §4.1).
 *
 * Pure string work, and deliberately shared: the server resolves links when a
 * board is read, the client resolves them for autocomplete and rendering. If the
 * two ever disagreed about what a link is, a note would mean different things in
 * different places — so both read this file.
 */

/** A fresh regex per call: a shared `g` regex carries `lastIndex` between callers. */
export const wikiLinkPattern = (): RegExp => /\[\[([^[\]\n]+)\]\]/g;

/** The same grammar anchored at the start, for tokenizers that walk a string. */
export const wikiLinkStartPattern = (): RegExp => /^\[\[([^[\]\n]+)\]\]/;

export interface ParsedWikiLink {
  /** The text between the brackets, trimmed — what the writer meant to point at. */
  title: string;
  start: number;
  end: number;
}

/**
 * Blanks fenced blocks and code spans while keeping every offset, so a
 * `[[Title]]` written as an example is not a link. Rendered markdown reaches the
 * same conclusion by tokenizing — this is how the plain-string side agrees.
 */
function maskCode(body: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, ' ');
  return body.replace(/```[\s\S]*?```/g, blank).replace(/`[^`\n]*`/g, blank);
}

export function parseWikiLinks(body: string): ParsedWikiLink[] {
  const links: ParsedWikiLink[] = [];
  const pattern = wikiLinkPattern();
  const masked = maskCode(body);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) {
    const title = match[1].trim();
    if (title) links.push({ title, start: match.index, end: match.index + match[0].length });
  }
  return links;
}

/**
 * `[[board/node]]` is reserved for the someday global layer: parsed and preserved
 * byte-for-byte, never resolved, never rewritten (§4.1).
 */
export function isCrossBoardLink(title: string): boolean {
  return title.includes('/');
}

/** Titles match case-insensitively, so this is the key both sides index by. */
export function linkKey(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * Title → node id. Two nodes sharing a title make every link to it ambiguous, so
 * the key maps to `null` rather than picking a winner.
 */
export function indexTitles(nodes: readonly { id: string; title: string }[]): Map<string, string | null> {
  const index = new Map<string, string | null>();
  for (const node of nodes) {
    const key = linkKey(node.title);
    index.set(key, index.has(key) ? null : node.id);
  }
  return index;
}

export function resolveWikiLink(index: Map<string, string | null>, title: string): string | null {
  if (isCrossBoardLink(title)) return null;
  return index.get(linkKey(title)) ?? null;
}

/** True when the title exists on the board but more than once. */
export function isAmbiguousTitle(index: Map<string, string | null>, title: string): boolean {
  if (isCrossBoardLink(title)) return false;
  return index.get(linkKey(title)) === null;
}

/**
 * `[[Old]]` → `[[New]]`, case-insensitively, leaving cross-board syntax alone.
 * The rename operation's half of "links never break". Rewrites exactly what
 * `parseWikiLinks` calls a link, so code examples are left as written.
 */
export function rewriteWikiLinks(body: string, oldTitle: string, newTitle: string): string {
  const key = linkKey(oldTitle);
  let out = '';
  let cursor = 0;
  for (const link of parseWikiLinks(body)) {
    if (isCrossBoardLink(link.title) || linkKey(link.title) !== key) continue;
    out += body.slice(cursor, link.start) + `[[${newTitle}]]`;
    cursor = link.end;
  }
  return out + body.slice(cursor);
}
