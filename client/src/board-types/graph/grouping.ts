/**
 * Colour groups (v1.5 §3.2). A graph has no frames and no chips, so the only
 * grouping it can offer is the one already written into the frontmatter: a
 * node's tags, its status, or the palette colour it was given. Nothing new to
 * author — the dots just start saying what the files already say.
 */
import type { AppConfig, NodeColorDef, StatusDef } from '@cartograph/shared';
import type { CardNode } from '@/shared/store';

export type ColorGroup = 'color' | 'status' | 'tag';

export const COLOR_GROUPS: { id: ColorGroup; label: string }[] = [
  { id: 'color', label: 'Colour' },
  { id: 'status', label: 'Status' },
  { id: 'tag', label: 'Tag' },
];

/** What the panel prints beside the swatches so a colour can be read back. */
export interface GroupKey {
  label: string;
  token: string;
}

/** Grey means "no answer to this question" — reserved, never handed to a group. */
const UNGROUPED_TOKEN = '--node-slate';

/**
 * The order tags are handed colours in. The palette is authored as a ramp —
 * neighbouring entries are neighbouring hues — which is the worst possible order
 * here: two tags made at the same time would come out two shades of the same
 * blue. Walking it by hue distance instead means the first colours a board uses
 * are as far apart as this palette goes. Tokens only; the hex stays in tokens.css.
 */
const SEPARATED_ORDER = [
  '--node-sky',
  '--node-peach',
  '--node-mint',
  '--node-blush',
  '--node-lemon',
  '--node-lilac',
  '--node-aqua',
];

/** Paper is the canvas colour: as a dot it would be a hole, so tags skip it too. */
const tagPalette = (colors: NodeColorDef[]): string[] => {
  const usable = colors
    .map((color) => color.token)
    .filter((token) => token !== '--node-paper' && token !== UNGROUPED_TOKEN);
  // Configured colours we know are sorted for separation first, the rest follow
  // in their own order — a custom palette still works, just unsorted.
  const known = SEPARATED_ORDER.filter((token) => usable.includes(token));
  const extra = usable.filter((token) => !SEPARATED_ORDER.includes(token));
  const ordered = [...known, ...extra];
  return ordered.length ? ordered : [UNGROUPED_TOKEN];
};

const statusToken = (statuses: StatusDef[], status: string): string =>
  statuses.find((s) => s.id === status)?.colorToken ?? '--status-sketched';

/**
 * Every dot's fill token, plus the key to show for it. Tags are assigned colours
 * by their sorted order on the board rather than by hash, so the same board
 * always reads the same way and neighbouring tags never collide.
 */
export function groupColors(
  cards: readonly CardNode[],
  group: ColorGroup,
  config: AppConfig | null,
): { fills: Map<string, string>; keys: GroupKey[] } {
  const statuses = config?.statuses ?? [];
  const fills = new Map<string, string>();

  if (group === 'status') {
    for (const card of cards) fills.set(card.id, statusToken(statuses, card.data.status));
    const present = new Set(cards.map((card) => card.data.status));
    return {
      fills,
      keys: statuses
        .filter((status) => present.has(status.id))
        .map((status) => ({ label: status.label, token: status.colorToken })),
    };
  }

  if (group === 'tag') {
    const palette = tagPalette(config?.colors ?? []);
    const tags = [...new Set(cards.flatMap((card) => card.data.tags ?? []))].sort();
    const token = new Map(tags.map((tag, index) => [tag, palette[index % palette.length]]));
    let untagged = false;
    for (const card of cards) {
      const first = card.data.tags?.[0];
      if (first) fills.set(card.id, token.get(first) ?? UNGROUPED_TOKEN);
      else {
        fills.set(card.id, UNGROUPED_TOKEN);
        untagged = true;
      }
    }
    const keys = tags.map((tag) => ({ label: tag, token: token.get(tag) ?? UNGROUPED_TOKEN }));
    if (untagged) keys.push({ label: 'untagged', token: UNGROUPED_TOKEN });
    return { fills, keys };
  }

  // 'color': the colour the node was given, falling back to its status — what a
  // dot has always worn, kept as the default so nothing changes unasked.
  for (const card of cards) {
    fills.set(card.id, card.data.color ?? statusToken(statuses, card.data.status));
  }
  const used = new Set(cards.map((card) => card.data.color).filter(Boolean) as string[]);
  return {
    fills,
    keys: (config?.colors ?? [])
      .filter((color) => used.has(color.token))
      .map((color) => ({ label: color.label, token: color.token })),
  };
}
