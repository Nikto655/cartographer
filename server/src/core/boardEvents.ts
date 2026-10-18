/**
 * When a board's identity changes, things outside the board files have to be
 * told. `board.json` and the directory name are the board's identity, and
 * `modules/boards` owns them — but the `shares` table keys on that same id, and
 * `boards` cannot import `shares` (the dependency runs the other way).
 *
 * So boards announces here and interested modules listen, wired at startup by
 * the composition root. Core depends on nothing, so nobody gains a cycle.
 *
 * This matters for correctness, not tidiness: a board id is a slug, and slugs
 * are both mutable and reusable. A share row left pointing at a freed slug is
 * re-granted to whoever takes that slug next.
 */
export interface BoardIdentityChange {
  userId: string;
  oldId: string;
  /** The board's new id, or null when it no longer exists (archived). */
  newId: string | null;
}

type Listener = (change: BoardIdentityChange) => void;

const listeners = new Set<Listener>();

/**
 * A board's *contents* changed — someone saved, or an agent wrote over MCP.
 *
 * Separate from the identity event above because the two answer different
 * questions and have different audiences: identity is a correctness concern for
 * the shares table, this is a liveness concern for anyone looking at the board
 * right now. Carries no payload beyond who and which, deliberately — a listener
 * that wants the new state reads it, so there is exactly one description of a
 * board and it is the files.
 */
export interface BoardChange {
  userId: string;
  boardId: string;
}

type ChangeListener = (change: BoardChange) => void;

const changeListeners = new Set<ChangeListener>();

/** Returns its own unsubscribe — these come and go with every open board. */
export function onBoardChange(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/**
 * Never throws into the caller. This fires from inside `writeBoardFile`, after
 * the bytes are on disk — a listener blowing up must not unwind a write that
 * has already happened, or the file and the caller would disagree about whether
 * it did.
 */
export function emitBoardChange(change: BoardChange): void {
  for (const listener of changeListeners) {
    try {
      listener(change);
    } catch {
      // A dead connection is the normal case; nothing here is worth failing for.
    }
  }
}

/**
 * Returns its own unsubscribe, like `onBoardChange` above. The long-lived
 * listeners wired at startup ignore it; a listener that comes and goes with an
 * open connection must not, or every stream ever opened stays in this set.
 */
export function onBoardIdentityChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Listeners run synchronously and must not throw: a failure here would abort a
 * rename that has already moved files on disk. A listener that cannot do its
 * job should handle that itself rather than unwinding the caller.
 */
export function emitBoardIdentityChange(change: BoardIdentityChange): void {
  for (const listener of listeners) listener(change);
}
