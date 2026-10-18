import { ChevronDown, ChevronRight, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import type { DataSnippet, NodeData } from '@cartograph/shared';
import { Tooltip } from '@/shared/ui';
import { CodeEditor } from '@/modules/editor/CodeEditor';

export const LANGS = ['ts', 'js', 'json', 'py', 'sql', 'sh', 'md', 'txt'];

export function newSnippetId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/**
 * What a fresh snippet starts as.
 *
 * JSON rather than TypeScript, and seeded rather than blank. A snippet's job on
 * this canvas is to *carry* something to the node downstream — `IncomingCard`
 * renders whatever it holds as a document, not as a program — and JSON is the
 * shape that survives that trip. The old `ts` default described the language you
 * would write the transform in, which is a different question from what flows.
 *
 * The example earns its place by answering "what goes in here" in one glance:
 * an object with a string, a number, an array and a nested object is the whole
 * grammar, and it is immediately overwritable. An empty box answers nothing.
 */
export const EXAMPLE_JSON = `{
  "id": "order-1042",
  "status": "paid",
  "total": 49.99,
  "items": [
    { "sku": "CG-1", "qty": 2 }
  ]
}`;

/** One definition of a new snippet — the Overview and Data tabs both add them. */
export function newSnippet(index: number): DataSnippet {
  return {
    id: newSnippetId(),
    label: `snippet ${index}`,
    lang: 'json',
    code: EXAMPLE_JSON,
  };
}

export const emptyData = (): NodeData => ({ version: 2, snippets: [], outSnippetId: null });

/** The output mark: at most one snippet per node is passed downstream (§5.1). */
export function OutputToggle({
  marked: isOutput,
  onToggle,
  readOnly = false,
}: {
  marked: boolean;
  onToggle: () => void;
  readOnly?: boolean;
}) {
  // Read-only: the marker still says which snippet flows on — it just can't move.
  if (readOnly) {
    return (
      <span className={`cg-output-toggle${isOutput ? ' is-on' : ''}`}>
        <Zap size={13} />
        Output
      </span>
    );
  }
  return (
    <Tooltip label={isOutput ? 'Passed downstream' : 'Mark as output'}>
      <button
        type="button"
        className={`cg-output-toggle${isOutput ? ' is-on' : ''}`}
        onClick={onToggle}
        aria-pressed={isOutput}
        aria-label="Mark as output"
      >
        <Zap size={13} />
        Output
      </button>
    </Tooltip>
  );
}

/** Full editing depth for one snippet: label, language, code, output marker. */
export function SnippetEditor({
  snippet,
  isOutput,
  onChange,
  onToggleOutput,
  onRemove,
  readOnly = false,
}: {
  snippet: DataSnippet;
  isOutput: boolean;
  onChange: (patch: Partial<DataSnippet>) => void;
  onToggleOutput: () => void;
  onRemove: () => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className={`cg-snippet${isOutput ? ' is-output' : ''}`}>
      <div className="cg-snippet__head">
        <button
          type="button"
          className="cg-snippet__caret"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {readOnly ? (
          <>
            <span className="cg-snippet__label">{snippet.label}</span>
            <span className="cg-snippet__lang mono">{snippet.lang}</span>
          </>
        ) : (
          <>
            <input
              className="input cg-snippet__label"
              value={snippet.label}
              placeholder="label"
              onChange={(e) => onChange({ label: e.target.value })}
            />
            <select
              className="input cg-snippet__lang mono"
              value={LANGS.includes(snippet.lang) ? snippet.lang : 'txt'}
              onChange={(e) => onChange({ lang: e.target.value })}
              aria-label="Language"
            >
              {LANGS.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </>
        )}
        <OutputToggle marked={isOutput} onToggle={onToggleOutput} readOnly={readOnly} />
        {!readOnly && (
          <button type="button" className="cg-snippet__remove" onClick={onRemove} aria-label="Delete snippet">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="cg-data__editor">
          <CodeEditor
            key={snippet.id}
            value={snippet.code}
            onChange={(code) => onChange({ code })}
            language={snippet.lang === 'json' ? 'json' : 'code'}
            mono
            gutter
            minHeight={92}
            readOnly={readOnly}
          />
        </div>
      )}
    </div>
  );
}
