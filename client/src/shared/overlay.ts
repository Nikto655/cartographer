import { useEffect } from 'react';

/*
 * "An overlay owns the keyboard." The canvas shortcuts bind on `window` and used
 * to stand down only for a text field — and the Export dialog, Share dialog, the
 * promote-frame confirm and the walkthrough focus none. Select three nodes, press
 * ⌘E, press Backspace to correct something, and the three nodes were archived
 * behind the dialog.
 *
 * A counter, not a flag: a confirm can open over a dialog, and closing the inner
 * one must not hand the keys back while the outer one is still up.
 */
let open = 0;

/*
 * Remember which keystrokes began while an overlay was up. A dialog that closes
 * on a key unmounts *during* that key's dispatch — React flushes the update in a
 * microtask between listeners — so by the time a later `window` listener runs,
 * the counter is already back to zero and the same Enter or Escape would land on
 * the canvas too. Capture on `window` runs before anything else sees the event.
 */
const claimed = new WeakSet<Event>();
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (event) => {
      if (open > 0) claimed.add(event);
    },
    true,
  );
}

/** True while a dialog, the palette or the walkthrough is up — or was when `event` began. */
export function overlayOwnsKeyboard(event?: Event): boolean {
  return open > 0 || (event !== undefined && claimed.has(event));
}

/** Registers the calling component as an overlay for as long as it is mounted (and `active`). */
export function useOverlay(active = true): void {
  useEffect(() => {
    if (!active) return;
    open += 1;
    return () => {
      open -= 1;
    };
  }, [active]);
}
