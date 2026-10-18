import { randomInt } from 'node:crypto';
import { execute, newId } from '../../core/db.js';
import { nowIso } from '../../core/storage.js';

/**
 * The audit log (v1.6 §1, §3): who did what, to whom, when. Admin actions only —
 * ordinary work on your own boards is not an event, the files are. There is no
 * UI for it in v1.6 on purpose; it exists to be read with `sqlite3` when someone
 * asks "who reset that password".
 *
 * `origin` is how "who did this" survives the actor being an agent (v1.7 §4). An
 * MCP write is still attributed to the token's owner — the tenancy rules depend
 * on that — so the actor id alone can no longer tell an agent's run apart from
 * the person sitting at the keyboard. Passing the transport and the token name
 * keeps the distinction in the row instead of nowhere. Absent for human actions,
 * which is exactly what every row written before v1.7 means.
 */
export function recordAudit(
  actorId: string,
  action: string,
  target: string | null,
  origin?: { via: string; label: string },
): void {
  execute(
    `INSERT INTO audit (id, actor_id, action, target, created_at, via, actor_label)
     VALUES (@id, @actor_id, @action, @target, @created_at, @via, @actor_label)`,
    {
      id: newId(),
      actor_id: actorId,
      action,
      target,
      created_at: nowIso(),
      // SqlParams admits null but not undefined, and an omitted origin is a fact
      // about the row, not a missing binding.
      via: origin?.via ?? null,
      actor_label: origin?.label ?? null,
    },
  );
}

/*
 * No 0/O/1/l/I: this is read off one screen and typed into another, often out
 * loud. Four groups of four is 20 bits × ~3 — far past guessing, and it is
 * alive only until the holder signs in and is forced to change it (§2).
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateTempPassword(): string {
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
  );
  return groups.join('-');
}
