/**
 * Data sidecars. Schema v2 is labeled snippets plus at most one marked output
 * (v1.3 §5). v1 files migrate lazily on first read and are written back once —
 * nothing is lost, and no migration script is needed.
 */
import type { DataSnippet, LegacyNodeData, NodeData } from '@cartograph/shared';
import { type Workspace, readJson, removePath, writeJson } from './storage.js';

type StoredData = (NodeData | LegacyNodeData) & Record<string, unknown>;

let seq = 0;
export function snippetId(): string {
  seq += 1;
  return `s${Date.now().toString(36)}${seq.toString(36)}`;
}

function cleanSnippet(input: Partial<DataSnippet>, index: number): DataSnippet {
  return {
    id: typeof input.id === 'string' && input.id ? input.id : snippetId(),
    label: (typeof input.label === 'string' && input.label.trim()) || `snippet ${index + 1}`,
    lang: (typeof input.lang === 'string' && input.lang.trim()) || 'txt',
    code: typeof input.code === 'string' ? input.code : '',
  };
}

/** v1 { out, in, snippets } → v2 { snippets, outSnippetId } (§7.1). */
export function migrate(legacy: LegacyNodeData): NodeData {
  const snippets: DataSnippet[] = [];
  let outSnippetId: string | undefined;

  if (legacy.out && Object.keys(legacy.out).length > 0) {
    const snippet = cleanSnippet(
      { label: 'output', lang: 'json', code: JSON.stringify(legacy.out, null, 2) },
      snippets.length,
    );
    snippets.push(snippet);
    outSnippetId = snippet.id;
  }

  if (legacy.in && Object.keys(legacy.in).length > 0) {
    // `in` is no longer stored, but the words someone wrote are not thrown away.
    snippets.push(
      cleanSnippet(
        {
          label: 'expected input (from v1)',
          lang: 'json',
          code: JSON.stringify(legacy.in, null, 2),
        },
        snippets.length,
      ),
    );
  }

  for (const snippet of legacy.snippets ?? []) {
    snippets.push(
      cleanSnippet(
        { label: snippet.title, lang: snippet.lang, code: snippet.code },
        snippets.length,
      ),
    );
  }

  return { version: 2, snippets, outSnippetId: outSnippetId ?? null };
}

export function normalize(input: unknown): NodeData {
  const stored = (input ?? {}) as StoredData;
  const data =
    (stored as NodeData).version === 2
      ? {
          version: 2 as const,
          snippets: ((stored as NodeData).snippets ?? []).map(cleanSnippet),
          outSnippetId: (stored as NodeData).outSnippetId ?? null,
        }
      : migrate(stored as LegacyNodeData);

  // An output marker pointing at a deleted snippet is no marker at all.
  if (data.outSnippetId && !data.snippets.some((s) => s.id === data.outSnippetId)) {
    data.outSnippetId = null;
  }
  return data;
}

export function isEmpty(data: NodeData | null): boolean {
  return !data || data.snippets.length === 0;
}

export function outputSnippet(data: NodeData | null): DataSnippet | null {
  if (!data?.outSnippetId) return null;
  return data.snippets.find((s) => s.id === data.outSnippetId) ?? null;
}

/**
 * Reads a sidecar, migrating v1 files in place. Returns null when there is no
 * sidecar or it holds nothing.
 */
export async function readNodeData(
  ws: Workspace,
  boardId: string,
  nodeId: string,
): Promise<NodeData | null> {
  const file = ws.nodeDataFile(boardId, nodeId);
  const raw = await readJson<StoredData>(file);
  if (!raw) return null;

  const wasV2 = (raw as NodeData).version === 2;
  const data = normalize(raw);

  // Tidying an empty sidecar and upgrading a v1 one are both writes, so they
  // wait until we are in a workspace we own. Browsing yields the same value
  // either way; it just leaves the other person's files alone.
  if (isEmpty(data)) {
    if (ws.canWrite) await removePath(file);
    return null;
  }
  if (!wasV2 && ws.canWrite) await writeJson(file, data); // migrate once, then never again
  return data;
}

export async function writeNodeData(
  ws: Workspace,
  boardId: string,
  nodeId: string,
  input: unknown,
): Promise<NodeData | null> {
  const file = ws.nodeDataFile(boardId, nodeId);
  const data = normalize(input);
  if (isEmpty(data)) {
    await removePath(file); // empty data → sidecar removed (v1.0 §3)
    return null;
  }
  await writeJson(file, data);
  return data;
}
