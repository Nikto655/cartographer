import { Copy, CornerDownRight, FileCode, Trash2 } from 'lucide-react';
import { isCard, useStore } from '@/shared/store';
import { Button } from '@/shared/ui';
import { ColorSwatches } from '@/shared/ui/ColorSwatches';
import { useWorkspaceRoot } from '@/modules/auth';
import type { NodeTabProps } from '@/board-types/types';

/**
 * Per-entity housekeeping. Shape, chip variant and the on-card description are
 * map furniture — a dot has none of them — so only colour and the file actions
 * survive here (§3.3).
 */
export function SettingsTab({
  nodeId,
  content,
  onOpenRaw,
  onDuplicate,
  onOpenTab,
  readOnly,
}: NodeTabProps) {
  const created = String(content.frontmatter.created ?? '');
  const config = useStore((s) => s.config);
  const board = useStore((s) => s.board);
  const root = useWorkspaceRoot();
  const node = useStore((s) => {
    const found = s.nodes.find((n) => n.id === nodeId);
    return found && isCard(found) ? found : undefined;
  });
  const setColor = useStore((s) => s.setColor);
  const archiveNodes = useStore((s) => s.archiveNodes);

  if (!node || !config || !board) return null;

  return (
    <div className="cg-settings">
      {!readOnly && (
      <section className="cg-settings__section">
        <span className="label">Dot</span>
        <div className="cg-settings__row">
          <span>Colour</span>
          <ColorSwatches
            colors={config.colors}
            selected={node.data.color}
            onPick={(token) => setColor([nodeId], token)}
          />
        </div>
        <p className="muted">
          Size is degree — the more an entity connects, the bigger its dot.
        </p>
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
          <Button onClick={() => onOpenTab('subboards')}>
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
              <Trash2 size={14} /> Archive entity
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
