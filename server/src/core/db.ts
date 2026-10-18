/**
 * ALL SQLite access lives here, exactly as all filesystem access lives in
 * `storage.ts`. Nothing outside this module may import `better-sqlite3`.
 *
 * Rule, permanent (v1.6 §1): **the DB stores facts about the system; files
 * store content.** Who exists, who is signed in, what is shared, what an admin
 * did — those are facts. Boards and nodes never mirror into a table; the volume
 * remains the database for content, and app.db can be deleted without losing a
 * single map.
 */
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { systemPaths } from './storage.js';

/**
 * Timestamps are ISO strings, matching the files. SQLite has no boolean, so
 * flags are 0/1 INTEGERs, as §1 spells them.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE,
  display_name         TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  is_super_admin       INTEGER NOT NULL DEFAULT 0,
  is_disabled          INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS shares (
  id            TEXT PRIMARY KEY,
  board_id      TEXT NOT NULL,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_duplicate INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  UNIQUE(board_id, recipient_id)
);
-- include_children is added below rather than here, so a database written by an
-- earlier build gains it too.

CREATE TABLE IF NOT EXISTS audit (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  created_at TEXT NOT NULL
);
-- via and actor_label are added below rather than here, for the same reason.

-- Personal access tokens (v1.7 §2.1). Only the SHA-256 of the secret is kept, so
-- this table is as safe to copy as the sessions one. Revoking sets revoked_at rather
-- than deleting the row: "that token did this" has to stay answerable in the
-- audit log after the token is gone.
CREATE TABLE IF NOT EXISTS tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  scope        TEXT NOT NULL CHECK(scope IN ('read','write')),
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id);
`;

let db: Database.Database | null = null;
const statements = new Map<string, Database.Statement>();

/** Idempotent: safe on every boot, whether app.db exists or not. */
export function initDb(): void {
  if (db) return;
  db = new Database(systemPaths.dbFile());
  // WAL: a reader never blocks the writer, and a half-finished write can't corrupt the file.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  addColumn('shares', 'include_children', 'INTEGER NOT NULL DEFAULT 1');
  // Default 0, unlike include_children above: export used to be open to every
  // recipient, so every existing row would otherwise keep a permission its
  // owner was never asked for. Closing it is the point of adding the column.
  addColumn('shares', 'can_export', 'INTEGER NOT NULL DEFAULT 0');
  // NULL means "never opened" — every pre-existing share honestly starts there,
  // because nothing before this column recorded an open.
  addColumn('shares', 'last_accessed_at', 'TEXT');
  // An MCP write and an admin action are both "the user did this" without these
  // (v1.7 §4). NULL is what every pre-v1.7 row means: a person, at the keyboard.
  addColumn('audit', 'via', 'TEXT');
  addColumn('audit', 'actor_label', 'TEXT');
}

/**
 * `CREATE TABLE IF NOT EXISTS` never revisits a table that already exists, so a
 * column added after the fact needs its own idempotent step. The default is what
 * every row written before the column existed will read as — pick it so the old
 * behaviour survives.
 */
function addColumn(table: string, column: string, definition: string): void {
  const columns = db!.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db!.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}


export type SqlParams = Record<string, string | number | null>;

function prepared(sql: string): Database.Statement {
  if (!db) throw new Error('app.db was used before initDb() — check boot order.');
  let statement = statements.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    statements.set(sql, statement);
  }
  return statement;
}

// better-sqlite3 rejects a bindings object on a statement that takes none.
const args = (params: SqlParams): [SqlParams] | [] =>
  Object.keys(params).length > 0 ? [params] : [];

export function queryOne<T>(sql: string, params: SqlParams = {}): T | undefined {
  return prepared(sql).get(...args(params)) as T | undefined;
}

export function queryAll<T>(sql: string, params: SqlParams = {}): T[] {
  return prepared(sql).all(...args(params)) as T[];
}

/** Returns the number of rows the statement changed. */
export function execute(sql: string, params: SqlParams = {}): number {
  return prepared(sql).run(...args(params)).changes;
}

export function newId(): string {
  return randomUUID();
}
