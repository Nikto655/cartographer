import DOMPurify from 'dompurify';

/**
 * The one place rendered markdown becomes HTML.
 *
 * `marked` passes raw HTML through untouched by design, so a note body is
 * attacker-controlled markup the moment a board can be shared (v1.6 §5): an
 * `<img onerror>` in someone else's notes would otherwise run in your origin,
 * with your session, the moment you previewed or walked their board. Read-only
 * viewing is not protection — it renders through exactly the same path.
 *
 * Everything that reaches `dangerouslySetInnerHTML` goes through here.
 */
export function safeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    /*
     * `target` so our own wiki-links keep theirs; `data-cg-node` and
     * `data-cg-board` are how a rendered link tells the click handler what it
     * points at. Both must be listed: DOMPurify drops unknown `data-*`
     * attributes silently, so a link missing from here renders and simply does
     * nothing when clicked.
     *
     * Neither is a hole. The handler looks each id up in an index built from
     * this workspace's own canvas and board list, so a note that invents one
     * resolves to nothing — the value is a lookup key, never a destination.
     */
    ADD_ATTR: ['target', 'data-cg-node', 'data-cg-board'],
    // Markdown produces documents, never fragments of a form or a script.
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
  });
}
