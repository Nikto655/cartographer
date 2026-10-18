import type { NodeColorDef } from '@cartograph/shared';

/**
 * The palette row. One implementation, used by the node panel in both worlds and
 * by the canvas selection toolbar — it existed three times and the copies drifted,
 * which is how a stale id survived in one of them.
 *
 * A node with no colour renders transparent, so an unset value shows the
 * Transparent swatch as chosen rather than leaving the row looking unanswered.
 */
export function ColorSwatches({
  colors,
  selected,
  onPick,
  labelPrefix = '',
}: {
  colors: NodeColorDef[];
  /** The current value, or undefined when unset (i.e. auto). */
  selected: string | undefined;
  onPick: (token: string | undefined) => void;
  labelPrefix?: string;
}) {
  return (
    <div className="cg-settings__swatches">
      {colors.map((color) => {
        const patterned = color.id === 'clear';
        return (
          <button
            key={color.id}
            type="button"
            className={`cg-swatch cg-swatch--${color.id}${
              // Unset renders as transparent, so it is transparent that reads as chosen.
              (selected ?? '--node-clear') === color.token ? ' is-active' : ''
            }`}
            /*
             * Hues are painted inline; auto and clear are left to CSS, which
             * draws a pattern for them. Note `backgroundColor`, not the
             * `background` shorthand — the shorthand resets `background-image`,
             * which silently erased the pattern and made two swatches identical.
             */
            style={patterned ? undefined : { backgroundColor: `var(${color.token})` }}
            onClick={() => onPick(color.token)}
            aria-label={`${labelPrefix}${color.label}`}
            title={color.label}
          />
        );
      })}
    </div>
  );
}
