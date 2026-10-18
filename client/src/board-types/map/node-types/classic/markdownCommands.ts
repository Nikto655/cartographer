/**
 * Markdown editing commands for the Notes toolbar (v1.3 §2).
 * Everything writes plain markdown — no proprietary syntax reaches the file.
 */
import type { EditorView } from '@codemirror/view';

function selectionOf(view: EditorView) {
  const range = view.state.selection.main;
  return { from: range.from, to: range.to, text: view.state.sliceDoc(range.from, range.to) };
}

/** Wraps the selection, or inserts a placeholder and selects it. */
export function wrap(view: EditorView, before: string, after = before, placeholder = 'text'): void {
  const { from, to, text } = selectionOf(view);
  const body = text || placeholder;
  const already = text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length;

  const insert = already ? text.slice(before.length, text.length - after.length) : `${before}${body}${after}`;
  const anchor = already ? from : from + before.length;
  const head = anchor + (already ? insert.length : body.length);

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor, head },
    scrollIntoView: true,
  });
  view.focus();
}

/** Toggles a line prefix across every line the selection touches. */
export function togglePrefix(view: EditorView, prefix: string | ((index: number) => string)): void {
  const { state } = view;
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to);

  const lines = [];
  for (let n = first.number; n <= last.number; n += 1) lines.push(state.doc.line(n));

  const marks = lines.map((_, i) => (typeof prefix === 'string' ? prefix : prefix(i)));
  const allMarked = lines.every((line, i) => line.text.trimStart().startsWith(marks[i].trimEnd()));

  const changes = lines.map((line, i) => {
    const mark = marks[i];
    if (allMarked) {
      const trimmed = line.text.replace(/^(\s*)(?:[-*]\s|\d+\.\s|>\s|- \[[ x]\]\s)/, '$1');
      return { from: line.from, to: line.to, insert: trimmed };
    }
    // Replace an existing list/quote marker rather than stacking markers.
    const stripped = line.text.replace(/^(\s*)(?:[-*]\s|\d+\.\s|>\s|- \[[ x]\]\s)/, '$1');
    return { from: line.from, to: line.to, insert: `${mark}${stripped}` };
  });

  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

/** Sets or clears an ATX heading level on the current line. */
export function setHeading(view: EditorView, level: 0 | 1 | 2 | 3): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.from);
  const stripped = line.text.replace(/^#{1,6}\s+/, '');
  const insert = level === 0 ? stripped : `${'#'.repeat(level)} ${stripped}`;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert },
    selection: { anchor: line.from + insert.length },
    scrollIntoView: true,
  });
  view.focus();
}

export function insertBlock(view: EditorView, block: string, cursorOffset?: number): void {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const atLineStart = range.from === line.from;
  const prefix = atLineStart ? '' : '\n';
  const insert = `${prefix}${block}`;

  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + (cursorOffset ?? insert.length) },
    scrollIntoView: true,
  });
  view.focus();
}

export function insertLink(view: EditorView): void {
  const { from, to, text } = selectionOf(view);
  const label = text || 'link text';
  const insert = `[${label}](url)`;
  const urlStart = from + insert.length - 4;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: urlStart, head: urlStart + 3 },
    scrollIntoView: true,
  });
  view.focus();
}

export function insertCodeBlock(view: EditorView): void {
  const { from, to, text } = selectionOf(view);
  const body = text || 'code';
  const insert = `\`\`\`ts\n${body}\n\`\`\`\n`;
  const anchor = from + 6;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor, head: anchor + body.length },
    scrollIntoView: true,
  });
  view.focus();
}

export const commands = {
  bold: (view: EditorView) => wrap(view, '**', '**', 'bold'),
  italic: (view: EditorView) => wrap(view, '_', '_', 'italic'),
  code: (view: EditorView) => wrap(view, '`', '`', 'code'),
  heading: (view: EditorView, level: 0 | 1 | 2 | 3) => setHeading(view, level),
  bullet: (view: EditorView) => togglePrefix(view, '- '),
  numbered: (view: EditorView) => togglePrefix(view, (i) => `${i + 1}. `),
  task: (view: EditorView) => togglePrefix(view, '- [ ] '),
  quote: (view: EditorView) => togglePrefix(view, '> '),
  codeBlock: insertCodeBlock,
  link: insertLink,
  divider: (view: EditorView) => insertBlock(view, '\n---\n\n'),
};
