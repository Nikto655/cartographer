/**
 * Starts a throwaway instance for the smoke and concurrency suites: a fresh,
 * empty data directory, bound to 127.0.0.1, with an `admin` and a `reviewer`
 * account whose passwords are already changed — so the suites can run their
 * full set straight away.
 *
 *   npm run build                       # the instance runs server/dist
 *   node scripts/throwaway.mjs          # port 3100, or pass another
 *
 * It prints the variables the suites read, and the command that stops it. The
 * data directory is a new temp folder each time, so nothing real is touched.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? 3100);
const base = `http://127.0.0.1:${port}`;
const entry = path.join(root, 'server/dist/index.js');

if (!fs.existsSync(entry)) {
  console.error('server/dist is missing — run `npm run build` first.');
  process.exit(2);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cartographer-throwaway-'));
const secret = () => randomBytes(12).toString('hex');
const bootstrap = secret();

const log = fs.openSync(path.join(dataDir, 'server.log'), 'a');
const server = spawn(process.execPath, [entry], {
  cwd: root,
  detached: true,
  stdio: ['ignore', log, log],
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    COOKIE_SECURE: 'false',
    TRUST_PROXY: 'false',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: bootstrap,
  },
});
server.unref();

const fail = (message) => {
  console.error(`${message}\nServer log: ${path.join(dataDir, 'server.log')}`);
  try {
    process.kill(server.pid);
  } catch {
    /* already gone */
  }
  process.exit(1);
};

// Wait for the listener rather than guessing how long a boot takes.
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${base}/`)).ok) break;
  } catch {
    /* not listening yet */
  }
  if (i > 60) fail(`No server on ${base} after 15s (is the port taken?).`);
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/** A tiny cookie-carrying client, one per account. */
function client() {
  let cookie = '';
  return async (method, route, body) => {
    const res = await fetch(`${base}/api${route}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const json = await res.json().catch(() => null);
    if (!res.ok) fail(`${method} ${route} answered ${res.status}: ${JSON.stringify(json)}`);
    return json;
  };
}

/** Sign in with a one-time password and replace it, which is what a person does first. */
async function claim(username, temporary) {
  const call = client();
  await call('POST', '/auth/login', { username, password: temporary });
  const password = secret();
  await call('POST', '/auth/change-password', { currentPassword: temporary, newPassword: password });
  return { call, password };
}

const admin = await claim('admin', bootstrap);
const created = await admin.call('POST', '/admin/users', { username: 'reviewer', displayName: 'Reviewer' });
const reviewer = await claim('reviewer', created.tempPassword);

console.log(`Throwaway instance on ${base} (pid ${server.pid}), data in ${dataDir}

export API=${base}/api DATA_DIR=${dataDir}
export SMOKE_PASS=${admin.password} SMOKE_OTHER_PASS=${reviewer.password}

npm run smoke
node scripts/concurrency.mjs

Stop it with: kill ${server.pid}`);
