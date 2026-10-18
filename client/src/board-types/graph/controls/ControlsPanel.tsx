import { Sliders, X } from 'lucide-react';
import { FORCE_RANGE } from '../simulation';
import { COLOR_GROUPS, type ColorGroup, type GroupKey } from '../grouping';
import type { GraphControls } from './state';
import './controls.css';

/**
 * The graph's own chrome (§3.2): the physics, the layers, and what the colours
 * mean — collapsed to a single pill until asked for, in the same frosted
 * furniture as the rest of the app.
 */
export function ControlsPanel({
  controls,
  onChange,
  keys,
  counts,
}: {
  controls: GraphControls;
  onChange: (patch: Partial<GraphControls>) => void;
  /** Legend for the current colour group — nothing to say when it is empty. */
  keys: GroupKey[];
  counts: { drawn: number; derived: number; ghosts: number };
}) {
  if (controls.collapsed) {
    return (
      <button
        type="button"
        className="graph-controls__open"
        onClick={() => onChange({ collapsed: false })}
        title="Graph controls"
        aria-label="Open graph controls"
      >
        <Sliders size={14} />
      </button>
    );
  }

  return (
    <section className="graph-controls" aria-label="Graph controls">
      <header className="graph-controls__head">
        <span className="label">Graph</span>
        <div className="spacer" />
        <button
          type="button"
          className="graph-controls__close"
          onClick={() => onChange({ collapsed: true })}
          aria-label="Close graph controls"
        >
          <X size={13} />
        </button>
      </header>

      <div className="graph-controls__group">
        <Slider
          label="Repel"
          value={controls.repel}
          range={FORCE_RANGE.repel}
          onChange={(repel) => onChange({ repel })}
          format={(value) => String(Math.round(value))}
        />
        <Slider
          label="Link distance"
          value={controls.linkDistance}
          range={FORCE_RANGE.linkDistance}
          onChange={(linkDistance) => onChange({ linkDistance })}
          format={(value) => String(Math.round(value))}
        />
        <Slider
          label="Centre"
          value={controls.centre}
          range={FORCE_RANGE.centre}
          onChange={(centre) => onChange({ centre })}
          format={(value) => value.toFixed(3)}
        />
      </div>

      <div className="graph-controls__group">
        <Toggle
          label="Labels"
          on={controls.labels}
          onToggle={() => onChange({ labels: !controls.labels })}
        />
        <Toggle
          label="Orphans"
          on={controls.orphans}
          onToggle={() => onChange({ orphans: !controls.orphans })}
        />
        <Toggle
          label="Drawn edges"
          count={counts.drawn}
          on={controls.drawnEdges}
          onToggle={() => onChange({ drawnEdges: !controls.drawnEdges })}
        />
        <Toggle
          label="Derived links"
          count={counts.derived}
          on={controls.derivedLinks}
          onToggle={() => onChange({ derivedLinks: !controls.derivedLinks })}
        />
        <Toggle
          label="Edge labels"
          on={controls.edgeLabels}
          onToggle={() => onChange({ edgeLabels: !controls.edgeLabels })}
        />
      </div>

      <div className="graph-controls__group">
        <input
          className="input graph-controls__filter"
          type="search"
          placeholder="Filter…"
          aria-label="Filter entities"
          value={controls.filter}
          onChange={(event) => onChange({ filter: event.target.value })}
          onKeyDown={(event) => event.stopPropagation()}
        />
      </div>

      <div className="graph-controls__group">
        <span className="label">Colour by</span>
        <div className="graph-controls__segments" role="group" aria-label="Colour groups">
          {COLOR_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`graph-controls__segment${
                controls.group === group.id ? ' is-on' : ''
              }`}
              aria-pressed={controls.group === group.id}
              onClick={() => onChange({ group: group.id as ColorGroup })}
            >
              {group.label}
            </button>
          ))}
        </div>
        {keys.length > 0 && (
          <ul className="graph-controls__legend">
            {keys.map((key) => (
              <li key={`${key.label}-${key.token}`} className="graph-controls__key">
                <span
                  className="graph-controls__swatch"
                  style={{ background: `var(${key.token})` }}
                />
                {key.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {counts.ghosts > 0 && (
        <p className="graph-controls__note muted">
          {counts.ghosts === 1 ? '1 mention' : `${counts.ghosts} mentions`} with nothing behind
          {counts.ghosts === 1 ? ' it' : ' them'} — click a dashed dot to make it real.
        </p>
      )}
    </section>
  );
}

function Slider({
  label,
  value,
  range,
  onChange,
  format,
}: {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  onChange: (value: number) => void;
  format: (value: number) => string;
}) {
  return (
    <label className="graph-controls__slider">
      <span className="graph-controls__slider-head">
        {label}
        <span className="mono">{format(value)}</span>
      </span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Toggle({
  label,
  on,
  onToggle,
  count,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      className="graph-controls__toggle"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
    >
      <span className={`graph-controls__switch${on ? ' is-on' : ''}`} aria-hidden />
      {label}
      {count !== undefined && <span className="graph-controls__count mono">{count}</span>}
    </button>
  );
}
