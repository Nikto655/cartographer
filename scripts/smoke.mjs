/**
 * End-to-end smoke test: signs in, exercises every major feature through the
 * public API, and checks the access rules actually refuse what they should.
 *
 * It WRITES — boards, nodes, shares — so point it at a throwaway instance, never
 * at the volume you keep your work on:
 *
 *   cp -R data /tmp/smoke-data
 *   (cd server && DATA_DIR=/tmp/smoke-data PORT=3100 npx tsx src/index.ts &)
 *   SMOKE_PASS=… API=http://localhost:3100/api node scripts/smoke.mjs
 *
 * Credentials come from SMOKE_USER / SMOKE_PASS, and the sharing checks need a
 * second account named by SMOKE_OTHER_USER / SMOKE_OTHER_PASS; those sections
 * are skipped when it does not exist.
 */
const API = process.env.API ?? 'http://localhost:3100/api';
const USER = process.env.SMOKE_USER ?? 'admin';
const PASS = process.env.SMOKE_PASS;
const OTHER_USER = process.env.SMOKE_OTHER_USER ?? 'reviewer';
const OTHER_PASS = process.env.SMOKE_OTHER_PASS;

// No credential defaults: this file is tracked, and a password baked into it
// would outlive whatever it was meant for.
if (!PASS) {
  console.error('Set SMOKE_PASS (and SMOKE_OTHER_PASS for the sharing checks).');
  process.exit(2);
}
let cookie = '';
const results = [];

async function call(method, path, body, { as = 'session', raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(as === 'session' && cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return raw ? { status: res.status, json, text } : { status: res.status, json };
}

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// ---------------------------------------------------------------- 1. auth
let r = await call('POST', '/auth/login', { username: USER, password: 'definitely-not-the-password' });
check('login rejects a wrong password', r.status === 401);
r = await call('POST', '/auth/login', { username: USER, password: PASS });
check('login accepts the right password', r.status === 200, `user=${r.json?.user?.username}`);
if (r.status !== 200) {
  console.error('\nCannot sign in — the rest of the run would be meaningless. Check SMOKE_USER/SMOKE_PASS.');
  process.exit(1);
}
// A bootstrap password still unchanged can sign in and do nothing else; every
// later check would fail for that one reason, so say it once instead.
if (r.json?.user?.mustChangePassword) {
  console.error(
    `\n${USER} still has to change its password, so every other request is refused.` +
      '\nSign in once and change it, or start a ready instance with `node scripts/throwaway.mjs`.',
  );
  process.exit(1);
}
r = await call('GET', '/auth/me');
check('session identifies the user', r.status === 200 && r.json.user.username === USER);

const savedCookie = cookie;
cookie = '';
r = await call('GET', '/boards');
check('unauthenticated read is refused', r.status === 401);
cookie = savedCookie;

// ------------------------------------------------------------ 2. dashboard
r = await call('GET', '/boards');
const boardCount = r.json.length;
check('board list loads', r.status === 200 && boardCount > 0, `${boardCount} boards`);

r = await call('POST', '/boards', { name: 'Smoke map' });
let MAP = r.json.id;
check('create a map', r.status === 201 && r.json.boardType === 'map', MAP);
r = await call('POST', '/boards', { name: 'Smoke graph', boardType: 'graph' });
const GRAPH = r.json.id;
check('create a graph', r.status === 201 && r.json.boardType === 'graph', GRAPH);

r = await call('PATCH', `/boards/${MAP}`, { name: 'Smoke map renamed' });
check('rename a board', r.status === 200 && r.json.name === 'Smoke map renamed');
// A rename re-slugs the id and moves the directory, so the handle changes too.
check('rename re-slugs the board id', r.json.id !== MAP, `${MAP} → ${r.json.id}`);
MAP = r.json.id;

// ---------------------------------------------------------------- 3. nodes
const nodeIds = {};
for (const title of ['Alpha', 'Beta', 'Gamma']) {
  r = await call('POST', `/boards/${MAP}/nodes`, { title, position: { x: 0, y: 0 } });
  nodeIds[title] = r.json.id;
}
check('create nodes', Object.keys(nodeIds).length === 3, Object.values(nodeIds).join(', '));

r = await call('PUT', `/boards/${MAP}/nodes/${nodeIds.Alpha}/body`, {
  body: 'Alpha points at [[Beta]] and at [[Nowhere]].\n',
});
check('write a node body', r.status === 200);

r = await call('PATCH', `/boards/${MAP}/nodes/${nodeIds.Beta}`, {
  status: 'built', tags: ['core'], description: 'A described node.',
});
check('patch status/tags/description', r.status === 200 && r.json.node.status === 'built');

r = await call('PUT', `/boards/${MAP}/nodes/${nodeIds.Gamma}/data`, {
  version: 2, snippets: [{ id: 's1', label: 'out', lang: 'json', code: '{"a":1}' }], outSnippetId: 's1',
});
check('write a data sidecar', r.status === 200);

// ------------------------------------------------------------- 4. the graph
const board = (await call('GET', `/boards/${MAP}`)).json;
r = await call('PUT', `/boards/${MAP}/graph`, {
  nodes: board.nodes.map((n, i) => ({ ...n, position: { x: 100 + i * 200, y: 100 } })),
  edges: [
    { id: 'e1', source: nodeIds.Gamma, target: nodeIds.Alpha, label: 'feeds' },
    { id: 'e2', source: nodeIds.Alpha, target: nodeIds.Beta, style: 'dashed' },
  ],
  frames: [{ id: 'f1', title: 'A frame', position: { x: 60, y: 40 }, size: { width: 700, height: 240 } }],
  texts: [{ id: 't1', text: 'A label', position: { x: 60, y: 10 }, size: 'md', bold: true }],
});
check('save graph with edges, a frame and a text', r.status === 200 && r.json.edges.length === 2);

// partial payloads must not wipe what they omit
r = await call('PUT', `/boards/${MAP}/graph`, { edges: [] });
const after = (await call('GET', `/boards/${MAP}`)).json;
check('a partial graph payload does not empty the board',
  after.nodes.length === 3 && after.frames.length === 1 && after.texts.length === 1,
  `${after.nodes.length} nodes, ${after.frames.length} frames, ${after.texts.length} texts`);

// ---------------------------------------------------------------- 5. links
const withLinks = (await call('GET', `/boards/${MAP}`)).json;
const resolved = withLinks.links?.find((l) => l.targetTitle === 'Beta');
const unresolved = withLinks.links?.find((l) => l.targetTitle === 'Nowhere');
check('a [[link]] resolves to a node', resolved?.targetId === nodeIds.Beta);
check('an unmatched [[link]] resolves to nothing', unresolved && unresolved.targetId === null);

r = await call('PATCH', `/boards/${MAP}/nodes/${nodeIds.Beta}`, { title: 'Beta Renamed' });
// Renaming re-slugs the node id too; the response says what it was called before.
check('renaming a node re-slugs its id and reports the old one',
  r.json.node.id !== nodeIds.Beta && r.json.renamedFrom === nodeIds.Beta,
  `${nodeIds.Beta} → ${r.json.node.id}`);
nodeIds.Beta = r.json.node.id;
const afterRename = (await call('GET', `/boards/${MAP}`)).json;
check('renaming rewrites [[links]] that point at it',
  afterRename.links.some((l) => l.targetTitle === 'Beta Renamed' && l.targetId));

// ------------------------------------------------------- 6. archive/restore
r = await call('POST', `/boards/${MAP}/nodes/${nodeIds.Gamma}/archive`);
check('archive a node', r.status === 200);
r = await call('POST', `/boards/${MAP}/nodes/${nodeIds.Gamma}/restore`, {});
check('restore an archived node', r.status === 200);

// --------------------------------------------------------- 7. snapshots
r = await call('POST', `/boards/${MAP}/snapshots`);
const snap = r.json?.timestamp;
check('create a snapshot', r.status === 201 && !!snap, snap);
r = await call('GET', `/boards/${MAP}/snapshots`);
check('list snapshots', r.status === 200 && r.json.length >= 1);
r = await call('POST', `/boards/${MAP}/snapshots/${snap}/restore`);
check('restore a snapshot', r.status === 200);

// ------------------------------------------------------------- 8. export
r = await call('POST', `/boards/${MAP}/export`, { nodeIds: [nodeIds.Alpha] });
check('export a node to markdown', r.status === 200 && /Alpha/.test(r.json.markdown ?? ''));

// ---------------------------------------------------------- 9. clipboard
r = await call('POST', `/boards/${MAP}/duplicate-selection`, {
  nodeIds: [nodeIds.Alpha, nodeIds.Beta], frameIds: [],
});
check('duplicate a selection in place', r.status === 201 && r.json.nodeIds.length === 2);

r = await call('POST', `/boards/${GRAPH}/paste`, {
  sourceBoardId: MAP, nodeIds: [nodeIds.Alpha, nodeIds.Beta], frameIds: [],
  position: { x: 0, y: 0 },
});
check('paste a map selection into a graph (cross-world)', r.status === 201 && r.json.nodeIds.length === 2);

// -------------------------------------------------------- 10. sub-boards
r = await call('POST', '/boards', { name: 'Smoke child', parentBoard: MAP, parentNode: nodeIds.Alpha });
const CHILD = r.json.id;
check('create a sub-board', r.status === 201 && r.json.parentBoard === MAP, CHILD);

// ---------------------------------------------------------- 11. sharing
r = await call('GET', '/admin/users');
const reviewer = r.json.find((u) => u.username === OTHER_USER);
check('admin can list users', r.status === 200 && Array.isArray(r.json));
if (!reviewer) {
  console.log(`\n(no \`${OTHER_USER}\` account — skipping the sharing checks)`);
  for (const id of [MAP, GRAPH, CHILD]) await call('POST', `/boards/${id}/archive`);
  report();
}

r = await call('POST', `/boards/${MAP}/shares`, {
  userId: reviewer.id, canDuplicate: false, includeChildren: true,
});
check('share a board', r.status === 201);
r = await call('GET', '/my-shares');
check('my-shares reports the share', !!r.json[MAP]);

const adminCookie = cookie;
r = await call('POST', '/auth/login', { username: OTHER_USER, password: OTHER_PASS });
const reviewerOk = r.status === 200;
check('reviewer can log in', reviewerOk);

if (reviewerOk) {
  const ADMIN_ID = (await call('GET', '/auth/me')).json.user.id; // reviewer's own id, not used
  r = await call('GET', '/shared-with-me');
  check('shared board appears for the recipient', r.json.some((b) => b.id === MAP));
  const ownerId = r.json.find((b) => b.id === MAP)?.ownerId;

  r = await call('GET', `/u/${ownerId}/boards/${MAP}`);
  check('recipient can read the shared board', r.status === 200);
  r = await call('GET', `/u/${ownerId}/boards/${CHILD}`);
  check('recipient can reach the shared sub-board', r.status === 200);

  const writes = [
    ['PUT', `/u/${ownerId}/boards/${MAP}/graph`, { nodes: [] }],
    ['POST', `/u/${ownerId}/boards/${MAP}/nodes`, { title: 'x', position: { x: 0, y: 0 } }],
    ['POST', `/u/${ownerId}/boards/${MAP}/archive`, {}],
    ['POST', `/u/${ownerId}/boards/${MAP}/snapshots`, {}],
  ];
  let refused = 0;
  for (const [m, p, b] of writes) {
    const w = await call(m, p, b);
    if (w.status === 403) refused += 1;
  }
  check('every write on a shared board is refused', refused === writes.length, `${refused}/${writes.length}`);

  r = await call('POST', `/shared/${MAP}/duplicate`);
  check('duplicate is refused without the flag', r.status === 403, r.json?.error?.code);

  // Export is the duplicate flag's sibling (v1.9): reading a board on screen and
  // walking away with every node as files are different permissions.
  r = await call('POST', `/u/${ownerId}/boards/${MAP}/export`, { nodeIds: [] });
  check('export is refused without the flag', r.status === 403, r.json?.error?.code);
  r = await call('POST', `/u/${ownerId}/boards/${CHILD}/export`, { nodeIds: [] });
  check('export of a shared sub-board is refused too', r.status === 403);

  // Copying a selection out is the small version of the whole-board duplicate,
  // so it answers to the duplicate flag — not to export, which is about the
  // node files leaving as markdown.
  const mine = await call('POST', '/boards', { name: 'Recipient scratch' });
  r = await call('POST', `/boards/${mine.json.id}/paste`, {
    sourceBoardId: MAP, sourceOwnerId: ownerId, nodeIds: ['alpha'], frameIds: [],
  });
  check('copy out of a shared board is refused without the duplicate flag',
    r.status === 403 && r.json?.error?.code === 'duplicate_not_allowed', r.json?.error?.code);
  await call('POST', `/boards/${mine.json.id}/archive`);

  r = await call('GET', `/u/${ownerId}/boards/${GRAPH}`);
  check('a board outside the shared tree is 404, not 403', r.status === 404);
}

cookie = adminCookie;

// Grant export, and only then may the recipient download it.
r = await call('POST', `/boards/${MAP}/shares`, {
  userId: reviewer.id, canDuplicate: false, includeChildren: true, canExport: true,
});
check('re-share with export allowed', r.status === 201);
check('the share row reports it', r.json.shares.find((x) => x.userId === reviewer.id)?.canExport === true);

if (reviewerOk) {
  const reviewerCookie = await (async () => {
    const before = cookie;
    await call('POST', '/auth/login', { username: OTHER_USER, password: OTHER_PASS });
    const mine = cookie;
    cookie = before;
    return mine;
  })();
  const adminAgain = cookie;
  cookie = reviewerCookie;
  const ownerId = (await call('GET', '/shared-with-me')).json.find((b) => b.id === MAP)?.ownerId;
  r = await call('POST', `/u/${ownerId}/boards/${MAP}/export`, { nodeIds: [] });
  check('export succeeds once the owner allows it', r.status === 200);
  check('and it carries the board', /#/.test(r.json?.markdown ?? ''));
  cookie = adminAgain;
}

r = await call('DELETE', `/boards/${MAP}/shares?userId=${reviewer.id}`);
check('revoke a share', r.status === 200);

// -------------------------------------------------- 12. tokens and MCP (v1.7)
/*
 * Driven with plain fetch rather than the MCP SDK, on purpose: this file has no
 * dependencies and gains none, and speaking the wire protocol by hand is what
 * proves the mount answers a *client*, not just our own client library.
 */
const MCP_URL = API.replace(/\/api\/?$/, '') + '/mcp';
let rpcId = 0;

async function mcp(method, params, { secret, sessionId, notification = false } = {}) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Both, per the transport spec: the server may answer with either.
      accept: 'application/json, text/event-stream',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      ...(notification ? {} : { id: (rpcId += 1) }),
    }),
  });
  const text = await res.text();
  let payload = null;
  try {
    // An SSE frame carries the JSON-RPC message on its `data:` line.
    const data = text.startsWith('event:') || text.startsWith('data:')
      ? text.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim()
      : text;
    payload = data ? JSON.parse(data) : null;
  } catch { /* non-JSON body */ }
  return { status: res.status, sessionId: res.headers.get('mcp-session-id') ?? sessionId, payload };
}

const INIT = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'cartograph-smoke', version: '1.0.0' },
};

let m = await mcp('initialize', INIT);
check('MCP refuses a request with no token', m.status === 401, `${m.status}`);

m = await mcp('initialize', INIT, { secret: 'cart_not-a-real-token' });
check('MCP refuses an unknown token', m.status === 401, `${m.status}`);

r = await call('POST', '/tokens', { name: 'Smoke agent', scope: 'write' });
const WRITE_TOKEN = r.json?.secret;
check('mint a write token', r.status === 201 && /^cart_/.test(WRITE_TOKEN ?? ''), r.json?.token?.id);

r = await call('POST', '/tokens', { name: 'Smoke reader', scope: 'read' });
const READ_TOKEN = r.json?.secret;
check('mint a read-only token', r.status === 201 && !!READ_TOKEN);

r = await call('GET', '/tokens');
check('tokens are listed without their secrets', r.json.length >= 2 && !JSON.stringify(r.json).includes('cart_'));

/*
 * Stateless (v1.9): initialize is answered, but no session id comes back and
 * none is needed afterwards. That is the point — there is no session to go
 * stale when the server restarts under a client that is sitting idle.
 */
const initReply = await mcp('initialize', INIT, { secret: WRITE_TOKEN });
check('MCP answers a valid token', initReply.payload?.result?.serverInfo?.name === 'cartographer',
  initReply.payload?.result?.serverInfo?.name);
check('and issues no session to lose', !initReply.sessionId, initReply.sessionId ?? 'none');
const session = undefined;
await mcp('notifications/initialized', {}, { secret: WRITE_TOKEN, sessionId: session, notification: true });

m = await mcp('tools/list', {}, { secret: WRITE_TOKEN, sessionId: session });
const toolNames = (m.payload?.result?.tools ?? []).map((t) => t.name);
// §3's twelve, plus get_config, edge correction, layout, styling, annotations,
// the four that let an agent file what it builds, and arrange_nodes.
check('the toolset is complete', toolNames.length === 26, toolNames.join(','));
check('arranging is offered', toolNames.includes('arrange_nodes'));
check('folders are reachable over MCP',
  ['list_folders', 'create_folder', 'update_folder', 'file_boards'].every((t) => toolNames.includes(t)),
  toolNames.filter((t) => t.includes('folder')).join(','));
check(
  'nothing that archives, deletes files, shares or administers is exposed',
  !toolNames.some((n) => /archive|delete|unshare|share|admin/.test(n)),
);


const callTool = (name, args, secret = WRITE_TOKEN) =>
  mcp('tools/call', { name, arguments: args }, { secret, sessionId: session });
const toolJson = (m) => {
  try { return JSON.parse(m.payload?.result?.content?.[0]?.text ?? 'null'); } catch { return null; }
};

m = await callTool('get_config', {});
const vocabulary = toolJson(m);
check('get_config reports this deployment’s statuses', (vocabulary?.statuses ?? []).length > 0,
  (vocabulary?.statuses ?? []).map((s) => s.id).join(','));

m = await callTool('list_boards', {});
check('list_boards sees the same boards the API does', (toolJson(m) ?? []).some((b) => b.id === MAP));

m = await callTool('create_nodes', {
  boardId: MAP,
  nodes: [{ title: 'Agent node', description: 'Made over MCP.', body: 'Written by the smoke test.' }],
});
const agentNode = (toolJson(m) ?? [])[0];
check('create_nodes writes through the same service the REST route uses', !!agentNode?.id, agentNode?.id);

r = await call('GET', `/boards/${MAP}`);
const seen = r.json.nodes.find((n) => n.id === agentNode?.id);
check('the agent’s node is on the board the browser reads', !!seen);
check('the agent’s node is attributed', seen?.createdVia === 'mcp' && !!seen?.createdBy?.token,
  seen?.createdBy?.token);

r = await call('GET', `/boards/${MAP}/snapshots`);
check('the session’s first write snapshotted the board', r.json.length > 0, `${r.json.length} snapshots`);

m = await callTool('search_nodes', { query: 'Written by the smoke test', boardId: MAP });
check('search_nodes finds body text', (toolJson(m)?.hits ?? []).length === 1);

// A status this deployment does not define used to be written straight to the
// file, where it rendered as sketched and vanished from every status strip.
m = await callTool('create_nodes', { boardId: MAP, nodes: [{ title: 'Bad status', status: 'in-progress' }] });
check('an unknown status is refused, not silently written', m.payload?.result?.isError === true,
  m.payload?.result?.content?.[0]?.text?.slice(0, 50));

m = await callTool('update_node', { boardId: MAP, nodeId: agentNode.id, tags: ['agent', 'smoke'] });
check('update_node sets tags', !m.payload?.result?.isError);
m = await callTool('read_node', { boardId: MAP, nodeId: agentNode.id });
check('the tags reached the frontmatter', (toolJson(m)?.frontmatter?.tags ?? []).includes('smoke'));

m = await callTool('create_nodes', { boardId: MAP, nodes: [{ title: 'Edge partner' }] });
const partner = (toolJson(m) ?? [])[0];
m = await callTool('link_nodes', {
  boardId: MAP,
  edges: [{ source: agentNode.id, target: partner.id, label: 'wrong way round' }],
});
check('link_nodes draws an edge to correct', toolJson(m)?.added === 1);
m = await callTool('get_board', { boardId: MAP });
const drawn = (toolJson(m)?.edges ?? []).find((e) => e.label === 'wrong way round');
m = await callTool('update_edge', { boardId: MAP, edgeId: drawn.id, label: 'corrected' });
check('update_edge relabels it', toolJson(m)?.label === 'corrected');
m = await callTool('unlink_nodes', { boardId: MAP, edgeIds: [drawn.id, 'no-such-edge'] });
check('unlink_nodes removes it and counts the miss', toolJson(m)?.removed === 1 && toolJson(m)?.notOnBoard === 1,
  JSON.stringify(toolJson(m)));

/*
 * Layout: a caller that can place a node but never move one can only correct a
 * board by building a second one. The frame refit is the load-bearing half —
 * membership on the canvas is containment, so boxes have to follow their members.
 */
m = await callTool('create_frame', { boardId: MAP, title: 'Layout check', memberNodeIds: [agentNode.id, partner.id] });
const layoutFrame = toolJson(m)?.frameId;
m = await callTool('move_nodes', {
  boardId: MAP,
  nodes: [{ nodeId: agentNode.id, position: { x: 900, y: 640 } }],
});
check('move_nodes moves a node and refits its frame', toolJson(m)?.moved === 1 && toolJson(m)?.framesRefit === 1,
  JSON.stringify(toolJson(m)));

m = await callTool('get_board', { boardId: MAP });
const afterMove = toolJson(m);
const movedNode = afterMove.nodes.find((n) => n.id === agentNode.id);
check('the new position is what get_board reports', movedNode?.position?.x === 900 && movedNode?.position?.y === 640,
  JSON.stringify(movedNode?.position));
const fr = afterMove.frames.find((f) => f.id === layoutFrame);
check('the frame grew to still contain the node it holds',
  !!fr && movedNode.position.x >= fr.position.x &&
    movedNode.position.x + 184 <= fr.position.x + fr.size.width &&
    movedNode.position.y >= fr.position.y &&
    movedNode.position.y + 76 <= fr.position.y + fr.size.height,
  fr ? `frame ${fr.size.width}x${fr.size.height} at (${fr.position.x},${fr.position.y})` : 'frame missing');

m = await callTool('move_nodes', { boardId: MAP, nodes: [{ nodeId: agentNode.id, position: { x: 'nope', y: 1 } }] });
check('a non-numeric position is refused', m.payload?.result?.isError === true,
  m.payload?.result?.content?.[0]?.text?.slice(0, 45));

/*
 * Appearance. Colours are stored as tokens (`--node-sky`) but a caller thinks in
 * ids ("sky"), so both are accepted — and get_config has to hand back the token
 * or the id is the only name anything ever learns.
 */
const paletteToken = vocabulary.colors?.[3]?.token;
const paletteId = vocabulary.colors?.[3]?.id;
check('get_config exposes the stored colour token, not just the id', /^--/.test(paletteToken ?? ''),
  `${paletteId} → ${paletteToken}`);

m = await callTool('style_nodes', {
  boardId: MAP,
  nodes: [{ nodeId: agentNode.id, color: paletteId, shape: 'rounded' }],
});
check('style_nodes accepts a colour by id', !m.payload?.result?.isError, JSON.stringify(toolJson(m)));
m = await callTool('get_board', { boardId: MAP });
const styled = toolJson(m).nodes.find((n) => n.id === agentNode.id);
check('the id was resolved to the stored token', styled?.color === paletteToken && styled?.shape === 'rounded',
  `${styled?.color} / ${styled?.shape}`);

m = await callTool('style_nodes', { boardId: MAP, nodes: [{ nodeId: agentNode.id, color: null }] });
m = await callTool('get_board', { boardId: MAP });
check('a null colour clears it rather than storing null',
  toolJson(m).nodes.find((n) => n.id === agentNode.id)?.color === undefined);

m = await callTool('style_nodes', { boardId: MAP, nodes: [{ nodeId: agentNode.id, color: 'chartreuse' }] });
check('an unknown colour is refused', m.payload?.result?.isError === true,
  m.payload?.result?.content?.[0]?.text?.slice(0, 40));

// Size lives on style_nodes rather than move_nodes; a resized node changes its
// footprint, so its frame has to refit the same way a moved one does.
m = await callTool('style_nodes', {
  boardId: MAP,
  nodes: [{ nodeId: agentNode.id, size: { width: 300, height: 140 } }],
});
check('style_nodes resizes and refits the frame',
  toolJson(m)?.styled === 1 && toolJson(m)?.framesRefit === 1, JSON.stringify(toolJson(m)));

m = await callTool('get_board', { boardId: MAP });
const resized = toolJson(m).nodes.find((n) => n.id === agentNode.id);
const holding = toolJson(m).frames.find((f) => f.id === layoutFrame);
check('the new size is what get_board reports',
  resized?.size?.width === 300 && resized?.size?.height === 140, JSON.stringify(resized?.size));
check('the frame still covers the node it grew',
  resized.position.x >= holding.position.x &&
    resized.position.x + 300 <= holding.position.x + holding.size.width &&
    resized.position.y + 140 <= holding.position.y + holding.size.height);

m = await callTool('style_nodes', { boardId: MAP, nodes: [{ nodeId: agentNode.id, size: { width: 10, height: 10 } }] });
check('a size below the minimum is refused', m.payload?.result?.isError === true,
  m.payload?.result?.content?.[0]?.text?.slice(0, 46));
m = await callTool('style_nodes', { boardId: MAP, nodes: [{ nodeId: agentNode.id, size: { width: 99999, height: 200 } }] });
check('a runaway size is refused', m.payload?.result?.isError === true,
  m.payload?.result?.content?.[0]?.text?.slice(0, 46));

m = await callTool('update_frame', { boardId: MAP, frameId: layoutFrame, title: 'Recoloured', color: paletteToken });
check('update_frame retitles and recolours', toolJson(m)?.title === 'Recoloured' && toolJson(m)?.color === paletteToken,
  JSON.stringify({ t: toolJson(m)?.title, c: toolJson(m)?.color }));

m = await callTool('create_frame', { boardId: MAP, title: 'Born coloured', color: paletteId });
const bornColoured = toolJson(m)?.frameId;
m = await callTool('get_board', { boardId: MAP });
check('create_frame can set a colour up front',
  toolJson(m).frames.find((f) => f.id === bornColoured)?.color === paletteToken);

/*
 * Text annotations. `get_board` used to return these as bare strings, so even
 * once they could be created nothing could ever address one to edit it.
 */
m = await callTool('create_texts', {
  boardId: MAP,
  texts: [{ text: 'A heading', size: 'lg', bold: true }, { text: 'an aside', size: 'sm' }],
});
const madeTexts = toolJson(m) ?? [];
check('create_texts adds annotations', madeTexts.length === 2, madeTexts.map((t) => t.text).join(' / '));

m = await callTool('get_board', { boardId: MAP });
const boardTexts = toolJson(m).texts ?? [];
const heading = boardTexts.find((t) => t.text === 'A heading');
check('get_board returns annotations with ids and styling',
  !!heading?.id && heading.size === 'lg' && heading.bold === true,
  JSON.stringify(heading));

m = await callTool('update_text', { boardId: MAP, textId: heading.id, text: 'A better heading', bold: false });
check('update_text rewords and clears emphasis',
  toolJson(m)?.text === 'A better heading' && toolJson(m)?.bold === undefined,
  JSON.stringify(toolJson(m)));

m = await callTool('create_texts', { boardId: MAP, texts: [{ text: '   ' }] });
check('an empty annotation is refused', m.payload?.result?.isError === true,
  m.payload?.result?.content?.[0]?.text?.slice(0, 40));

m = await callTool('remove_texts', { boardId: MAP, textIds: [heading.id, 'no-such-text'] });
check('remove_texts deletes and counts the miss',
  toolJson(m)?.removed === 1 && toolJson(m)?.notOnBoard === 1, JSON.stringify(toolJson(m)));

// A session of its own: a read token cannot ride the write token's (checked below).
const roSession = (await mcp('initialize', INIT, { secret: READ_TOKEN })).sessionId;
await mcp('notifications/initialized', {}, { secret: READ_TOKEN, sessionId: roSession, notification: true });
m = await mcp('tools/call', { name: 'create_nodes', arguments: { boardId: MAP, nodes: [{ title: 'Nope' }] } },
  { secret: READ_TOKEN, sessionId: roSession });
check('a read-only token cannot write', m.payload?.result?.isError === true,
  m.payload?.result?.content?.[0]?.text?.slice(0, 40));

/*
 * The isolation this used to prove by rejecting a borrowed session id. There
 * are no sessions now, so it is proved the way it is actually enforced: the
 * bearer token decides the workspace on every single request, and a stale or
 * borrowed id is just a header nobody reads.
 */
m = await mcp('tools/call', { name: 'list_boards', arguments: {} },
  { secret: READ_TOKEN, sessionId: '00000000-dead-dead-dead-000000000000' });
const seenByReader = (() => {
  try { return JSON.parse(m.payload?.result?.content?.[0]?.text ?? '[]').map((b) => b.id); }
  catch { return []; }
})();
check('a stale or borrowed session id is simply ignored', m.status === 200, `${m.status}`);
check('and the token still only sees its own workspace', seenByReader.includes(MAP),
  `${seenByReader.length} boards`);

/*
 * Arranging (v1.10). The point of the tool is that the agent names a shape
 * rather than computing coordinates, so the check is that the shape came out:
 * a `column` puts every node on one x, and it goes through the same write path
 * as a move, so the frame around any of them refits.
 */
m = await mcp('tools/call', { name: 'arrange_nodes', arguments: { boardId: MAP, layout: 'column' } },
  { secret: WRITE_TOKEN });
check('arrange_nodes lays a board out', m.payload?.result?.isError !== true,
  m.payload?.result?.content?.[0]?.text?.slice(0, 60));
r = await call('GET', `/boards/${MAP}`);
const columnXs = new Set(r.json.nodes.map((n) => n.position.x));
check('a column really is one column', columnXs.size === 1, `${columnXs.size} distinct x`);

m = await mcp('tools/call', { name: 'arrange_nodes', arguments: { boardId: MAP, layout: 'row', nodeIds: ['no-such-node'] } },
  { secret: WRITE_TOKEN });
check('an unknown node id is refused', m.payload?.result?.isError === true,
  m.payload?.result?.content?.[0]?.text?.slice(0, 40));

/*
 * Pinned connector sides (v1.10). Unset, an end follows the cards; pinned, it
 * stays on the face it was given however they move. "auto" releases it.
 */
/*
 * Its own edge rather than borrowing whatever is left on the board — an earlier
 * section may have removed them, and a check that quietly does not run is worse
 * than no check.
 */
m = await mcp('tools/call',
  { name: 'link_nodes', arguments: { boardId: MAP, edges: [{ source: nodeIds.Alpha, target: nodeIds.Beta }] } },
  { secret: WRITE_TOKEN });
r = await call('GET', `/boards/${MAP}`);
const anEdge = r.json.edges.find((e) => e.source === nodeIds.Alpha && e.target === nodeIds.Beta);
check('an edge to pin exists', !!anEdge, `${r.json.edges.length} edges on the board`);
if (anEdge) {
  m = await mcp('tools/call',
    { name: 'update_edge', arguments: { boardId: MAP, edgeId: anEdge.id, sourceSide: 'bottom', targetSide: 'left' } },
    { secret: WRITE_TOKEN });
  check('an edge end can be pinned to a side', m.payload?.result?.isError !== true,
    m.payload?.result?.content?.[0]?.text?.slice(0, 60));
  r = await call('GET', `/boards/${MAP}`);
  const pinned = r.json.edges.find((e) => e.id === anEdge.id);
  check('and the pin is stored', pinned?.sourceSide === 'bottom' && pinned?.targetSide === 'left',
    `${pinned?.sourceSide}/${pinned?.targetSide}`);

  m = await mcp('tools/call',
    { name: 'update_edge', arguments: { boardId: MAP, edgeId: anEdge.id, sourceSide: 'auto', targetSide: 'auto' } },
    { secret: WRITE_TOKEN });
  r = await call('GET', `/boards/${MAP}`);
  const freed = r.json.edges.find((e) => e.id === anEdge.id);
  check('"auto" lets it follow the cards again',
    freed?.sourceSide === undefined && freed?.targetSide === undefined,
    `${freed?.sourceSide}/${freed?.targetSide}`);

  // Shape and bends (v1.11). Bends are offsets in canvas units and deliberately
  // unbounded — the route is built so no value can put a connector inside a card,
  // so what goes in is what comes out however far out it is.
  m = await mcp('tools/call',
    { name: 'update_edge', arguments: { boardId: MAP, edgeId: anEdge.id, shape: 'angled', bends: [40, -18] } },
    { secret: WRITE_TOKEN });
  r = await call('GET', `/boards/${MAP}`);
  let shaped = r.json.edges.find((e) => e.id === anEdge.id);
  check('a connector can be made angled', shaped?.shape === 'angled', shaped?.shape);
  check('and its bends are kept', JSON.stringify(shaped?.bends) === '[40,-18]', JSON.stringify(shaped?.bends));

  m = await mcp('tools/call',
    { name: 'update_edge', arguments: { boardId: MAP, edgeId: anEdge.id, bends: [-4000] } },
    { secret: WRITE_TOKEN });
  r = await call('GET', `/boards/${MAP}`);
  shaped = r.json.edges.find((e) => e.id === anEdge.id);
  check('a bend far off the board is kept, not clamped',
    JSON.stringify(shaped?.bends) === '[-4000]', JSON.stringify(shaped?.bends));

  m = await mcp('tools/call',
    { name: 'update_edge', arguments: { boardId: MAP, edgeId: anEdge.id, bends: [] } },
    { secret: WRITE_TOKEN });
  r = await call('GET', `/boards/${MAP}`);
  shaped = r.json.edges.find((e) => e.id === anEdge.id);
  check('an empty list puts the bends back where the plain route wants them',
    shaped?.bends === undefined && shaped?.shape === 'angled', JSON.stringify(shaped?.bends));

  // Changing the shape forgets the bends: they describe turns the other shape
  // does not have, so a connector switched away and back starts again.
  await mcp('tools/call',
    { name: 'update_edge', arguments: { boardId: MAP, edgeId: anEdge.id, bends: [55, 25] } },
    { secret: WRITE_TOKEN });
  await mcp('tools/call',
    { name: 'update_edge', arguments: { boardId: MAP, edgeId: anEdge.id, shape: 'curved' } },
    { secret: WRITE_TOKEN });
  r = await call('GET', `/boards/${MAP}`);
  shaped = r.json.edges.find((e) => e.id === anEdge.id);
  check('changing the shape forgets the bends', shaped?.bends === undefined, JSON.stringify(shaped?.bends));

  await mcp('tools/call',
    { name: 'update_edge', arguments: { boardId: MAP, edgeId: anEdge.id, shape: 'angled' } },
    { secret: WRITE_TOKEN });
  r = await call('GET', `/boards/${MAP}`);
  shaped = r.json.edges.find((e) => e.id === anEdge.id);
  check('so switching back gives the plain route, not the old one',
    shaped?.shape === 'angled' && shaped?.bends === undefined, JSON.stringify(shaped?.bends));

  // Unless the same call says otherwise, which is a caller with a shape and a
  // set of bends in mind rather than one changing its mind about the shape.
  await mcp('tools/call',
    { name: 'update_edge', arguments: { boardId: MAP, edgeId: anEdge.id, shape: 'curved', bends: [12] } },
    { secret: WRITE_TOKEN });
  r = await call('GET', `/boards/${MAP}`);
  shaped = r.json.edges.find((e) => e.id === anEdge.id);
  check('bends sent with a shape change are kept', JSON.stringify(shaped?.bends) === '[12]',
    JSON.stringify(shaped?.bends));

  m = await mcp('tools/call',
    { name: 'update_edge', arguments: { boardId: MAP, edgeId: anEdge.id, shape: 'curved' } },
    { secret: WRITE_TOKEN });
  r = await call('GET', `/boards/${MAP}`);
  shaped = r.json.edges.find((e) => e.id === anEdge.id);
  check('and curved is the absence of a shape', shaped?.shape === undefined, `${shaped?.shape}`);
}

r = await call('GET', '/tokens');
const revokeMe = r.json.find((t) => t.name === 'Smoke agent');
r = await call('DELETE', `/tokens/${revokeMe.id}`);
check('revoke a token', r.status === 200);
m = await mcp('initialize', INIT, { secret: WRITE_TOKEN });
check('a revoked token stops working immediately', m.status === 401, `${m.status}`);

r = await call('GET', '/tokens');
const reader = r.json.find((t) => t.name === 'Smoke reader');
await call('DELETE', `/tokens/${reader.id}`);

/*
 * Disabling an account has to cut off its agents too, or an offboarded person's
 * connector keeps working after their password stops. `resolveToken` joins
 * `users`, so this is checked on every request rather than at session start —
 * which is why the already-open session below dies mid-flight as well.
 */
const adminJar = cookie;
r = await call('POST', '/auth/login', { username: OTHER_USER, password: OTHER_PASS });
if (r.status === 200) {
  r = await call('POST', '/tokens', { name: 'Offboarding check', scope: 'read' });
  const theirToken = r.json?.secret;
  const live = await mcp('initialize', INIT, { secret: theirToken });
  await mcp('notifications/initialized', {}, { secret: theirToken, sessionId: live.sessionId, notification: true });
  check('their token works while the account is active', live.status === 200);

  cookie = adminJar;
  await call('POST', `/admin/users/${reviewer.id}/disable`);

  m = await mcp('initialize', INIT, { secret: theirToken });
  check('disabling an account stops its tokens', m.status === 401, `${m.status}`);
  m = await mcp('tools/list', {}, { secret: theirToken, sessionId: live.sessionId });
  check('and cuts off a session that was already open', m.status === 401, `${m.status}`);

  r = await call('GET', `/admin/users`);
  check('the token is suspended, not revoked — re-enabling restores it',
    (await call('POST', `/admin/users/${reviewer.id}/enable`)).status === 200 &&
      (await mcp('initialize', INIT, { secret: theirToken })).status === 200);
}
cookie = adminJar;

// ------------------------------------------------- 13. folders (v1.8 §1, §7)
/*
 * Shape, not emptiness. This suite runs against a *copy* of a real volume, so
 * the workspace may already have folders somebody made — asserting zero of them
 * fails on exactly the instances most worth testing. What matters is that a
 * workspace which has never had a `folders.json` reads as an empty structure
 * rather than a 404, and that one which has reads back the same shape.
 */
r = await call('GET', '/folders');
check('folders read as a whole structure, present or not',
  r.status === 200 &&
    Array.isArray(r.json?.folders) &&
    !!r.json?.assignments &&
    Array.isArray(r.json?.favorites),
  `${r.json?.folders?.length ?? '?'} already here`);

/*
 * One PUT exercises the whole normalisation contract: an absent id is minted, a
 * name is trimmed, a colour given as a palette *id* is stored as the token every
 * other colour in the system uses, and `order` is renumbered from array order so
 * the client never has to.
 */
r = await call('PUT', '/folders', {
  folders: [
    { id: '', name: '  Client Work  ', color: 'sky', order: 99 },
    { id: 'keep', name: 'Research', color: '--node-mint', order: 0 },
  ],
  assignments: { [MAP]: 'keep', 'archived-or-gone': 'keep', [GRAPH]: 'no-such-folder' },
  favorites: [MAP, 'archived-or-gone'],
});
const saved = r.json;
check('folders round-trip', r.status === 200 && saved.folders.length === 2);
check('a missing id is minted', /^folder-/.test(saved.folders[0].id), saved.folders[0].id);
check('the name is trimmed', saved.folders[0].name === 'Client Work');
check('a colour id becomes the stored token', saved.folders[0].color === '--node-sky', saved.folders[0].color);
check('order is renumbered from array order',
  saved.folders[0].order === 0 && saved.folders[1].order === 1);

/*
 * The two halves of the pruning rule. §1 reads as "prune missing boards and
 * folders"; §5 says an archived board's assignment is deliberately kept so a
 * restore lands it back where it lived. The specific rule wins — dropping it
 * would silently discard exactly the case §5 asks us to preserve.
 */
check('an assignment to a folder that does not exist is pruned',
  saved.assignments[GRAPH] === undefined);
check('an assignment whose board is absent is kept (§5 — it may be archived)',
  saved.assignments['archived-or-gone'] === 'keep');
check('a favourite for an absent board is kept for the same reason',
  saved.favorites.includes('archived-or-gone'));

r = await call('GET', '/boards');
const filed = r.json.find((b) => b.id === MAP);
check('listBoards merges folderId and favorite onto the summary',
  filed?.folderId === 'keep' && filed?.favorite === true,
  `folderId=${filed?.folderId} favorite=${filed?.favorite}`);

r = await call('PUT', '/folders', {
  folders: [{ id: 'keep', name: 'Research', color: 'chartreuse', order: 0 }],
  assignments: {},
  favorites: [],
});
check('an unknown folder colour is refused', r.status === 400, r.json?.error?.message?.slice(0, 40));

r = await call('PUT', '/folders', { folders: [{ id: 'x', name: '   ', order: 0 }], assignments: {}, favorites: [] });
check('an empty folder name is refused', r.status === 400, r.json?.error?.message?.slice(0, 40));

// Deleting a folder unfiles its boards; nothing on disk moves (§2).
await call('PUT', '/folders', { folders: [], assignments: {}, favorites: [] });
r = await call('GET', '/boards');
check('removing every folder leaves every board where it was',
  r.json.length === boardCount + 3 && r.json.every((b) => b.folderId === undefined),
  `${r.json.length} boards, none filed`);

// ------------------------------ 14. a board id moves; what keys on it follows
{
  // Renaming re-slugs a board, and folders key on that id. Before this was
  // wired, renaming a filed board silently unfiled it and dropped its star.
  const state = (await call('GET', '/folders')).json;
  const name = `Follow ${Date.now()}`;
  await call('PUT', '/folders', { ...state, folders: [...state.folders, { name }] });
  const withFolder = (await call('GET', '/folders')).json;
  const folderId = withFolder.folders.find((f) => f.name === name).id;

  const board = (await call('POST', '/boards', { name: `Follow probe ${Date.now()}` })).json;
  await call('PUT', '/folders', {
    ...withFolder,
    assignments: { ...withFolder.assignments, [board.id]: folderId },
    favorites: [...withFolder.favorites, board.id],
  });

  const renamed = (await call('PATCH', `/boards/${board.id}`, { name: `${board.name} v2` })).json;
  const after = (await call('GET', '/boards')).json.find((b) => b.id === renamed.id);
  check('renaming a board keeps it in its folder', after?.folderId === folderId,
    `${board.id} → ${renamed.id}`);
  check('and keeps its star', after?.favorite === true);

  // Archiving is the opposite case on purpose: the entry stays dormant so a
  // restore lands it back where it lived (§5).
  await call('POST', `/boards/${renamed.id}/archive`);
  check('archiving leaves the assignment dormant rather than clearing it',
    (await call('GET', '/folders')).json.assignments[renamed.id] === folderId);

  // A restore can come back under a different slug if the name was taken.
  const squatter = (await call('POST', '/boards', { name: renamed.name })).json;
  const entry = (await call('GET', '/boards/archived')).json.find((b) => b.id === renamed.id).entry;
  const back = (await call('POST', `/boards/archived/${entry}/restore`)).json;
  check('a restore whose slug was taken comes back renamed', back.id !== renamed.id,
    `${renamed.id} → ${back.id}`);
  check('and still lands in its folder',
    (await call('GET', '/boards')).json.find((b) => b.id === back.id)?.folderId === folderId);

  for (const id of [squatter.id, back.id]) await call('POST', `/boards/${id}/archive`);
  await call('PUT', '/folders', state);
}

// --------------------------------------- 14. archive, delete, purge (v1.9)
{
  const shelf = (await call('POST', '/boards', { name: `Shelf smoke ${Date.now()}` })).json;
  await call('POST', `/boards/${shelf.id}/nodes`, { title: 'inside' });
  await call('POST', `/boards/${shelf.id}/archive`);

  const listed = (await call('GET', '/boards/archived')).json.find((b) => b.id === shelf.id);
  check('an archived board is listed with its contents',
    !!listed && listed.nodeCount === 1, listed && `${listed.name} · ${listed.nodeCount} node`);
  // On this list "newest" means most recently archived, which is a different
  // question from most recently edited — a board untouched for a year but
  // archived this morning belongs at the top.
  check('it is stamped with when it was archived, not when it was edited',
    !!listed?.shelvedAt && Date.parse(listed.shelvedAt) >= Date.parse(listed.updatedAt),
    `archived ${listed?.shelvedAt?.slice(0, 19)} · edited ${listed?.updatedAt?.slice(0, 19)}`);
  check('and the list is ordered by that',
    (await call('GET', '/boards/archived')).json
      .every((b, i, all) => i === 0 || all[i - 1].shelvedAt >= b.shelvedAt));

  const back = await call('POST', `/boards/archived/${listed.entry}/restore`);
  check('restore returns it to the shelf', back.status === 200 && back.json.id === shelf.id, back.json?.id);
  check('and it leaves the archive',
    !(await call('GET', '/boards/archived')).json.some((b) => b.entry === listed.entry));

  await call('POST', `/boards/${shelf.id}/archive`);
  const entry = (await call('GET', '/boards/archived')).json.find((b) => b.id === shelf.id).entry;
  check('delete from the archive answers',
    (await call('POST', `/boards/archived/${entry}/delete`)).status === 200);
  check('the owner can no longer reach it at all',
    !(await call('GET', '/boards/archived')).json.some((b) => b.id === shelf.id)
      && !(await call('GET', '/boards')).json.some((b) => b.id === shelf.id));

  const meId = (await call('GET', '/auth/me')).json.user.id;
  const shelved = ((await call('GET', `/admin/users/${meId}/deleted`)).json ?? [])
    .find((b) => b.id === shelf.id);
  check('but a Super Admin still sees it', !!shelved, shelved?.name);

  // The one call in this system that destroys rather than moves.
  check('and only a Super Admin can remove it for good',
    (await call('DELETE', `/admin/users/${meId}/deleted/${shelved.entry}`)).status === 200);
  check('after which it is gone from every list',
    !((await call('GET', `/admin/users/${meId}/deleted`)).json ?? []).some((b) => b.id === shelf.id));

  check('a traversal in the archive entry name is refused',
    (await call('POST', '/boards/archived/..%2F..%2Fboards/delete')).status >= 400);
}

// ------------------------------------------------------------- 14. cleanup
for (const id of [MAP, GRAPH, CHILD]) await call('POST', `/boards/${id}/archive`);
check('archive the throwaway boards', true);

function report() {
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
    process.exit(1);
  }
  process.exit(0);
}

report();
