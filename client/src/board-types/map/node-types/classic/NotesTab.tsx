import { useMemo, useState } from 'react';
import type { EditorView, KeyBinding } from '@codemirror/view';
import { CodeEditor } from '@/modules/editor/CodeEditor';
import { MarkdownPreview } from '@/modules/editor/MarkdownPreview';
import type { NodeTabProps } from '@/board-types/types';
import { NotesToolbar } from './NotesToolbar';
import { commands } from './markdownCommands';

/** Preview mode is per node and remembered for the session (§2). */
const previewByNode = new Map<string, boolean>();

/** The markdown body of the node's file, with its toolbar and preview (v1.3 §2). */
export function NotesTab({ nodeId, content, onBodyChange, readOnly }: NodeTabProps) {
  const [preview, setPreview] = useState(() => previewByNode.get(nodeId) ?? false);
  const [notesView, setNotesView] = useState<EditorView | null>(null);

  // ---- notes shortcuts (§2): Cmd+K is a link in here, not the palette ----
  const shortcuts = useMemo<KeyBinding[]>(
    () => [
      { key: 'Mod-b', run: (view) => (commands.bold(view), true) },
      { key: 'Mod-i', run: (view) => (commands.italic(view), true) },
      { key: 'Mod-k', run: (view) => (commands.link(view), true) },
      { key: 'Mod-Shift-8', run: (view) => (commands.bullet(view), true) },
      { key: 'Mod-Shift-7', run: (view) => (commands.numbered(view), true) },
    ],
    [],
  );

  const togglePreview = () => {
    const next = !preview;
    previewByNode.set(nodeId, next);
    setPreview(next);
  };

  return (
    <div className="cg-notes">
      {/* The toolbar is nothing but formatting commands (§5). */}
      {readOnly ? (
        <div className="cg-notes-toolbar">
          <div className="spacer" />
          <button
            type="button"
            className={`cg-fmt cg-fmt--wide${preview ? ' is-active' : ''}`}
            onClick={togglePreview}
          >
            {preview ? 'Source' : 'Preview'}
          </button>
        </div>
      ) : (
        <NotesToolbar view={notesView} preview={preview} onTogglePreview={togglePreview} />
      )}
      {preview ? (
        <MarkdownPreview markdown={content.body} className="cg-notes__preview" />
      ) : (
        <div className="cg-editor__prose">
          <CodeEditor
            key={`${nodeId}-notes`}
            value={content.body}
            onChange={onBodyChange}
            language="markdown"
            hint={readOnly ? undefined : 'Write what this step does, why it exists, what can go wrong… type [[ to link a node'}
            shortcuts={shortcuts}
            linkAutocomplete={!readOnly}
            readOnly={readOnly}
            onReady={setNotesView}
          />
        </div>
      )}
    </div>
  );
}
