import type { AppConfig } from '@cartograph/shared';
import { DEFAULT_CONFIG } from '@cartograph/shared';
import { badRequest } from './errors.js';
import { readJson, systemPaths } from './storage.js';

/** Merged defaults + /data/config.json (config over code, principle 5). */
export async function getConfig(): Promise<AppConfig> {
  const user = await readJson<Partial<AppConfig>>(systemPaths.configFile());
  if (!user) return DEFAULT_CONFIG;
  return {
    statuses: Array.isArray(user.statuses) && user.statuses.length ? user.statuses : DEFAULT_CONFIG.statuses,
    shapes: Array.isArray(user.shapes) && user.shapes.length ? user.shapes : DEFAULT_CONFIG.shapes,
    colors: Array.isArray(user.colors) && user.colors.length ? user.colors : DEFAULT_CONFIG.colors,
    theme: user.theme === 'light' ? 'light' : DEFAULT_CONFIG.theme,
  };
}

export async function statusIds(): Promise<string[]> {
  const config = await getConfig();
  return config.statuses.map((s) => s.id);
}

/**
 * A status has to be one this deployment actually defines.
 *
 * The vocabulary lives in `config.json` and is per-deployment, so "documented"
 * is a default rather than a guarantee. Nothing checked this before, which was
 * harmless while the only writer was a client that had just read the list — but
 * a caller guessing "in-progress" had it written straight into the frontmatter,
 * where the card then rendered as *sketched* (`CardContent` falls back) and the
 * node vanished from every status strip (`StatusStrip` totals known ids only).
 * Silently wrong in two places is worse than refused in one.
 *
 * Only ever applied to a status being *set*. A node still carrying an id a
 * later config removed keeps it, and reads fine.
 */
/**
 * A colour, given as either the palette id a person would say ("sky") or the
 * token that is actually stored ("--node-sky"). Both are accepted because the
 * two names for one colour is an implementation detail nobody outside should
 * have to hold; the token is what comes back, because that is what `board.json`
 * carries and what the canvas resolves against the theme.
 *
 * `null` means "no colour", which is *not* the same as the `clear` swatch:
 * unset lets coverage decide the fill — white once notes exist, transparent
 * while empty — and `clear` overrides that to transparent for good. Both are
 * real choices, so both stay expressible.
 */
export async function resolveColor(value: string | null | undefined): Promise<string | undefined> {
  if (value === null || value === undefined) return undefined;
  const config = await getConfig();
  const match = config.colors.find((c) => c.token === value || c.id === value);
  if (!match) {
    throw badRequest(
      `Unknown colour “${value}”. This deployment defines: ${config.colors
        .map((c) => `${c.id} (${c.token})`)
        .join(', ')}.`,
    );
  }
  return match.token;
}

export async function assertKnownShape(shape: string): Promise<string> {
  const config = await getConfig();
  if (!config.shapes.includes(shape as AppConfig['shapes'][number])) {
    throw badRequest(`Unknown shape “${shape}”. This deployment defines: ${config.shapes.join(', ')}.`);
  }
  return shape;
}

export async function assertKnownStatus(status: string): Promise<string> {
  const ids = await statusIds();
  if (!ids.includes(status)) {
    throw badRequest(
      `Unknown status “${status}”. This deployment defines: ${ids.join(', ')}.`,
    );
  }
  return status;
}
