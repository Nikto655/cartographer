import { useMemo, type MouseEvent } from 'react';
import { Marked, type MarkedExtension, type Tokens } from 'marked';
import { isCrossBoardLink, resolveWikiLink, wikiLinkStartPattern } from '@cartograph/shared';
import { revealNode } from '@/shared/canvasActions';
import { boardHref, navigate } from '@/shared/router';
import { useBoardTitleIndex, useNodeTitleIndex } from '@/shared/links';
import { safeHtml } from '@/shared/safeHtml';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => ESCAPES[char]);

interface WikiLinkToken extends Tokens.Generic {
  type: 'wikilink';
  title: string;
}

/**
 * `[[Title]]` as a marked token rather than a string pass, so links inside code
 * spans and fences stay literal text (v1.5 §4.1).
 */
function wikiLinks(
  resolve: (title: string) => string | null,
  resolveBoard: (title: string) => string | null,
): MarkedExtension {
  return {
    extensions: [
      {
        name: 'wikilink',
        level: 'inline',
        start(src: string) {
          const at = src.indexOf('[[');
          return at < 0 ? undefined : at;
        },
        tokenizer(src: string) {
          const match = wikiLinkStartPattern().exec(src);
          if (!match) return undefined;
          return { type: 'wikilink', raw: match[0], title: match[1].trim() } as WikiLinkToken;
        },
        renderer(token: Tokens.Generic) {
          const { title } = token as WikiLinkToken;
          const text = escapeHtml(title);
          const targetId = resolve(title);
          if (targetId) {
            return `<a class="cg-wikilink" href="#" data-cg-node="${escapeHtml(targetId)}">${text}</a>`;
          }
          /*
           * Only once no node answers to it. A note written before boards were
           * linkable therefore cannot change meaning, and a node added later
           * takes the title back — the node index is always asked first.
           */
          const boardId = resolveBoard(title);
          if (boardId) {
            return `<a class="cg-wikilink cg-wikilink--board" href="#" data-cg-board="${escapeHtml(
              boardId,
            )}" title="Opens the board “${escapeHtml(title)}”">${text}</a>`;
          }
          // Unresolved is not an error: plain text, a dotted underline, a reason (§4.2).
          const why = isCrossBoardLink(title)
            ? 'Cross-map links are reserved — not resolved yet'
            : 'Nothing here — no node on this map, and no board — has this title';
          return `<span class="cg-wikilink is-unresolved" title="${why}">${text}</span>`;
        },
      },
    ],
  };
}

/** Rendered markdown, same typography as the walkthrough (§2). */
export function MarkdownPreview({
  markdown,
  empty = 'Nothing written yet.',
  className = '',
  onClick,
}: {
  markdown: string;
  empty?: string;
  className?: string;
  onClick?: () => void;
}) {
  const titles = useNodeTitleIndex();
  const boards = useBoardTitleIndex();
  /** The ids the click handler is willing to follow — see `handleClick`. */
  const boardIds = useMemo(
    () => new Set([...boards.values()].filter((id): id is string => id !== null)),
    [boards],
  );

  const html = useMemo(() => {
    if (!markdown.trim()) return `<p class="cg-preview__empty">${empty}</p>`;
    const renderer = new Marked(
      wikiLinks(
        (title) => resolveWikiLink(titles, title),
        (title) => resolveWikiLink(boards, title),
      ),
    );
    // Note bodies can come from someone else's workspace — never trust them.
    return safeHtml(renderer.parse(markdown, { async: false }) as string);
  }, [markdown, empty, titles, boards]);

  // A link click navigates; anything else falls through to the surface's own action.
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest<HTMLElement>('[data-cg-node], [data-cg-board]');
    if (link?.dataset.cgNode) {
      event.preventDefault();
      event.stopPropagation();
      revealNode(link.dataset.cgNode);
      return;
    }
    if (link?.dataset.cgBoard) {
      event.preventDefault();
      event.stopPropagation();
      /*
       * Checked against the index rather than trusted. `marked` passes raw HTML
       * through, so a note body can hand-write `data-cg-board="…"` — and unlike
       * `revealNode`, which no-ops on an id the canvas does not have, navigating
       * would act on whatever it was given. Only ids the workspace actually
       * has as boards get followed.
       *
       * `boardHref`, not `routes.board`: drilling from inside somebody else's
       * shared tree has to stay in their workspace, or the same slug in your own
       * boards silently answers instead.
       */
      if (boardIds.has(link.dataset.cgBoard)) navigate(boardHref(link.dataset.cgBoard));
      return;
    }
    onClick?.();
  };

  return (
    <div
      className={`cg-preview ${className}`}
      onClick={handleClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
