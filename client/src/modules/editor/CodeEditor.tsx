import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  tooltips,
  type KeyBinding,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { wikiLinkAutocomplete } from './wikiLink';

const cartographTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--text-hi)',
      backgroundColor: 'transparent',
      height: '100%',
      fontSize: 'var(--type-prose)',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-sans)',
      lineHeight: 'var(--leading-prose)',
      overflow: 'auto',
    },
    '.cm-content': { caretColor: 'var(--accent)', padding: 'var(--sp-3) 0' },
    '.cm-line': { padding: '0 var(--sp-2)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--accent-dim)',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--text-low)',
      border: 'none',
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-placeholder': { color: 'var(--text-low)' },
  },
  { dark: false },
);

const cartographHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--text-hi)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--text-hi)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--accent)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', color: 'var(--status-built)' },
  { tag: tags.list, color: 'var(--text-mid)' },
  { tag: tags.quote, color: 'var(--text-mid)', fontStyle: 'italic' },
  { tag: [tags.propertyName], color: 'var(--accent)' },
  { tag: [tags.string], color: 'var(--status-built)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--status-documented)' },
  { tag: [tags.keyword], color: 'var(--status-documented)' },
  { tag: [tags.comment], color: 'var(--text-low)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.separator], color: 'var(--text-low)' },
]);

export type EditorLanguage = 'markdown' | 'json' | 'code' | 'plain';

function languageExtension(language: EditorLanguage): Extension[] {
  switch (language) {
    case 'markdown':
      return [markdown()];
    case 'json':
      return [json()];
    case 'code':
      return [javascript({ typescript: true })];
    default:
      return [];
  }
}

export function CodeEditor({
  value,
  onChange,
  language = 'markdown',
  mono = false,
  gutter = false,
  hint,
  minHeight,
  shortcuts,
  linkAutocomplete = false,
  readOnly = false,
  onReady,
}: {
  value: string;
  onChange: (next: string) => void;
  language?: EditorLanguage;
  mono?: boolean;
  gutter?: boolean;
  hint?: string;
  minHeight?: number;
  /** Extra key bindings — they take precedence over the defaults. */
  shortcuts?: KeyBinding[];
  /** Opt in to the `[[` node-link popover (v1.5 §4.1) — notes editors do. */
  linkAutocomplete?: boolean;
  /**
   * Viewing, not editing (v1.6 §5). CodeMirror's own read-only state rather than
   * a disabled wrapper: the text stays selectable and copyable, the caret and
   * every editing key go.
   */
  readOnly?: boolean;
  /** Hands the live view to the caller (the formatting toolbar needs it). */
  onReady?: (view: EditorView | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    if (!host.current) return;

    const extensions: Extension[] = [
      history(),
      keymap.of([...(shortcutsRef.current ?? []), ...defaultKeymap, ...historyKeymap]),
      highlightSpecialChars(),
      EditorView.lineWrapping,
      cartographTheme,
      syntaxHighlighting(cartographHighlight),
      ...languageExtension(language),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) latest.current(update.state.doc.toString());
      }),
    ];
    if (readOnly) extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
    if (linkAutocomplete) {
      // Absolute, not CodeMirror's default fixed: the editor sits inside the
      // frosted panel, whose backdrop-filter makes it the containing block for
      // fixed-position descendants. CodeMirror tries to detect that and fall
      // back by itself, but the detection reads offsetParent, and engines
      // disagree there — in some Chromium builds it misses and the popover
      // lands a panel-offset to the right, off screen.
      extensions.push(wikiLinkAutocomplete(), tooltips({ position: 'absolute' }));
    }
    if (gutter) extensions.push(lineNumbers());
    if (hint) extensions.push(placeholder(hint));
    if (mono) {
      extensions.push(
        EditorView.theme({
          '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '12.5px', lineHeight: '1.55' },
        }),
      );
    }

    const instance = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host.current,
    });
    view.current = instance;
    readyRef.current?.(instance);
    return () => {
      instance.destroy();
      view.current = null;
      readyRef.current?.(null);
    };
    // Language/appearance are fixed per mounted editor instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, mono, gutter, hint, linkAutocomplete, readOnly]);

  // External updates (switching node, reload after save) replace the doc.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div className="cg-cm" ref={host} style={minHeight ? { minHeight } : undefined} />;
}
