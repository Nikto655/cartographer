/**
 * Frontmatter parse/serialize. Unknown keys are preserved on write (forward compatibility, §3.1).
 */
import matter from 'gray-matter';
import type { NodeFrontmatter, NodeStatus } from '@cartograph/shared';
import { DEFAULT_STATUS } from '@cartograph/shared';
import { badRequest } from './errors.js';
import { today } from './storage.js';

export interface ParsedNodeFile {
  frontmatter: NodeFrontmatter;
  body: string;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

/**
 * Parses a node file. `fallbackId` is used when frontmatter is missing an id
 * (hand-written files should still open rather than error).
 */
export function parseNodeFile(raw: string, fallbackId: string): ParsedNodeFile {
  const parsed = matter(raw);
  const fm = { ...(parsed.data as Record<string, unknown>) };

  const created = fm.created;
  const frontmatter: NodeFrontmatter = {
    ...fm,
    id: typeof fm.id === 'string' && fm.id ? fm.id : fallbackId,
    title: typeof fm.title === 'string' && fm.title ? fm.title : fallbackId,
    created:
      created instanceof Date
        ? created.toISOString().slice(0, 10)
        : typeof created === 'string' && created
          ? created
          : today(),
    status: typeof fm.status === 'string' && fm.status ? (fm.status as NodeStatus) : DEFAULT_STATUS,
    tags: asStringArray(fm.tags),
    // Written only once set, so untouched v1.1 files stay byte-identical.
    ...(typeof fm.description === 'string' && fm.description.trim()
      ? { description: fm.description }
      : {}),
    // Same rule for the node type: absent means the board world's default (§2.2).
    ...(typeof fm.type === 'string' && fm.type.trim() ? { type: fm.type.trim() } : {}),
  };

  return { frontmatter, body: parsed.content.replace(/^\n+/, '') };
}

export function serializeNodeFile(frontmatter: NodeFrontmatter, body: string): string {
  // Keep the required keys in a stable, readable order; unknown keys follow.
  const { id, title, created, status, tags, description, type, ...rest } = frontmatter;
  const ordered: Record<string, unknown> = { id, title, created, status, tags };
  if (typeof description === 'string' && description.trim()) ordered.description = description;
  if (typeof type === 'string' && type.trim()) ordered.type = type;
  Object.assign(ordered, rest);
  const content = body.startsWith('\n') ? body : `\n${body}`;
  return matter.stringify(content, ordered);
}

export function newNodeFile(id: string, title: string, status: NodeStatus = DEFAULT_STATUS): string {
  return serializeNodeFile({ id, title, created: today(), status, tags: [] }, '\n');
}

/** Raw-mode writes go through here so a bad edit can never corrupt a board. */
export function validateRawNodeFile(raw: string, expectedId: string): ParsedNodeFile {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    throw badRequest(`Invalid frontmatter: ${(err as Error).message}`);
  }
  const data = parsed.data as Record<string, unknown>;
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    throw badRequest('Frontmatter block is missing. The file must start with a --- delimited block.');
  }
  if (typeof data.title !== 'string' || !data.title.trim()) {
    throw badRequest('Frontmatter must include a non-empty `title`.');
  }
  if (typeof data.status !== 'string' || !data.status.trim()) {
    throw badRequest('Frontmatter must include a `status`.');
  }
  if (data.id !== undefined && data.id !== expectedId) {
    throw badRequest(`Frontmatter \`id\` must stay ${expectedId} (it is the node's permanent history id).`);
  }
  return parseNodeFile(raw, expectedId);
}

/** Coverage rule (§7.4): body trimmed of whitespace non-empty → written. */
export function coverageOf(body: string): 'empty' | 'written' {
  return body.trim().length > 0 ? 'written' : 'empty';
}
