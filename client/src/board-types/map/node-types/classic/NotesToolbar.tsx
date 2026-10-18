import { useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import {
  Bold,
  Code,
  Code2,
  Eye,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  PenLine,
  Quote,
  Type,
} from 'lucide-react';
import { Tooltip } from '@/shared/ui';
import { useDismiss } from '@/shared/hooks';
import { commands } from './markdownCommands';

/** Slim formatting bar pinned above the Notes editor (§2). */
export function NotesToolbar({
  view,
  preview,
  onTogglePreview,
}: {
  view: EditorView | null;
  preview: boolean;
  onTogglePreview: () => void;
}) {
  const [headingOpen, setHeadingOpen] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);
  useDismiss(headingRef, () => setHeadingOpen(false), headingOpen);

  const run = (fn: (v: EditorView) => void) => () => {
    if (view) fn(view);
  };

  const disabled = !view || preview;

  return (
    <div className="cg-notes-toolbar">
      <div className="cg-notes-toolbar__group">
        <Tooltip label="Bold" keys={['⌘B']}>
          <button type="button" className="cg-fmt" onClick={run(commands.bold)} disabled={disabled} aria-label="Bold">
            <Bold size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Italic" keys={['⌘I']}>
          <button type="button" className="cg-fmt" onClick={run(commands.italic)} disabled={disabled} aria-label="Italic">
            <Italic size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Inline code">
          <button type="button" className="cg-fmt" onClick={run(commands.code)} disabled={disabled} aria-label="Inline code">
            <Code size={15} />
          </button>
        </Tooltip>
      </div>

      <span className="cg-notes-toolbar__sep" />

      <div className="cg-notes-toolbar__group" ref={headingRef} style={{ position: 'relative' }}>
        <button
          type="button"
          className={`cg-fmt${headingOpen ? ' is-active' : ''}`}
          onClick={() => setHeadingOpen((o) => !o)}
          disabled={disabled}
          aria-label="Heading"
        >
          <Type size={15} />
        </button>
        {headingOpen && (
          <div className="cg-heading-menu">
            {([1, 2, 3] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => {
                  if (view) commands.heading(view, level);
                  setHeadingOpen(false);
                }}
              >
                H{level}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                if (view) commands.heading(view, 0);
                setHeadingOpen(false);
              }}
            >
              None
            </button>
          </div>
        )}
      </div>

      <div className="cg-notes-toolbar__group">
        <Tooltip label="Bullet list" keys={['⌘⇧8']}>
          <button type="button" className="cg-fmt" onClick={run(commands.bullet)} disabled={disabled} aria-label="Bullet list">
            <List size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Numbered list" keys={['⌘⇧7']}>
          <button type="button" className="cg-fmt" onClick={run(commands.numbered)} disabled={disabled} aria-label="Numbered list">
            <ListOrdered size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Task list">
          <button type="button" className="cg-fmt" onClick={run(commands.task)} disabled={disabled} aria-label="Task list">
            <ListTodo size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Quote">
          <button type="button" className="cg-fmt" onClick={run(commands.quote)} disabled={disabled} aria-label="Quote">
            <Quote size={15} />
          </button>
        </Tooltip>
      </div>

      <span className="cg-notes-toolbar__sep" />

      <div className="cg-notes-toolbar__group">
        <Tooltip label="Code block">
          <button type="button" className="cg-fmt" onClick={run(commands.codeBlock)} disabled={disabled} aria-label="Code block">
            <Code2 size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Link" keys={['⌘K']}>
          <button type="button" className="cg-fmt" onClick={run(commands.link)} disabled={disabled} aria-label="Link">
            <Link size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Divider">
          <button type="button" className="cg-fmt" onClick={run(commands.divider)} disabled={disabled} aria-label="Divider">
            <Minus size={15} />
          </button>
        </Tooltip>
      </div>

      <div className="spacer" />

      <Tooltip label={preview ? 'Edit' : 'Preview'}>
        <button
          type="button"
          className={`cg-fmt cg-fmt--wide${preview ? ' is-active' : ''}`}
          onClick={onTogglePreview}
          aria-label={preview ? 'Edit' : 'Preview'}
        >
          {preview ? <PenLine size={15} /> : <Eye size={15} />}
          {preview ? 'Edit' : 'Preview'}
        </button>
      </Tooltip>
    </div>
  );
}
