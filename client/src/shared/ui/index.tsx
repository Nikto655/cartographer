import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StatusDef } from '@cartograph/shared';
import { useDismiss } from '../hooks';
import { useOverlay } from '../overlay';
import './ui.css';

export { Logo } from './Logo';

// ---- Button ----
type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

export function Button({
  variant = 'default',
  icon = false,
  active = false,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: boolean;
  active?: boolean;
}) {
  const classes = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    icon ? 'btn--icon' : '',
    active ? 'btn--active' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <button type="button" className={classes} {...rest} />;
}

// ---- Chip ----
export function Chip({
  color,
  onClick,
  title,
  children,
}: {
  color?: string;
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      className={`chip${onClick ? ' chip--button' : ''}`}
      onClick={onClick}
      title={title}
      {...(onClick ? { type: 'button' as const } : {})}
    >
      {color && <span className="chip__dot" style={{ color: `var(${color})` }} />}
      {children}
    </Tag>
  );
}

// ---- Kbd ----
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

// ---- Tooltip ----
export function Tooltip({
  label,
  keys,
  children,
}: {
  label: string;
  keys?: string[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="tooltip-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span className="tooltip" role="tooltip">
          {label}
          {keys?.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      )}
    </span>
  );
}

// ---- Tabs ----
export interface TabDef {
  id: string;
  label: string;
  dot?: boolean;
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={`tab${tab.id === active ? ' tab--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.dot && <span className="tab__dot" />}
        </button>
      ))}
    </div>
  );
}

// ---- Status strip (the signature element, §9) ----
export function StatusStrip({
  counts,
  statuses,
  height = 3,
}: {
  counts: Record<string, number>;
  statuses: StatusDef[];
  height?: number;
}) {
  const total = statuses.reduce((sum, s) => sum + (counts[s.id] ?? 0), 0);
  return (
    <div className="status-strip" style={{ height }} aria-hidden={total === 0}>
      {total > 0 &&
        statuses.map((status) => {
          const value = counts[status.id] ?? 0;
          if (!value) return null;
          return (
            <span
              key={status.id}
              className="status-strip__seg"
              style={{ flexGrow: value, background: `var(${status.colorToken})` }}
              title={`${status.label}: ${value}`}
            />
          );
        })}
    </div>
  );
}

// ---- Menu (popover) ----
export function Menu({
  anchor,
  onClose,
  children,
}: {
  anchor: { x: number; y: number };
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  // A menu owns the keyboard as a dialog does: Backspace with a context menu up
  // archived the selection the menu was opened on.
  useOverlay();
  const [pos, setPos] = useState(anchor);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(anchor.x, window.innerWidth - rect.width - 8);
    const y = Math.min(anchor.y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [anchor.x, anchor.y]);

  /*
   * Through the body: a `position: fixed` popover is measured against the
   * nearest filtered or transformed ancestor, and this app has several (the
   * frosted panel, the chrome pills). Anchors are viewport coordinates, so the
   * menu has to hang off the viewport itself to land where it was asked for.
   */
  return createPortal(
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y, position: 'fixed' }} role="menu">
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  onClick,
  danger = false,
  keys,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  keys?: string[];
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu__item${danger ? ' menu__item--danger' : ''}`}
      onClick={onClick}
    >
      <span>{children}</span>
      {keys && (
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
          {keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      )}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu__sep" />;
}

// ---- Modal ----
export function Modal({
  title,
  onClose,
  footer,
  children,
  width,
}: {
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
}) {
  // While a dialog is up the canvas shortcuts stand down — a Backspace meant for
  // the dialog archived the selection behind it.
  useOverlay();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Same reason as the menu: a dialog covers the window, not whichever frosted
  // surface happened to render it.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width } : undefined} role="dialog" aria-label={title}>
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <div className="spacer" />
          <Button icon variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---- Inline rename ----
export function InlineEdit({
  value,
  onCommit,
  className = '',
  ariaLabel,
  editing: controlled,
  onEditingChange,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  ariaLabel?: string;
  /*
   * Pass this and the parent owns activation: the closed label stops opening on
   * click, and something else — a menu item, a shortcut — decides when to edit.
   * Left out, it behaves as it always has and opens on its own click.
   *
   * The dashboard needs the first: a board card's title sits inside a card that
   * navigates, so clicking the name to *read* the board opened a rename instead.
   * The folder breadcrumb keeps the second, where the name is not a target.
   */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const parentOwns = controlled !== undefined;
  const editing = parentOwns ? controlled : own;
  const setEditing = (next: boolean) => {
    if (!parentOwns) setOwn(next);
    onEditingChange?.(next);
  };
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);

  /*
   * Focus and select when the editor opens, so typing replaces the name rather
   * than appending to it. Renaming is a deliberate act — a menu item — and the
   * common intent is a new name, not an edit three characters in.
   *
   * An effect rather than `autoFocus` + `onFocus`: `autoFocus` focuses during
   * the commit, before React has the handler attached, so the focus event that
   * would have carried the `select()` never reaches it. Measured — the caret
   * landed at the end of the name and the first thing typed was appended.
   */
  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editing]);

  if (!editing) {
    // Parent-controlled: a plain label. No role, no tabIndex, no "click to
    // rename" — offering an affordance the click no longer honours is worse
    // than offering none.
    if (parentOwns) return <span className={className}>{value}</span>;
    return (
      <span
        className={className}
        role="button"
        tabIndex={0}
        title="Click to rename"
        /*
         * Stop here. These live inside cards that navigate on click, so letting
         * the event bubble opened the board and unmounted the input we just
         * mounted — which made renaming from the dashboard impossible by mouse.
         */
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {value}
      </span>
    );
  }

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };

  return (
    <input
      className={`input ${className}`}
      aria-label={ariaLabel ?? 'Rename'}
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      /*
       * The same reason the closed span stops its events, and the half that was
       * missing: while editing, this input sits inside a card that navigates on
       * click and starts a selection on pointer-down. Clicking into your own
       * text to move the cursor opened the board — the rename was reachable but
       * only if you typed it in one pass and never touched the caret.
       */
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
        e.stopPropagation();
      }}
    />
  );
}
