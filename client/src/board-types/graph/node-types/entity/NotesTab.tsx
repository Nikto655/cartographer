import { useState } from 'react';
import { Eye, PenLine } from 'lucide-react';
import { Tooltip } from '@/shared/ui';
import type { NodeTabProps } from '@/board-types/types';
import { CodeEditor } from '@/modules/editor/CodeEditor';
import { MarkdownPreview } from '@/modules/editor/MarkdownPreview';

/** Preview mode is per node and remembered for the session, as on maps. */
const previewByNode = new Map<string, boolean>();

/**
 * The entity's file body. Plainer than the map's notes surface on purpose: an
 * entity is a thing you name and connect, and `[[` linking is the formatting
 * that matters here.
 */
export function NotesTab({ nodeId, content, onBodyChange, readOnly }: NodeTabProps) {
  const [preview, setPreview] = useState(() => previewByNode.get(nodeId) ?? false);

  const togglePreview = () => {
    const next = !preview;
    previewByNode.set(nodeId, next);
    setPreview(next);
  };

  return (
    <div className="cg-notes">
      <div className="cg-notes-toolbar">
        <div className="spacer" />
        <Tooltip label={preview ? 'Edit' : 'Preview'}>
          <button
            type="button"
            className={`cg-fmt cg-fmt--wide${preview ? ' is-active' : ''}`}
            onClick={togglePreview}
            aria-label={preview ? 'Edit' : 'Preview'}
          >
            {preview ? <PenLine size={15} /> : <Eye size={15} />}
            {preview ? 'Edit' : 'Preview'}
          </button>
        </Tooltip>
      </div>

      {preview ? (
        <MarkdownPreview markdown={content.body} className="cg-notes__preview" />
      ) : (
        <div className="cg-editor__prose">
          <CodeEditor
            key={`${nodeId}-notes`}
            value={content.body}
            onChange={onBodyChange}
            language="markdown"
            hint={
              readOnly
                ? undefined
                : 'What is this entity, and how does it relate to the rest… type [[ to link another entity'
            }
            linkAutocomplete={!readOnly}
            readOnly={readOnly}
          />
        </div>
      )}
    </div>
  );
}
