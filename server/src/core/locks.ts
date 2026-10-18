/**
 * Serializes work that shares one key — in practice, one board's `board.json`.
 *
 * Every board mutation is read-modify-write: load the file, change it in memory,
 * write it back. Fastify serves requests concurrently, so two of them overlap
 * happily and the later write wins wholesale. The client makes this easy to hit,
 * because it runs two independent autosave timers (graph 1000 ms, body 800 ms):
 * drag a node while typing in its notes and the body save can read the file
 * before the drag lands and write its stale copy after, silently undoing it.
 *
 * "Files are the database" gives us durability and an atomic swap, but not the
 * serialized writes a database would also provide. This is that missing half.
 *
 * Single process by design: the server is one instance over one volume. If it
 * ever runs as several, this becomes a lock on the filesystem instead.
 */
const tails = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, job: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  // Run whether or not the predecessor succeeded — one failed request must not
  // wedge the queue behind it.
  const run = previous.then(job, job);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, settled);
  void settled.then(() => {
    // Only the tail clears the entry, so a queue that is still busy survives.
    if (tails.get(key) === settled) tails.delete(key);
  });
  return run;
}

/** How many keys are currently held. Exposed for assertions about leaks. */
export function heldLockCount(): number {
  return tails.size;
}
