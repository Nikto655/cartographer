import { useCallback, useEffect, useRef, useState } from 'react';

/** Persisted UI preferences (§9.5: divider, minimap, last board). */
export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage full or blocked — preference is not worth an error */
      }
    },
    [key],
  );

  return [value, set];
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
): [(...args: A) => void, () => void] {
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<(() => void) | null>(null);
  const latest = useRef(fn);
  latest.current = fn;

  const run = useCallback(() => {
    const job = pending.current;
    pending.current = null;
    job?.();
  }, []);

  /** Runs the pending call now. Named for what it does — it used to cancel. */
  const flush = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    run();
  }, [run]);

  // On unmount, send what was typed rather than dropping it: closing the panel
  // mid-sentence used to discard the last <delay> ms of work.
  useEffect(() => flush, [flush]);

  const call = useCallback(
    (...args: A) => {
      /*
       * Bind the callback *now*, not when the timer fires. `latest` tracks the
       * newest render, and the panel may be pointing at a different node by
       * then — firing the fresh closure with the old arguments wrote one node's
       * body into another node's file.
       */
      const job = latest.current;
      pending.current = () => job(...args);
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        run();
      }, delay);
    },
    [delay, run],
  );

  return [call, flush];
}

/** Closes popovers on outside click / Escape. */
export function useDismiss(ref: React.RefObject<HTMLElement | null>, onDismiss: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, onDismiss, active]);
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** True while focus sits in a text surface — keyboard shortcuts stand down. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.closest?.('.cm-editor');
}
