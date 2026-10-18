import { useMemo } from 'react';
import { ArrowRight, ArrowUpRight, CornerDownLeft } from 'lucide-react';
import { linkKey } from '@cartograph/shared';
import { revealNode } from '@/shared/canvasActions';
import { mentionedTitles, useLiveLinks, useTitleById } from '@/shared/links';
import type { NodeTabProps } from '@/board-types/types';
import { MarkdownPreview } from '@/modules/editor/MarkdownPreview';
import './entity.css';

/**
 * An entity's front page: what it is, in its own words, and what it sits between
 * (§3.3). Nothing flows on a graph, so there are no snippets and no incoming
 * section — the two relationship sections are the derived layer read as a list.
 * They live here, in the graph's node type, which is why a map never grows them.
 */
export function OverviewTab({ nodeId, content: { body }, onOpenTab, readOnly }: NodeTabProps) {
  const onOpenNotes = () => onOpenTab('notes');
  const links = useLiveLinks();
  const titles = useTitleById();

  /*
   * Links out come from the body being edited right now, not the cache, so the
   * list answers a keystroke. Backlinks can only come from other notes, which is
   * what the cache is for.
   */
  const out = useMemo(() => {
    const resolved = new Map(
      links.filter((link) => link.sourceId === nodeId).map((link) => [linkKey(link.title), link]),
    );
    const seen = new Set<string>();
    return mentionedTitles(body)
      .filter((title) => {
        const key = linkKey(title);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((title) => {
        const link = resolved.get(linkKey(title));
        return { title, targetId: link?.targetId ?? null, ambiguous: !!link?.ambiguous };
      })
      .filter((item) => item.targetId !== null || !item.ambiguous);
  }, [links, nodeId, body]);

  const back = useMemo(() => {
    const sources = new Set(
      links
        .filter((link) => link.targetId === nodeId && link.sourceId !== nodeId)
        .map((link) => link.sourceId),
    );
    return [...sources].map((id) => ({ id, title: titles.get(id) ?? id }));
  }, [links, nodeId, titles]);

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
          <span className="label">Links out</span>
          <span className="cg-data__count mono">{out.length}</span>
        </div>
        {out.length === 0 ? (
          <p className="cg-data__empty muted">
            {readOnly ? (
              'Nothing mentioned.'
            ) : (
              <>
                Nothing mentioned yet. Type <code>[[</code> in the notes to point at something.
              </>
            )}
          </p>
        ) : (
          <ul className="cg-links">
            {out.map((item) => (
              <li key={linkKey(item.title)}>
                <button
                  type="button"
                  className={`cg-links__item${item.targetId ? '' : ' is-unresolved'}`}
                  disabled={!item.targetId}
                  title={item.targetId ? 'Go to this entity' : 'Nothing on this graph has this title yet'}
                  onClick={() => item.targetId && revealNode(item.targetId)}
                >
                  <ArrowUpRight size={12} />
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cg-overview__section">
        <div className="cg-overview__head">
          <span className="label">Backlinks</span>
          <span className="cg-data__count mono">{back.length}</span>
        </div>
        {back.length === 0 ? (
          <p className="cg-data__empty muted">Nothing mentions this yet.</p>
        ) : (
          <ul className="cg-links">
            {back.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="cg-links__item"
                  title="Go to this entity"
                  onClick={() => revealNode(item.id)}
                >
                  <CornerDownLeft size={12} />
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
