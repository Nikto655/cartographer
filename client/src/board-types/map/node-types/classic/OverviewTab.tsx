import { useState } from 'react';
import { ArrowRight, Plus, Zap } from 'lucide-react';
import type { DataSnippet } from '@cartograph/shared';
import { Button } from '@/shared/ui';
import type { NodeTabProps } from '@/board-types/types';
import { MarkdownPreview } from '@/modules/editor/MarkdownPreview';
import { IncomingCard } from './DataTab';
import { OutputToggle, emptyData, newSnippet } from './SnippetEditor';

/** The panel's default surface: read, with light editing in place (§4.1). */
export function OverviewTab({
  content: { body, data, incoming },
  onDataChange: onData,
  onOpenTab,
  onOpenNode: onOpenSource,
  readOnly,
}: NodeTabProps) {
  const current = data ?? emptyData();
  const onOpenNotes = () => onOpenTab('notes');

  const addSnippet = () =>
    onData({
      version: 2,
      snippets: [...current.snippets, newSnippet(current.snippets.length + 1)],
      outSnippetId: current.outSnippetId ?? null,
    });

  const toggleOutput = (id: string) =>
    onData({
      version: 2,
      snippets: current.snippets,
      outSnippetId: current.outSnippetId === id ? null : id,
    });

  return (
    <div className="cg-overview">
      <section className="cg-overview__section">
        <div className="cg-overview__head">
          <span className="label">Notes</span>
          <button type="button" className="cg-overview__link" onClick={onOpenNotes}>
            {readOnly ? 'Read in Notes' : 'Open in Notes'} <ArrowRight size={12} />
          </button>
        </div>
        <MarkdownPreview
          markdown={body}
          empty={readOnly ? 'No notes.' : 'No notes yet — click to start writing.'}
          className="cg-overview__notes"
          onClick={onOpenNotes}
        />
      </section>

      <section className="cg-overview__section">
        <div className="cg-overview__head">
          <span className="label">Snippets</span>
          {!readOnly && (
            <Button variant="ghost" onClick={addSnippet}>
              <Plus size={14} /> Add snippet
            </Button>
          )}
        </div>

        {current.snippets.length === 0 ? (
          <p className="cg-data__empty muted">
            {readOnly ? (
              'No snippets.'
            ) : (
              <>
                Nothing yet. A snippet marked <Zap size={11} /> Output is what this node passes on.
              </>
            )}
          </p>
        ) : (
          <ul className="cg-overview__snippets">
            {current.snippets.map((snippet) => (
              <SnippetRow
                key={snippet.id}
                snippet={snippet}
                isOutput={current.outSnippetId === snippet.id}
                onToggleOutput={() => toggleOutput(snippet.id)}
                readOnly={readOnly}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="cg-overview__section">
        <div className="cg-overview__head">
          <span className="label">Incoming</span>
          <span className="cg-data__count mono">{incoming.length}</span>
        </div>
        {incoming.length === 0 ? (
          <p className="cg-data__empty muted">Nothing flows in yet.</p>
        ) : (
          incoming.map((item) => (
            <IncomingCard key={item.edgeId} item={item} onOpenSource={onOpenSource} />
          ))
        )}
      </section>
    </div>
  );
}

function SnippetRow({
  snippet,
  isOutput,
  onToggleOutput,
  readOnly,
}: {
  snippet: DataSnippet;
  isOutput: boolean;
  onToggleOutput: () => void;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const firstLine = snippet.code.split('\n')[0] || '—';

  return (
    <li className={`cg-snippet-row${isOutput ? ' is-output' : ''}`}>
      <button type="button" className="cg-snippet-row__main" onClick={() => setOpen((o) => !o)}>
        <span className="cg-snippet-row__label">{snippet.label}</span>
        <span className="cg-snippet-row__lang mono">{snippet.lang}</span>
        <span className="cg-snippet-row__preview mono">{firstLine}</span>
      </button>
      <OutputToggle marked={isOutput} onToggle={onToggleOutput} readOnly={readOnly} />
      {open && <pre className="cg-incoming__code mono">{snippet.code || '(empty)'}</pre>}
    </li>
  );
}
