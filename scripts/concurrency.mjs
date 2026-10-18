/**
 * Concurrency harness — does this instance hold up under several people, and
 * their agents, working at once?
 *
 * Not a load test. It targets the specific places where "files are the database"
 * has to supply what a database would have given for free, and asserts the
 * outcome rather than the absence of a crash:
 *
 *  1. Two writers, one board — every node move must survive. `withLock` is the
 *     only thing making read-modify-write safe here.
 *  2. Two writers, one `folders.json` — same question for the file the per-folder
 *     operations were added to, where an agent and a browser now both write.
 *  3. Concurrent board *creation* — slug minting under a race.
 *  4. Two users at once — one must never see or touch the other's workspace,
 *     however hard they overlap.
 *  5. A reader on a shared board while the owner writes it — reads must not
 *     write in someone else's workspace (`ws.canWrite`).
 *  6. SQLite under concurrent sessions — WAL, one process, many requests.
 *  7. Sustained mixed load, to see whether anything leaks: held locks must
 *     return to zero and latency must not run away.
 *
 * Writes. Point it at a throwaway instance:
 *   SMOKE_PASS=… SMOKE_OTHER_PASS=… API=http://localhost:3100/api node scripts/concurrency.mjs
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const API = process.env.API ?? 'http://localhost:3000/api';
/** Optional: lets the harness compare files on the volume directly. */
const DATA_DIR = process.env.DATA_DIR ?? '';
const USER = process.env.SMOKE_USER ?? 'admin';
const PASS = process.env.SMOKE_PASS;
const OTHER_USER = process.env.SMOKE_OTHER_USER ?? 'reviewer';
const OTHER_PASS = process.env.SMOKE_OTHER_PASS;

if (!PASS) {
  console.error('SMOKE_PASS is required. SMOKE_OTHER_PASS enables the two-user checks.');
  process.exit(2);
}

let passed = 0;
let failed = 0;
const check = (ok, label, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? ' ok  ' : 'FAIL '} ${label}${detail ? `  — ${detail}` : ''}`);
};
const section = (name) => console.log(`\n— ${name}`);
const log = (line) => console.log(line);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One signed-in identity. Cookies are held per session, never shared.
 *
 * Retries once on 429, because this script spends part of the per-IP login
 * allowance itself — running it twice inside a minute would otherwise fail at
 * the door on the very limit its last section documents.
 */
async function signIn(username, password) {
  let res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 429) {
    console.log(`(per-IP login allowance spent — waiting it out before signing in as ${username})`);
    await wait(61_000);
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  }
  if (!res.ok) throw new Error(`${username}: login ${res.status}`);
  const jar = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const { user } = await res.json();
  const call = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { cookie: jar, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: r.status, body: json };
  };
  return { user, call };
}

const MCP_URL = API.replace(/\/api\/?$/, '') + '/mcp';
let rpcId = 0;

/** The same plain-fetch wire client the smoke test uses — no SDK, no connector. */
async function mcp(method, params, { secret, sessionId, notification = false } = {}) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(notification ? {} : { id: (rpcId += 1) }) }),
  });
  const text = await res.text();
  let payload = null;
  try {
    const data = text.startsWith('event:') || text.startsWith('data:')
      ? text.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim()
      : text;
    payload = data ? JSON.parse(data) : null;
  } catch { /* non-JSON */ }
  return { status: res.status, sessionId: res.headers.get('mcp-session-id') ?? sessionId, payload };
}

const INIT = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'cartographer-concurrency', version: '1.0.0' },
};

/** An agent, connected the way a real one is: its own token, its own session. */
async function agent(call, name) {
  const minted = (await call('POST', '/tokens', { name, scope: 'write' })).body;
  // `{ token, secret }` — the id is nested. Reading `minted.id` gave undefined,
  // so cleanup issued `DELETE /tokens/undefined` and every run left a live
  // write-scoped token behind. scripts/smoke.mjs had this right; this did not.
  const token = { id: minted?.token?.id, secret: minted?.secret };
  if (!token.id || !token.secret) throw new Error(`token mint failed: ${JSON.stringify(minted).slice(0, 160)}`);
  const opened = await mcp('initialize', INIT, { secret: token.secret });
  await mcp('notifications/initialized', {}, { secret: token.secret, sessionId: opened.sessionId, notification: true });
  const invoke = async (tool, args) => {
    const r = await mcp('tools/call', { name: tool, arguments: args },
      { secret: token.secret, sessionId: opened.sessionId });
    const content = r.payload?.result?.content?.[0]?.text;
    let parsed = null;
    try { parsed = content ? JSON.parse(content) : null; } catch { parsed = content; }
    /*
     * A transport failure is an error too. Keying only on `result.isError` made
     * a 401, a 404 "session not found", a 429 or a 500 read as success, because
     * `payload.result` is simply absent — so assertions about tool calls went
     * green for requests the server refused outright.
     */
    const ok = r.status === 200 && !!r.payload?.result && !r.payload.result.isError;
    return { status: r.status, isError: !ok, text: content, json: parsed };
  };
  return { id: token.id, invoke };
}

const made = { boards: [], other: [], tokens: [] };

async function main() {
  const me = await signIn(USER, PASS);
  let them = null;
  if (OTHER_PASS) {
    try {
      them = await signIn(OTHER_USER, OTHER_PASS);
    } catch {
      console.log(`(${OTHER_USER} unavailable — two-user checks skipped)`);
    }
  }

  // ---- 1. two writers, one board ----
  section('Two writers on one board');
  const board = (await me.call('POST', '/boards', { name: `Concurrency ${Date.now()}` })).body;
  made.boards.push(board.id);
  const nodeIds = [];
  for (let i = 0; i < 8; i += 1) {
    const node = (await me.call('POST', `/boards/${board.id}/nodes`, { title: `N${i}` })).body;
    nodeIds.push(node.id);
  }

  /*
   * The interleave `core/locks.ts` was written for: the canvas runs two
   * independent autosave timers (graph 1000 ms, body 800 ms), so a graph write
   * and a node-body write genuinely overlap on one board.
   *
   * Eight concurrent whole-graph PUTs prove nothing on their own — each carries
   * all eight nodes, so last-writer-wins produces the same file a correct lock
   * would, and the assertion passes with the lock deleted. Two *different*
   * endpoints is the test: move a node via the graph while writing another
   * node's body, then require that both effects survived.
   */
  const graph = (await me.call('GET', `/boards/${board.id}`)).body;
  const baseNodes = graph.nodes.map((n) => ({ ...n }));
  const movedId = nodeIds[0];
  const bodyId = nodeIds[1];
  const marker = `body written at ${Date.now()}`;
  await Promise.all([
    me.call('PUT', `/boards/${board.id}/graph`, {
      nodes: baseNodes.map((n) => (n.id === movedId ? { ...n, position: { x: 777, y: 50 } } : n)),
    }),
    me.call('PUT', `/boards/${board.id}/nodes/${bodyId}/body`, { body: marker }),
  ]);
  const afterGraph = (await me.call('GET', `/boards/${board.id}`)).body;
  const movedNode = afterGraph.nodes.find((n) => n.id === movedId);
  const bodyBack = (await me.call('GET', `/boards/${board.id}/nodes/${bodyId}`)).body;
  check(
    movedNode?.position?.y === 50 && movedNode?.position?.x === 777,
    'a graph write and a body write overlapping: the move survives',
    JSON.stringify(movedNode?.position),
  );
  check(
    bodyBack?.body?.trim() === marker,
    'and the body survives — neither writer erased the other',
    `${JSON.stringify((bodyBack?.body ?? '').slice(0, 24))}…`,
  );
  check(
    afterGraph.nodes.length === nodeIds.length,
    'no node is lost to an overlapping write',
    `${afterGraph.nodes.length}/${nodeIds.length}`,
  );

  // The granular path is deferred to section 2, where the agent exists.

  /*
   * The stale-write guard. The canvas sends the `updatedAt` it built its copy
   * from; a payload built on a board that has moved on is refused rather than
   * applied. Without this a tab that missed a change silently deleted whatever
   * arrived while it was open — an agent's node, dropped by omission, its
   * `node.md` left orphaned on disk.
   */
  const fresh = (await me.call('GET', `/boards/${board.id}`)).body;
  const goodBase = fresh.updatedAt;
  const withBase = await me.call('PUT', `/boards/${board.id}/graph`, {
    viewport: { x: 5, y: 5, zoom: 1 },
    baseUpdatedAt: goodBase,
  });
  check(withBase.status === 200, 'a save built on the current board is accepted', `${withBase.status}`);

  // The same base again — the write above moved the board on, so this one is
  // exactly the stale payload the guard exists for.
  const stale = await me.call('PUT', `/boards/${board.id}/graph`, {
    nodes: [],
    viewport: { x: 6, y: 6, zoom: 1 },
    baseUpdatedAt: goodBase,
  });
  check(stale.status === 409, 'a save built on a stale board is refused with 409', `${stale.status}`);
  const survived = (await me.call('GET', `/boards/${board.id}`)).body;
  check(
    survived.nodes.length === nodeIds.length,
    'and the refusal costs nothing — the board is intact',
    `${survived.nodes.length}/${nodeIds.length} nodes`,
  );
  const noBase = await me.call('PUT', `/boards/${board.id}/graph`, { viewport: { x: 7, y: 7, zoom: 1 } });
  check(
    noBase.status === 200,
    'a caller with no base to offer is unaffected — agents never send one',
    `${noBase.status}`,
  );

  // ---- 2. two writers, one folders.json ----
  section('Concurrent folder writes — an agent and a browser on one shelf');
  const bot = await agent(me.call, `concurrency ${Date.now()}`);
  made.tokens.push(bot.id);

  const before = (await me.call('GET', '/folders')).body;
  const names = Array.from({ length: 8 }, (_, i) => `Race ${i}-${Date.now() % 100000}`);

  // Eight create_folder calls in flight at once, over MCP.
  const created = await Promise.all(names.map((name) => bot.invoke('create_folder', { name })));
  const okCreates = created.filter((r) => !r.isError).length;
  const after = (await me.call('GET', '/folders')).body;
  const landedFolders = names.filter((n) => after.folders.some((f) => f.name === n));
  check(
    okCreates === names.length && landedFolders.length === names.length,
    'every concurrently created folder is accepted and in the file',
    `${okCreates}/${names.length} accepted, ${landedFolders.length} present`,
  );
  check(
    after.folders.length === before.folders.length + landedFolders.length,
    'concurrent creates do not drop existing folders',
    `${before.folders.length} → ${after.folders.length}`,
  );

  // The same board filed into eight folders at once: one must win, cleanly.
  const filings = await Promise.all(
    landedFolders.map((name) => bot.invoke('file_boards', { boardIds: [board.id], folder: name })),
  );
  check(
    filings.every((r) => !r.isError),
    'concurrent filings all answer cleanly',
    `${filings.filter((r) => !r.isError).length}/${filings.length}`,
  );
  const filed = (await me.call('GET', '/folders')).body;
  const assigned = filed.assignments[board.id];
  check(
    !!assigned && filed.folders.some((f) => f.id === assigned),
    'a board races into exactly one real folder',
    `assigned to “${filed.folders.find((f) => f.id === assigned)?.name ?? 'nothing'}”`,
  );

  /*
   * The pair that had no lock until the folder tools landed, made to actually disagree: the
   * browser PUTs a shelf with one folder *added* while the agent files a board
   * into an existing one. Both changes must survive. Sending the shelf back
   * unchanged, as this did before, could not detect a loss — both writers
   * carried the same folder set, so the file matched either way.
   */
  const extra = `Race extra ${Date.now() % 100000}`;
  const target = landedFolders[1];
  const [putRes, fileRes] = await Promise.all([
    me.call('PUT', '/folders', { ...filed, folders: [...filed.folders, { name: extra }] }),
    bot.invoke('file_boards', { boardIds: [board.id], folder: target }),
  ]);
  check(putRes.status < 400 && !fileRes.isError, 'a PUT and a file_boards overlapping both answer',
    `PUT ${putRes.status}, tool ${fileRes.isError ? 'error' : 'ok'}`);
  const settled = (await me.call('GET', '/folders')).body;
  const targetId = settled.folders.find((f) => f.name === target)?.id;
  check(
    settled.folders.some((f) => f.name === extra),
    'the folder the browser added survives the overlap',
    `${settled.folders.length} folders`,
  );
  check(
    Array.isArray(settled.folders) && typeof settled.assignments === 'object',
    'folders.json is still well-formed after the interleave',
    `${Object.keys(settled.assignments).length} assignment(s)`,
  );
  /*
   * Last-writer-wins is still possible *between* the two payloads — the browser
   * sends a whole shelf and the agent edits one key — so this reports which
   * landed rather than demanding the agent's did. What must never happen is a
   * torn file or a lost folder, and those are asserted above.
   */
  log(`      (assignment after the overlap: ${settled.assignments[board.id] === targetId ? 'agent’s filing won' : 'browser’s shelf won'})`);

  const listedByAgent = await bot.invoke('list_folders', {});
  check(
    Array.isArray(listedByAgent.json) && listedByAgent.json.length === settled.folders.length,
    'the agent reads back the same shelf the browser sees',
    `${listedByAgent.json?.length} folders over MCP`,
  );

  /*
   * The granular path: eight independent read-modify-writes of one board, in
   * flight together. Each must land — this is the case the whole-graph PUT
   * cannot satisfy and `move_nodes` exists for.
   */
  const moves = await Promise.all(
    nodeIds.map((id, i) =>
      bot.invoke('move_nodes', { boardId: board.id, nodes: [{ nodeId: id, position: { x: i * 37, y: 900 } }] }),
    ),
  );
  const afterMoves = (await me.call('GET', `/boards/${board.id}`)).body;
  const landed = afterMoves.nodes.filter((n) => n.position.y === 900).length;
  check(
    moves.every((r) => !r.isError) && landed === nodeIds.length,
    'every concurrent single-node move survives',
    `${landed}/${nodeIds.length} landed`,
  );

  // ---- 3. concurrent board creation ----
  section('Concurrent board creation');
  const sameName = `Twin ${Date.now()}`;
  const twins = await Promise.all(
    Array.from({ length: 6 }, () => me.call('POST', '/boards', { name: sameName })),
  );
  const twinIds = twins.filter((r) => r.status < 400).map((r) => r.body.id);
  made.boards.push(...new Set(twinIds));
  check(
    new Set(twinIds).size === twinIds.length,
    'six boards created at once get six distinct ids',
    `${new Set(twinIds).size} distinct: ${[...new Set(twinIds)].join(', ')}`,
  );
  /*
   * The one that matters. Six same-named creates in flight used to settle on
   * three slugs and write three of the boards over each other — the shelf came
   * back short and nothing said so. Count what is actually there, by name.
   */
  const listed = (await me.call('GET', '/boards')).body;
  const onShelf = listed.filter((b) => b.name === sameName);
  check(
    onShelf.length === 6,
    'all six survive — none is overwritten by another',
    `${onShelf.length}/6 on the shelf`,
  );

  // ---- 4. two users at once ----
  if (them) {
    section('Two users at once');
    const theirBoard = (await them.call('POST', '/boards', { name: `Theirs ${Date.now()}` })).body;
    made.other.push(theirBoard.id);

    // Hammer both workspaces simultaneously, then check neither leaked.
    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) =>
        me.call('POST', `/boards/${board.id}/nodes`, { title: `mine-${i}` }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        them.call('POST', `/boards/${theirBoard.id}/nodes`, { title: `theirs-${i}` }),
      ),
    ]);
    const mine = (await me.call('GET', '/boards')).body;
    const theirs = (await them.call('GET', '/boards')).body;
    check(
      !mine.some((b) => b.id === theirBoard.id),
      'their board never appears in my list',
      `${mine.length} boards of mine`,
    );
    check(
      !theirs.some((b) => b.id === board.id),
      'my board never appears in theirs',
      `${theirs.length} boards of theirs`,
    );
    /*
     * `admin` is a Super Admin, so Admin View reaching their workspace is the
     * documented behaviour, not a leak — the ladder is own → admin → share. The
     * check that means something is the other direction: an ordinary account
     * must not reach the admin's workspace, and must be told 404 rather than
     * 403 so it learns nothing about what exists.
     */
    const peekUp = await them.call('GET', `/u/${me.user.id}/boards/${board.id}`);
    check(
      peekUp.status === 404,
      'an ordinary account reaching into another workspace gets 404, not 403',
      `${peekUp.status}`,
    );
    const peekDown = await me.call('GET', `/u/${them.user.id}/boards/${theirBoard.id}`);
    check(
      me.user.isSuperAdmin ? peekDown.status === 200 : peekDown.status === 404,
      me.user.isSuperAdmin
        ? 'a Super Admin does reach it — Admin View, by design'
        : 'a peer does not reach it',
      `${peekDown.status}`,
    );

    const mineNow = (await me.call('GET', `/boards/${board.id}`)).body;
    const theirsNow = (await them.call('GET', `/boards/${theirBoard.id}`)).body;
    check(
      mineNow.nodes.every((n) => !n.title.startsWith('theirs-')),
      'no node crossed from one workspace to the other',
      `${mineNow.nodes.length} nodes mine, ${theirsNow.nodes.length} theirs`,
    );
    check(
      theirsNow.nodes.filter((n) => n.title.startsWith('theirs-')).length === 10,
      'all ten of their concurrent creates landed',
      `${theirsNow.nodes.filter((n) => n.title.startsWith('theirs-')).length}/10`,
    );

    // ---- 5. a reader on a shared board while the owner writes ----
    section('Reading a shared board while its owner writes');
    await me.call('POST', `/boards/${board.id}/shares`, { userId: them.user.id });
    const beforeShare = (await me.call('GET', '/boards')).body.find((b) => b.id === board.id);
    const reads = await Promise.all([
      ...Array.from({ length: 12 }, () => them.call('GET', `/u/${me.user.id}/boards/${board.id}`)),
      ...Array.from({ length: 6 }, (_, i) =>
        me.call('POST', `/boards/${board.id}/nodes`, { title: `while-read-${i}` }),
      ),
    ]);
    check(
      reads.slice(0, 12).every((r) => r.status === 200),
      'every concurrent read of the shared board succeeds',
      reads.slice(0, 12).filter((r) => r.status === 200).length + '/12',
    );
    /*
     * The real "reads must not write in someone else's workspace" risk is not
     * the reader's own files — nothing could write those. It is `getBoard`
     * reconciling and rewriting the *owner's* `board.json` on the read path,
     * and `readNodeData` migrating the owner's sidecar. Both are supposed to
     * check `ws.canWrite`. Compare the owner's file byte-for-byte across a
     * burst of reads by the sharee.
     */
    const ownerFile = `${DATA_DIR}/users/${me.user.id}/boards/${board.id}/board.json`;
    let beforeBytes = null;
    try { beforeBytes = createHash('sha256').update(await readFile(ownerFile)).digest('hex'); } catch { /* no volume access */ }
    await Promise.all(Array.from({ length: 10 }, () => them.call('GET', `/u/${me.user.id}/boards/${board.id}`)));
    if (beforeBytes) {
      const afterBytes = createHash('sha256').update(await readFile(ownerFile)).digest('hex');
      check(
        afterBytes === beforeBytes,
        'ten reads by the sharee do not rewrite the owner’s board.json',
        afterBytes === beforeBytes ? 'byte-identical' : 'FILE CHANGED',
      );
    } else {
      log('      (volume not reachable from here — owner-file check skipped; set DATA_DIR)');
    }

    const revoked = await me.call('DELETE', `/boards/${board.id}/shares?userId=${them.user.id}`);
    check(revoked.status < 400, 'the share is revoked cleanly', `${revoked.status}`);
  }

  // ---- 6. SQLite under concurrent sessions ----
  section('SQLite under concurrent sessions');
  /*
   * The rule, not a fixed count. `checkLoginRate` counts every attempt per IP —
   * successes included — and `clearLoginRate` clears only the *username*
   * bucket, so it is a hard ten a minute from one address. This script has
   * already spent some of that allowance, so what is asserted is the shape:
   * whatever is accepted must be a real session, and whatever is refused must
   * be refused cleanly with 429 rather than 500 or a hang.
   */
  const burst = 8;
  const logins = await Promise.all(
    Array.from({ length: burst }, () =>
      fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: USER, password: PASS }),
      }),
    ),
  );
  const accepted = logins.filter((r) => r.ok);
  const refused = logins.filter((r) => !r.ok);
  check(
    accepted.length > 0 && accepted.every((r) => r.headers.getSetCookie().length > 0),
    'concurrent sign-ins each get their own session cookie',
    `${accepted.length}/${burst} accepted, all with a cookie`,
  );
  if (refused.length) {
    check(
      refused.every((r) => r.status === 429),
      'sign-ins over the per-IP allowance are refused cleanly, never 500',
      `${refused.length} × ${[...new Set(refused.map((r) => r.status))].join('/')} (the documented 10/min cap)`,
    );
  } else {
    // Not asserted as a pass: `[].every(…)` is true, and a check that reports
    // green for a property it never observed is worse than no check.
    log('      (allowance not exhausted this run — refusal shape not exercised)');
  }

  const whoami = await Promise.all(Array.from({ length: 20 }, () => me.call('GET', '/auth/me')));
  check(
    whoami.every((r) => r.status === 200 && r.body.user.username === USER),
    'twenty concurrent session reads all resolve to the right person',
    `${whoami.filter((r) => r.status === 200).length}/20`,
  );

  // ---- 7. sustained mixed load ----
  section('Sustained mixed load');
  const started = Date.now();
  const rounds = 6;
  const latencies = [];
  for (let round = 0; round < rounds; round += 1) {
    const t0 = Date.now();
    await Promise.all([
      me.call('GET', '/boards'),
      me.call('GET', '/folders'),
      me.call('GET', `/boards/${board.id}`),
      me.call('POST', `/boards/${board.id}/nodes`, { title: `load-${round}` }),
      bot.invoke('file_boards', { boardIds: [board.id], folder: null }),
      ...(them ? [them.call('GET', '/boards'), them.call('GET', '/shared-with-me')] : []),
    ]);
    latencies.push(Date.now() - t0);
  }
  const worst = Math.max(...latencies);
  const first = latencies[0];
  check(
    latencies.every((ms) => ms < 5000),
    'no round of mixed traffic stalls',
    `rounds: ${latencies.join('ms, ')}ms`,
  );
  check(
    worst < Math.max(first * 4, 1500),
    'latency does not climb across rounds (no queue build-up)',
    `first ${first}ms, worst ${worst}ms`,
  );

  const health = await me.call('GET', '/boards');
  check(health.status === 200, 'the instance is still healthy at the end', `${Date.now() - started}ms of load`);

  // ---- cleanup ----
  section('Cleanup');
  for (const id of made.boards) await me.call('POST', `/boards/${id}/archive`);
  if (them) for (const id of made.other) await them.call('POST', `/boards/${id}/archive`);
  for (const id of made.tokens) await me.call('DELETE', `/tokens/${id}`);
  await me.call('PUT', '/folders', before);
  const restored = (await me.call('GET', '/folders')).body;
  check(
    restored.folders.length === before.folders.length,
    'the shelf is back as it was',
    `${restored.folders.length} folders`,
  );

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nRUN FAILED:', err?.message ?? err);
  // Best effort, so a throw mid-run does not leave a live write-scoped token,
  // stray boards or a mangled shelf on the instance.
  try {
    const me = await signIn(USER, PASS);
    for (const id of made.boards) await me.call('POST', `/boards/${id}/archive`);
    for (const id of made.tokens) if (id) await me.call('DELETE', `/tokens/${id}`);
    console.error('(cleaned up what it could)');
  } catch { /* the instance may be the thing that is broken */ }
  process.exit(1);
});
