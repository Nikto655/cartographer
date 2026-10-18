/**
 * Sets a user's password directly on the volume — the recovery path for when
 * nobody can sign in.
 *
 * The app has no other way back in: a password reset needs a Super Admin, and if
 * the only Super Admin is locked out there is no one left to ask. Bootstrap does
 * not help either — it only fires when the users table is empty, and emptying it
 * would orphan the workspace, which is keyed by user id, not by name.
 *
 * Run it on the machine that holds the data, with the server stopped:
 *
 *   node scripts/set-password.mjs <username> <new-password>
 *   DATA_DIR=/path/to/data node scripts/set-password.mjs admin 'new pw'
 *
 * It clears the user's sessions (anyone signed in as them is signed out) and
 * leaves `must_change_password` off, so the new password works immediately.
 */
import path from 'node:path';
import process from 'node:process';
import { hash } from '@node-rs/argon2';
import Database from 'better-sqlite3';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: node scripts/set-password.mjs <username> <new-password>');
  process.exit(2);
}
if (password.length < 8) {
  console.error('Passwords are at least 8 characters, same as the app requires.');
  process.exit(2);
}

const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));
const dbFile = path.join(dataDir, 'app.db');

const db = new Database(dbFile);
const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
if (!user) {
  console.error(`No user named "${username}" in ${dbFile}.`);
  const all = db.prepare('SELECT username FROM users ORDER BY username').all();
  if (all.length) console.error(`Known users: ${all.map((u) => u.username).join(', ')}`);
  process.exit(1);
}

// Same algorithm and parameters the server uses, so the hash is interchangeable.
const passwordHash = await hash(password);
db.prepare(
  'UPDATE users SET password_hash = @hash, must_change_password = 0, is_disabled = 0 WHERE id = @id',
).run({ hash: passwordHash, id: user.id });
const killed = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id).changes;
db.close();

console.log(`Password set for "${user.username}". ${killed} session(s) signed out.`);
console.log('Start the server and sign in with the new password.');
