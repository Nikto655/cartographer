import { memo, type CSSProperties } from 'react';
import { Handle, Position, useStore as useRFStore } from '@xyflow/react';
import { useStore } from '@/shared/store';
import type { NodeCardProps } from '@/board-types/types';
import { MIN_DOT } from '../../geometry';
import { SquareSquare } from 'lucide-react';

const SIDES: { position: Position; key: string }[] = [
  { position: Position.Top, key: 'top' },
  { position: Position.Right, key: 'right' },
  { position: Position.Bottom, key: 'bottom' },
  { position: Position.Left, key: 'left' },
];

/*
 * Zoom semantics (§3.1): far out the board is a constellation of dots; labels
 * fade in as you approach and are fully legible from around 70%; the sub-map
 * glyph only appears once you are close enough to act on it.
 */
const LABEL_FROM = 0.45;
const LABEL_FULL = 0.7;
const DETAIL_FROM = 1.05;

/** The graph's only node type so far: a dot sized by degree, label beside it. */
function EntityContentImpl({ data, selected }: NodeCardProps) {
  const zoom = useRFStore((s) => s.transform[2]);
  const config = useStore((s) => s.config);

  const dot = typeof data.dot === 'number' ? data.dot : MIN_DOT;
  const statusToken =
    config?.statuses.find((s) => s.id === data.status)?.colorToken ?? '--status-sketched';
  // The canvas hands down the fill its colour group asked for (§3.2); on its own
  // a dot wears the colour its node was given, status otherwise.
  const fill = (typeof data.fill === 'string' ? data.fill : undefined) ?? data.color ?? statusToken;
  const hollow = data.coverage === 'empty';
  const hasChildren = !!data.childBoards?.length;

  const faded =
    zoom <= LABEL_FROM ? 0 : Math.min(1, (zoom - LABEL_FROM) / (LABEL_FULL - LABEL_FROM));
  const labelOpacity = data.showLabel === false ? 0 : faded;

  const style = {
    ['--entity-fill' as string]: `var(${fill})`,
    width: dot,
    height: dot,
  } as CSSProperties;

  return (
    <div
      className={[
        'cg-entity',
        hollow ? 'cg-entity--hollow' : '',
        hasChildren ? 'cg-entity--parent' : '',
        selected ? 'is-selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      title={data.title}
    >
      {labelOpacity > 0 && (
        <span
          className={`cg-entity__label${zoom >= DETAIL_FROM ? ' cg-entity__label--near' : ''}`}
          style={{ opacity: labelOpacity }}
        >
          {data.title}
          {hasChildren && zoom >= DETAIL_FROM && (
            <span className="cg-entity__glyph" title="Opens a sub-board">
              <SquareSquare size={11} />
            </span>
          )}
        </span>
      )}

      {SIDES.map((side) => (
        <Handle
          key={side.key}
          id={side.key}
          type="source"
          position={side.position}
          className="cg-entity__handle"
        />
      ))}
    </div>
  );
}

export const EntityContent = memo(EntityContentImpl);
