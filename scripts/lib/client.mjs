/**
 * The authenticated API client the seed scripts share.
 *
 * Since v1.6 every `/api/*` route except login sits behind a session, so a bare
 * `fetch` gets a 401 and nothing seeds. This signs in once and replays the
 * session cookie on every later call.
 *
 * Credentials come from the environment — these files are tracked, and a
 * password baked into one would outlive whatever it was for:
 *
 *   SEED_USER=admin SEED_PASS='…' node scripts/seed-example.mjs
 */
const API = process.env.API ?? 'http://localhost:3000/api';
const USER = process.env.SEED_USER ?? 'admin';
const PASS = process.env.SEED_PASS;

let cookie = '';

async function raw(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return res;
}

/** Signs in. Call once, before anything else. */
export async function signIn() {
  if (!PASS) {
    console.error('Set SEED_PASS (and SEED_USER if not "admin") before seeding.');
    process.exit(2);
  }
  const res = await raw('POST', '/auth/login', { username: USER, password: PASS });
  if (!res.ok) {
    console.error(`Could not sign in as "${USER}": ${res.status}. Check SEED_USER / SEED_PASS.`);
    process.exit(1);
  }
  const { user } = await res.json();
  if (user.mustChangePassword) {
    console.error(`"${USER}" must change their password before the API will accept anything else.`);
    process.exit(1);
  }
}

/** Every seed script's one verb. Throws with the server's own message. */
export async function call(method, path, body) {
  const res = await raw(method, path, body);
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}
