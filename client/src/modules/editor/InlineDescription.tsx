import { useEffect, useRef, useState } from 'react';

/**
 * The node's description, edited in place under the title. No label, no field —
 * it reads as a subtitle until you click it.
 */
export function InlineDescription({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(value), [value]);

  // Grow to the content so nothing is hidden while typing.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, focused]);

  const commit = () => {
    setFocused(false);
    const next = draft.trim();
    if (next !== value) onCommit(next);
    else setDraft(value);
  };

  return (
    <textarea
      ref={area}
      className={`cg-editor__description${focused ? ' is-editing' : ''}`}
      value={draft}
      rows={1}
      placeholder="Add a short description…"
      aria-label="Node description"
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          area.current?.blur();
        }
        if (e.key === 'Escape') {
          setDraft(value);
          area.current?.blur();
        }
      }}
    />
  );
}
