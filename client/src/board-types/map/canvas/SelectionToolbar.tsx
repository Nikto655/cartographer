import { useState, type ReactElement } from 'react';
import { NodeToolbar, Position } from '@xyflow/react';
import {
  Bold,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownRight,
  Frame as FrameIcon,
  Italic,
  PanelRight,
  Tag,
  Trash2,
  Underline,
} from 'lucide-react';
import type { NodeShape } from '@cartograph/shared';
import { isCard, isFrame, isText, useStore } from '@/shared/store';
import { Modal, Button, Tooltip } from '@/shared/ui';
import { ColorSwatches } from '@/shared/ui/ColorSwatches';
import { navigate, routes } from '@/shared/router';

const SHAPE_GLYPHS: Record<NodeShape, ReactElement> = {
  rect: <rect x="1.5" y="3.5" width="15" height="11" />,
  rounded: <rect x="1.5" y="3.5" width="15" height="11" rx="3" />,
  ellipse: <ellipse cx="9" cy="9" rx="7.5" ry="5.5" />,
  diamond: <polygon points="9,2.5 16,9 9,15.5 2,9" />,
  pill: <rect x="1.5" y="3.5" width="15" height="11" rx="5.5" />,
};

/** Text labels come in three sizes; the glyph previews each one (§4.3). */
const TEXT_SIZES: { id: 'sm' | 'md' | 'lg'; label: string; preview: string }[] = [
  { id: 'sm', label: 'Small', preview: '11px' },
  { id: 'md', label: 'Medium', preview: '14px' },
  { id: 'lg', label: 'Large', preview: '17px' },
];

const TEXT_STYLES: {
  id: 'bold' | 'italic' | 'underline';
  label: string;
  keys?: string[];
  Icon: typeof Bold;
}[] = [
  { id: 'bold', label: 'Bold', keys: ['⌘B'], Icon: Bold },
  { id: 'italic', label: 'Italic', keys: ['⌘I'], Icon: Italic },
  { id: 'underline', label: 'Underline', keys: ['⌘U'], Icon: Underline },
];

function ShapeIcon({ shape }: { shape: NodeShape }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2">
      {SHAPE_GLYPHS[shape]}
    </svg>
  );
}

export function SelectionToolbar({
  nodeIds,
  onExpand,
  onOpenEditor,
}: {
  nodeIds: string[];
  onExpand: (nodeId: string) => void;
  onOpenEditor: (nodeId: string) => void;
}) {
  const config = useStore((s) => s.config);
  const nodes = useStore((s) => s.nodes);
  const setShape = useStore((s) => s.setShape);
  const setColor = useStore((s) => s.setColor);
  const cycleStatus = useStore((s) => s.cycleStatus);
  const toggleVariant = useStore((s) => s.toggleVariant);
  const duplicateSelection = useStore((s) => s.duplicateSelection);
  const archiveNodes = useStore((s) => s.archiveNodes);
  const toggleFrameCollapse = useStore((s) => s.toggleFrameCollapse);
  const archiveFrame = useStore((s) => s.archiveFrame);
  const setTextSize = useStore((s) => s.setTextSize);
  const toggleTextStyle = useStore((s) => s.toggleTextStyle);
  const promoteFrame = useStore((s) => s.promoteFrame);
  const wrapSelectionInFrame = useStore((s) => s.wrapSelectionInFrame);
  const [confirmPromote, setConfirmPromote] = useState<string | null>(null);

  if (!nodeIds.length || !config) return null;

  const selected = nodes.filter((n) => nodeIds.includes(n.id));
  const cards = selected.filter(isCard);
  const frames = selected.filter(isFrame);
  const single = selected.length === 1 ? selected[0] : undefined;
  const texts = selected.filter(isText);
  const textsOnly = selected.length > 0 && cards.length === 0 && frames.length === 0;
  const singleText = texts.length === 1 ? texts[0] : undefined;
  const singleCard = single && isCard(single) ? single : undefined;
  const singleFrame = single && isFrame(single) ? single : undefined;

  const swatches = (
    <div className="cg-toolbar__group">
      <ColorSwatches
        colors={config.colors}
        selected={(singleCard ?? singleFrame)?.data.color}
        onPick={(token) => setColor(nodeIds, token)}
        labelPrefix="Colour: "
      />
    </div>
  );

  return (
    <>
      <NodeToolbar nodeId={nodeIds} isVisible position={Position.Top} offset={14}>
        <div className="cg-toolbar pill">
          {singleFrame ? (
            <>
              <Tooltip label={singleFrame.data.collapsed ? 'Expand' : 'Collapse'}>
                <button
                  type="button"
                  className="pill__btn"
                  onClick={() => toggleFrameCollapse(singleFrame.id)}
                  aria-label="Collapse frame"
                >
                  {singleFrame.data.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                </button>
              </Tooltip>
              <span className="pill__sep" />
              {swatches}
              <span className="pill__sep" />
              <Tooltip label="Promote to sub-map">
                <button
                  type="button"
                  className="pill__btn"
                  onClick={() => setConfirmPromote(singleFrame.id)}
                  aria-label="Promote to sub-map"
                >
                  <CornerDownRight size={16} />
                </button>
              </Tooltip>
              {/* Frame and contents in one go — the members come with it (§6.1). */}
              <Tooltip label="Duplicate with contents" keys={['⌘D']}>
                <button
                  type="button"
                  className="pill__btn"
                  onClick={() => void duplicateSelection(nodeIds)}
                  aria-label="Duplicate"
                >
                  <Copy size={16} />
                </button>
              </Tooltip>
              <Tooltip label="Remove frame">
                <button
                  type="button"
                  className="pill__btn cg-toolbar__danger"
                  onClick={() => archiveFrame(singleFrame.id)}
                  aria-label="Remove frame"
                >
                  <Trash2 size={16} />
                </button>
              </Tooltip>
            </>
          ) : textsOnly ? (
            <>
              <div className="cg-toolbar__group">
                {TEXT_SIZES.map((size) => (
                  <Tooltip key={size.id} label={size.label}>
                    <button
                      type="button"
                      className={`pill__btn cg-toolbar__text-size${
                        singleText?.data.size === size.id ? ' is-active' : ''
                      }`}
                      style={{ fontSize: size.preview }}
                      onClick={() => setTextSize(nodeIds, size.id)}
                      aria-label={`${size.label} text`}
                      aria-pressed={singleText?.data.size === size.id}
                    >
                      A
                    </button>
                  </Tooltip>
                ))}
              </div>
              <span className="pill__sep" />

              <div className="cg-toolbar__group">
                {TEXT_STYLES.map(({ id, label, keys, Icon }) => (
                  <Tooltip key={id} label={label} keys={keys}>
                    <button
                      type="button"
                      className={`pill__btn${texts.every((t) => t.data[id]) ? ' is-active' : ''}`}
                      onClick={() => toggleTextStyle(nodeIds, id)}
                      aria-label={label}
                      aria-pressed={texts.every((t) => t.data[id])}
                    >
                      <Icon size={15} />
                    </button>
                  </Tooltip>
                ))}
              </div>

              <span className="pill__sep" />
              <Tooltip label="Delete label" keys={['⌫']}>
                <button
                  type="button"
                  className="pill__btn cg-toolbar__danger"
                  onClick={() => void archiveNodes(nodeIds)}
                  aria-label="Delete label"
                >
                  <Trash2 size={16} />
                </button>
              </Tooltip>
            </>
          ) : (
            <>
              {cards.length > 0 && singleCard?.data.variant !== 'chip' && (
                <>
                  <div className="cg-toolbar__group">
                    {config.shapes.map((shape, index) => (
                      <Tooltip key={shape} label={shape} keys={[String(index + 1)]}>
                        <button
                          type="button"
                          className={`pill__btn${singleCard?.data.shape === shape ? ' is-active' : ''}`}
                          onClick={() => setShape(nodeIds, shape)}
                          aria-label={`Shape: ${shape}`}
                        >
                          <ShapeIcon shape={shape} />
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                  <span className="pill__sep" />
                </>
              )}

              {swatches}
              <span className="pill__sep" />

              {cards.length > 0 && (
                <Tooltip label="Cycle status" keys={['S']}>
                  <button
                    type="button"
                    className="pill__btn cg-toolbar__status"
                    onClick={() => cycleStatus(nodeIds)}
                  >
                    <span
                      className="cg-status-dot"
                      style={{
                        background: `var(${
                          config.statuses.find((s) => s.id === singleCard?.data.status)?.colorToken ??
                          '--status-sketched'
                        })`,
                      }}
                    />
                    {config.statuses.find((s) => s.id === singleCard?.data.status)?.label ?? 'Status'}
                  </button>
                </Tooltip>
              )}

              {cards.length > 0 && (
                <Tooltip label={singleCard?.data.variant === 'chip' ? 'Make card' : 'Make chip'} keys={['C']}>
                  <button
                    type="button"
                    className={`pill__btn${singleCard?.data.variant === 'chip' ? ' is-active' : ''}`}
                    onClick={() => toggleVariant(nodeIds)}
                    aria-label="Toggle chip"
                  >
                    <Tag size={16} />
                  </button>
                </Tooltip>
              )}

              {cards.length > 1 && (
                <Tooltip label="Wrap in frame" keys={['F']}>
                  <button
                    type="button"
                    className="pill__btn"
                    onClick={() => wrapSelectionInFrame()}
                    aria-label="Wrap in frame"
                  >
                    <FrameIcon size={16} />
                  </button>
                </Tooltip>
              )}

              {singleCard && (
                <>
                  <span className="pill__sep" />
                  <Tooltip
                    label={singleCard.data.childBoards?.length ? 'Open sub-board' : 'Expand into a sub-board'}
                    keys={['E']}
                  >
                    <button
                      type="button"
                      className="pill__btn"
                      onClick={() => onExpand(singleCard.id)}
                      aria-label="Expand into a sub-board"
                    >
                      <CornerDownRight size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip label="Open editor" keys={['↵']}>
                    <button
                      type="button"
                      className="pill__btn"
                      onClick={() => onOpenEditor(singleCard.id)}
                      aria-label="Open editor"
                    >
                      <PanelRight size={16} />
                    </button>
                  </Tooltip>
                </>
              )}

              {/* Any selection, not just one card: frames come with their contents (§6.1). */}
              <Tooltip label={cards.length + frames.length > 1 ? 'Duplicate selection' : 'Duplicate'} keys={['⌘D']}>
                <button
                  type="button"
                  className="pill__btn"
                  onClick={() => void duplicateSelection(nodeIds)}
                  aria-label="Duplicate"
                >
                  <Copy size={16} />
                </button>
              </Tooltip>

              <Tooltip label="Archive" keys={['⌫']}>
                <button
                  type="button"
                  className="pill__btn cg-toolbar__danger"
                  onClick={() => void archiveNodes(nodeIds)}
                  aria-label="Archive"
                >
                  <Trash2 size={16} />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </NodeToolbar>

      {confirmPromote && (
        <Modal
          title="Promote frame to sub-map?"
          onClose={() => setConfirmPromote(null)}
          footer={
            <>
              <div className="spacer" />
              <Button onClick={() => setConfirmPromote(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={async () => {
                  const frameId = confirmPromote;
                  setConfirmPromote(null);
                  const childId = await promoteFrame(frameId);
                  if (childId) navigate(routes.board(childId));
                }}
              >
                Promote
              </Button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            The frame's nodes move into a new sub-map — their files move with them — and the frame becomes a
            drill-down node here. Edges crossing the boundary re-point to it.
          </p>
          <p className="muted">
            This restructures files, so <strong>Ctrl+Z will not undo it</strong>. A snapshot of this map is taken
            automatically first; restore it from the map menu if you change your mind.
          </p>
        </Modal>
      )}
    </>
  );
}
