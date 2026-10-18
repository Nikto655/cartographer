/**
 * The `[[` popover (v1.5 §4.1) — core: every world's notes editor writes links
 * the same way. What lands in the file is plain `[[Title]]` text, no ids and no
 * metadata, so a note stays readable anywhere.
 */
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { boardNodeTitles, boardSubBoardTitles, otherBoardTitles } from '@/shared/links';

/** An unclosed `[[` and whatever has been typed since. */
const OPEN_LINK = /\[\[[^[\]\n]*/;
/** What stays a valid query once the popover is open — anything but a bracket. */
const TYPED_TITLE = /^[^[\]\n]*$/;

/*
 * Two labelled groups, nodes above sub-boards. `rank` is what holds that order
 * whatever the fuzzy match scores, so the list a person learns the shape of does
 * not reshuffle as they type — and the headings are what make a board target
 * legible as a different kind of thing rather than a node with an odd name.
 */
const NODE_SECTION = { name: 'Nodes', rank: 1 };
const SUB_BOARD_SECTION = { name: 'Sub-boards', rank: 2 };
const BOARD_SECTION = { name: 'Boards', rank: 3 };

function completeWikiLink(context: CompletionContext): CompletionResult | null {
  const open = context.matchBefore(OPEN_LINK);
  if (!open) return null;

  const options: Completion[] = boardNodeTitles().map((title) => ({
    label: title,
    type: 'text',
    section: NODE_SECTION,
    // The brackets are already typed; completing closes them.
    apply: `${title}]]`,
  }));
  /*
   * A board whose name something above already claims is left out. The brackets
   * carry a title and nothing else, so two things with one name cannot both be
   * offered — the first list to claim it is the one the link will resolve to,
   * and that is the honest entry. This is the only place the collision shows.
   */
  const claimed = new Set(options.map((option) => option.label.trim().toLowerCase()));
  const offer = (title: string, section: { name: string; rank: number }) => {
    const key = title.trim().toLowerCase();
    if (claimed.has(key)) return;
    claimed.add(key);
    options.push({ label: title, type: 'text', section, apply: `${title}]]` });
  };
  for (const title of boardSubBoardTitles()) offer(title, SUB_BOARD_SECTION);
  for (const title of otherBoardTitles()) offer(title, BOARD_SECTION);
  if (!options.length) return null;

  // Completion starts *after* the `[[`, so what the user typed filters titles
  // rather than being matched against them.
  return { from: open.from + 2, options, validFor: TYPED_TITLE };
}

/** Titles are read at completion time, so the extension itself never goes stale. */
export function wikiLinkAutocomplete(): Extension {
  return autocompletion({
    override: [completeWikiLink],
    icons: false,
    activateOnTyping: true,
  });
}
