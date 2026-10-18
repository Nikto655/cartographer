import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Zap } from 'lucide-react';
import type { DataSnippet, IncomingData } from '@cartograph/shared';
import { Button } from '@/shared/ui';
import type { NodeTabProps } from '@/board-types/types';
import { CodeEditor } from '@/modules/editor/CodeEditor';
import { SnippetEditor, emptyData, newSnippet } from './SnippetEditor';

/**
 * Incoming data, laid out to be read.
 *
 * Re-indented rather than shown as sent: what arrives is whatever the upstream
 * author typed, and a payload pasted from a log is one very long line — which
 * the old `<pre>` wrapped mid-token into an unreadable block. Reformatting is
 * safe here precisely because this view is read-only: the source snippet on the
 * other node is never touched, so nobody's file is rewritten by being looked at.
 *
 * Anything that does not parse is shown exactly as it came. A malformed payload
 * is a thing you need to see, and quietly tidying it would hide the fault.
 */
function readable(code: string, lang: string): string {
  const trimmed = code.trim();
  // Only JSON, and only when it round-trips: `JSON.parse` accepts a bare number
  // or string, and "42" is not a document that wants pretty-printing.
  if (lang !== 'json' || !/^[[{]/.test(trimmed)) return code;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return code;
  }
}

/** Read-only view of one upstream node's output (§4.3). */
export function IncomingCard({
  item,
  onOpenSource,
}: {
  item: IncomingData;
  onOpenSource?: (nodeId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="cg-incoming">
      <div className="cg-incoming__head">
        <button
          type="button"
          className="cg-snippet__caret"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          type="button"
          className="cg-incoming__source"
          onClick={() => onOpenSource?.(item.sourceId)}
          title="Go to source node"
        >
          {item.sourceTitle}
        </button>
        <span className="cg-incoming__arrow">→</span>
        <span className="cg-incoming__label">{item.snippet.label}</span>
        <span className="cg-incoming__lang mono">{item.snippet.lang}</span>
      </div>
      {open && (
        // The same editor the snippet is written in, read-only: syntax colour,
        // a gutter to count by, and horizontal scroll instead of a wrapped
        // token. A `<pre>` had none of those and was the only place in the app
        // where code was shown as plain grey text.
        <div className="cg-incoming__view">
          <CodeEditor
            value={readable(item.snippet.code, item.snippet.lang)}
            onChange={() => {}}
            language={item.snippet.lang === 'json' ? 'json' : 'code'}
            mono
            gutter
            readOnly
          />
        </div>
      )}
    </div>
  );
}

/** Snippets with a marked output, plus what flows in (§4.3). */
export function DataTab({
  content: { data, incoming },
  onDataChange: onChange,
  onOpenNode: onOpenSource,
  readOnly,
}: NodeTabProps) {
  const current = data ?? emptyData();

  const update = (snippets: DataSnippet[], outSnippetId: string | null | undefined) =>
    onChange({ version: 2, snippets, outSnippetId: outSnippetId ?? null });

  const patchSnippet = (id: string, patch: Partial<DataSnippet>) =>
    update(
      current.snippets.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      current.outSnippetId,
    );

  const addSnippet = () =>
    update([...current.snippets, newSnippet(current.snippets.length + 1)], current.outSnippetId);

  const removeSnippet = (id: string) =>
    update(
      current.snippets.filter((s) => s.id !== id),
      current.outSnippetId === id ? null : current.outSnippetId,
    );

  const toggleOutput = (id: string) =>
    update(current.snippets, current.outSnippetId === id ? null : id);

  return (
    <div className="cg-data">
      <section className="cg-data__section">
        <header className="cg-data__head">
          <span className="label">Snippets</span>
          {!readOnly && (
            <Button variant="ghost" onClick={addSnippet}>
              <Plus size={14} /> Add snippet
            </Button>
          )}
        </header>

        {current.snippets.length === 0 && (
          <p className="cg-data__empty muted">
            {readOnly ? 'No snippets.' : <>No snippets yet. Add one, then mark it <Zap size={11} /> Output to pass it downstream.</>}
          </p>
        )}

        {current.snippets.map((snippet) => (
          <SnippetEditor
            key={snippet.id}
            snippet={snippet}
            isOutput={current.outSnippetId === snippet.id}
            onChange={(patch) => patchSnippet(snippet.id, patch)}
            onToggleOutput={() => toggleOutput(snippet.id)}
            onRemove={() => removeSnippet(snippet.id)}
            readOnly={readOnly}
          />
        ))}
      </section>

      <section className="cg-data__section">
        <header className="cg-data__head">
          <span className="label">Incoming</span>
          <span className="cg-data__count mono">{incoming.length}</span>
        </header>

        {incoming.length === 0 ? (
          <p className="cg-data__empty muted">
            Nothing flows in yet — mark an output snippet on an upstream node.
          </p>
        ) : (
          incoming.map((item) => (
            <IncomingCard key={item.edgeId} item={item} onOpenSource={onOpenSource} />
          ))
        )}
      </section>
    </div>
  );
}
