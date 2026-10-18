/**
 * Login throttle, per-username *and* per-IP (§2). In-process on purpose: the
 * server is single-instance and stateless about everything else, so a Map is
 * the whole implementation — no store to run, nothing to keep in sync.
 */
import { HttpError } from '../../core/errors.js';

const WINDOW_MS = 60_000;
const LIMIT = 10;
/** Keeps a stream of one-off usernames from growing the map without bound. */
const SWEEP_AT = 2_000;

const hits = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const kept = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (kept.length) hits.set(key, kept);
  else hits.delete(key);
  return kept;
}

function sweep(now: number): void {
  if (hits.size < SWEEP_AT) return;
  for (const key of [...hits.keys()]) recent(key, now);
}

/** Counts the attempt and throws 429 once either bucket is over its allowance. */
export function checkLoginRate(username: string, ip: string): void {
  const now = Date.now();
  sweep(now);
  const keys = [`u:${username}`, `i:${ip}`];
  const over = keys.some((key) => recent(key, now).length >= LIMIT);
  for (const key of keys) hits.set(key, [...recent(key, now), now]);
  if (over) {
    throw new HttpError(
      429,
      'rate_limited',
      'Too many sign-in attempts. Wait a minute and try again.',
    );
  }
}

/** A successful sign-in clears the slate, so one fat-fingered morning costs nothing. */
export function clearLoginRate(username: string, _ip: string): void {
  // Only the username bucket clears. Dropping the IP bucket too would let
  // anyone with one valid account reset their own throttle at will and spray
  // guesses across other usernames indefinitely.
  hits.delete(`u:${username}`);
}
