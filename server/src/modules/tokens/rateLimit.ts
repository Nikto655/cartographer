/**
 * Per-token ceiling (v1.7 §2.3). Generous on purpose: this is not a security
 * control — the token already scopes what its holder can reach — it is what
 * keeps an agent stuck in a loop from hammering the volume. In-process for the
 * same reason the login throttle is: single instance, so a Map is the whole
 * implementation.
 */
import { HttpError } from '../../core/errors.js';

const WINDOW_MS = 60_000;
const LIMIT = 120;
/** Keeps revoked and long-dead tokens from growing the map without bound. */
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

/** Counts the call and throws 429 once the token is over its allowance. */
export function checkTokenRate(tokenId: string): void {
  const now = Date.now();
  sweep(now);
  const window = recent(tokenId, now);
  hits.set(tokenId, [...window, now]);
  if (window.length >= LIMIT) {
    throw new HttpError(
      429,
      'rate_limited',
      `This token is being used too fast — more than ${LIMIT} requests a minute. Slow down and try again.`,
    );
  }
}
