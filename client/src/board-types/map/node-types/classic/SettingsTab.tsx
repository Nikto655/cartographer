import type { NodeShape } from '@cartograph/shared';
import { Copy, CornerDownRight, FileCode, Trash2 } from 'lucide-react';
import { isCard, useStore } from '@/shared/store';
import { Button } from '@/shared/ui';
import { ColorSwatches } from '@/shared/ui/ColorSwatches';
import { useWorkspaceRoot } from '@/modules/auth';
import type { NodeTabProps } from '@/board-types/types';

const SHAPE_LABELS: Record<NodeShape, string> = {
  rect: 'Rect',
  rounded: 'Rounded',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  pill: 'Pill',
};

/** Per-node presentation and housekeeping (§4.4). */
export function SettingsTab({
  nodeId,
  content,
  onOpenRaw,
  onDuplicate,
  onOpenTab,
  readOnly,
}: NodeTabProps) {
  const created = String(content.frontmatter.created ?? '');
  const hasDescription = !!String(content.frontmatter.description ?? '').trim();
  const onExpand = () => onOpenTab('subboards');

  const config = useStore((s) => s.config);
  const board = useStore((s) => s.board);
  const root = useWorkspaceRoot();
  const node = useStore((s) => {
    const found = s.nodes.find((n) => n.id === nodeId);
    return found && isCard(found) ? found : undefined;
  });
  const setShowDescription = useStore((s) => s.setShowDescription);
  const toggleVariant = useStore((s) => s.toggleVariant);
  const setShape = useStore((s) => s.setShape);
  const setColor = useStore((s) => s.setColor);
  const archiveNodes = useStore((s) => s.archiveNodes);

  if (!node || !config || !board) return null;

  const isChip = node.data.variant === 'chip';
  const showDescription = node.data.showDescription ?? hasDescription;

  return (
    <div className="cg-settings">
      {/* Every row in this section sets something; there is no read of it (§5). */}
      {!readOnly && (
      <section className="cg-settings__section">
        <span className="label">Card</span>

        <label className={`cg-settings__row${hasDescription ? '' : ' is-disabled'}`}>
          <span>
            Show description on card
            {!hasDescription && <em className="muted"> · add one in Overview first</em>}
          </span>
          <input
            type="checkbox"
            checked={showDescription && hasDescription}
            disabled={!hasDescription}
            onChange={(e) => setShowDescription(nodeId, e.target.checked)}
          />
        </label>

        <div className="cg-settings__row">
          <span>Variant</span>
          <div className="cg-settings__segmented">
            <button
              type="button"
              className={!isChip ? 'is-active' : ''}
              onClick={() => isChip && toggleVariant([nodeId])}
            >
              Card
            </button>
            <button
              type="button"
              className={isChip ? 'is-active' : ''}
              onClick={() => !isChip && toggleVariant([nodeId])}
            >
              Chip
            </button>
          </div>
        </div>

        {!isChip && (
          <div className="cg-settings__row">
            <span>Shape</span>
            <div className="cg-settings__segmented">
              {config.shapes.map((shape) => (
                <button
                  key={shape}
                  type="button"
                  className={node.data.shape === shape ? 'is-active' : ''}
                  onClick={() => setShape([nodeId], shape)}
                >
                  {SHAPE_LABELS[shape]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="cg-settings__row">
          <span>Colour</span>
          <ColorSwatches
            colors={config.colors}
            selected={node.data.color}
            onPick={(token) => setColor([nodeId], token)}
          />
        </div>
      </section>
      )}

      <section className="cg-settings__section">
        <span className="label">Actions</span>
        <div className="cg-settings__actions">
          <Button onClick={onOpenRaw}>
            <FileCode size={14} /> {readOnly ? 'View raw file' : 'Edit raw file'}
          </Button>
          {!readOnly && (
            <Button onClick={onDuplicate}>
              <Copy size={14} /> Duplicate
            </Button>
          )}
          <Button onClick={onExpand}>
            <CornerDownRight size={14} />{' '}
            {node.data.childBoards?.length
              ? 'Manage sub-boards'
              : readOnly
                ? 'Sub-boards'
                : 'Add a sub-board'}
          </Button>
        </div>
      </section>

      <section className="cg-settings__section">
        <span className="label">File</span>
        <dl className="cg-settings__facts mono">
          <div>
            <dt>id</dt>
            <dd>{nodeId}</dd>
          </div>
          <div>
            <dt>notes</dt>
            <dd>
              {root}boards/{board.id}/nodes/{nodeId}/node.md
            </dd>
          </div>
          <div>
            <dt>data</dt>
            <dd>
              {root}boards/{board.id}/nodes/{nodeId}/data.json
              {!node.data.hasData && <span className="muted"> · not created</span>}
            </dd>
          </div>
          <div>
            <dt>created</dt>
            <dd>{created}</dd>
          </div>
        </dl>
      </section>

      {!readOnly && (
        <section className="cg-settings__section">
          <span className="label">Danger zone</span>
          <div className="cg-settings__danger">
            <span className="muted">
              Archiving moves the files to your workspace archive. Nothing is deleted.
            </span>
            <Button variant="danger" onClick={() => void archiveNodes([nodeId])}>
              <Trash2 size={14} /> Archive node
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
