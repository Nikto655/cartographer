/**
 * Seeds "Cartographer Architecture" — a map of this app, built with this app.
 * Everything goes through the public API, so the map is created the same way a
 * person would create it.
 *
 *   SEED_PASS=… node scripts/seed-architecture.mjs
 *   API=http://host:3000/api SEED_PASS=… node scripts/seed-architecture.mjs
 */
import { call, signIn } from './lib/client.mjs';

await signIn();


const board = await call('POST', '/boards', { name: 'Cartographer Architecture' });
const B = board.id;
console.log('board:', B);

const node = async (title, position) =>
  (await call('POST', `/boards/${B}/nodes`, { title, position })).id;
const body = (id, text) => call('PUT', `/boards/${B}/nodes/${id}/body`, { body: text });
const data = (id, payload) => call('PUT', `/boards/${B}/nodes/${id}/data`, payload);
const patch = (id, payload) => call('PATCH', `/boards/${B}/nodes/${id}`, payload);

const snippet = (id, label, lang, code) => ({ id, label, lang, code });
const sidecar = (snippets, outId) => ({ version: 2, snippets, outSnippetId: outId ?? null });

// ---------------------------------------------------------------- the nodes
const ids = {};
const place = async (key, title, x, y) => {
  ids[key] = await node(title, { x, y });
};

// Disk
await place('boardJson', 'board.json', 110, 290);
await place('nodeMd', 'node.md', 110, 430);
await place('sidecarFile', 'node.data.json', 110, 570);
await place('archive', 'archive/', 110, 706);
await place('snapshotsDir', 'snapshots/', 110, 754);
await place('configFile', 'config.json', 110, 802);

// Server core
await place('storage', 'core/storage.ts', 550, 290);
await place('markdown', 'core/markdown.ts', 550, 430);
await place('dataCore', 'core/data.ts', 550, 570);
await place('configCore', 'core/config.ts', 550, 706);

// Server modules
await place('boardsMod', 'modules/boards', 990, 290);
await place('nodesMod', 'modules/nodes', 990, 430);
await place('framesMod', 'modules/frames', 990, 570);
await place('snapshotsMod', 'modules/snapshots', 990, 706);
await place('exportMod', 'modules/export', 990, 754);

// HTTP
await place('getBoard', 'GET /api/boards/:id', 1430, 290);
await place('putGraph', 'PUT /api/boards/:id/graph', 1430, 430);
await place('nodeRoutes', 'Node routes', 1430, 570);

// Client
await place('apiClient', 'shared/api.ts', 1820, 290);
await place('store', 'shared/store.ts', 1820, 430);
await place('canvas', 'Canvas (React Flow)', 1820, 596);
await place('panel', 'Node panel', 1820, 736);

// Shared types, sitting between the two halves
await place('sharedPkg', 'packages/shared', 1180, 950);

// ------------------------------------------------------------------ content
await patch(ids.boardJson, {
  description: 'The graph. Presentation only — never meaning.',
  tags: ['storage'],
});
await body(
  ids.boardJson,
  `One file per map: \`data/boards/<map-id>/board.json\`.

It holds **where things are**, not what they say:

- \`nodes[]\` — id, position, size, shape, colour, status, variant, frameId, childBoards
- \`edges[]\` — source, target, label, style
- \`frames[]\` and \`texts[]\` — canvas furniture with no file behind them
- \`viewport\` — where you left the camera

\`title\` and \`status\` also live here as a display cache. On load the server
re-reads every node file and the **file wins** — board.json can never lie for long.
`,
);
await data(
  ids.boardJson,
  sidecar(
    [
      snippet(
        'a-board',
        'board.json',
        'json',
        `{
  "id": "checkout-flow",
  "name": "Checkout Flow",
  "nodes": [
    { "id": "payment-screen", "title": "Payment Screen",
      "position": { "x": 470, "y": 286 }, "size": { "width": 210, "height": 116 },
      "shape": "rounded", "status": "built", "frameId": "frame-signup" }
  ],
  "edges": [{ "id": "e4", "source": "payment-screen", "target": "charge-card" }],
  "frames": [], "texts": [], "viewport": { "x": 24, "y": 12, "zoom": 0.62 }
}`,
      ),
    ],
    'a-board',
  ),
);

await patch(ids.nodeMd, { description: 'Your prose. Readable without this app.', tags: ['storage'] });
await body(
  ids.nodeMd,
  `\`data/boards/<map-id>/nodes/<node-id>.md\` — one file per node.

Frontmatter carries the small structured bits; everything after it is yours.
Unknown keys are preserved on write, so anything a future version adds survives
a save by an older one.

The filename follows the title (renames move the file), while the \`id\` inside
stays put once the node has content — so history survives a rename.
`,
);
await data(
  ids.nodeMd,
  sidecar(
    [
      snippet(
        'a-md',
        'node.md',
        'md',
        `---
id: payment-screen
title: Payment Screen
created: '2026-07-26'
status: documented
tags: [auth, core]
description: Collects card details and validates them client-side.
---

Free-form notes. Pure prose, no app conventions inside the body.`,
      ),
    ],
    'a-md',
  ),
);

await patch(ids.sidecarFile, {
  description: 'Optional sidecar: labelled snippets, one marked as the output.',
  tags: ['storage'],
});
await body(
  ids.sidecarFile,
  `\`<node-id>.data.json\`, written only when a node actually has snippets.
Empty it and the file is deleted.

Schema v2 is a list of labelled snippets plus \`outSnippetId\` — the one this node
passes downstream. There is no stored "input": a node's **Incoming** list is
computed from the graph every time it is read, so it cannot drift from the
upstream truth.

v1 files (\`out\` / \`in\` objects) migrate on first read and are written back once.
`,
);
await data(
  ids.sidecarFile,
  sidecar(
    [
      snippet(
        'a-side',
        'sidecar v2',
        'json',
        `{
  "version": 2,
  "snippets": [
    { "id": "s1", "label": "session payload", "lang": "json",
      "code": "{ \\"userId\\": \\"string\\" }" }
  ],
  "outSnippetId": "s1"
}`,
      ),
    ],
    'a-side',
  ),
);

await body(ids.archive, 'Every removal lands here — nodes, maps, whole folders. Recover with `mv`.\n');
await body(ids.snapshotsDir, 'Manual folder copies: `snapshots/<map>/<timestamp>/`. Restore snapshots first.\n');
await body(ids.configFile, 'Optional. Statuses, shapes, colours, theme — merged over the built-in defaults.\n');

await patch(ids.storage, {
  description: 'The only module that touches the filesystem.',
  tags: ['core'],
});
await body(
  ids.storage,
  `Every read and write in the app funnels through here. Nothing else imports \`node:fs\`.

- **Atomic writes** — content goes to a temp file, then \`rename\`. A crash can never
  leave half a file.
- **Path guards** — \`safeId\` rejects anything that is not a plain slug, so a request
  can never escape the data directory.
- **Slugs** — \`slugify\` + \`uniqueSlug\` allocate ids that are also filenames.
- **Archive** — moves a path under \`/data/archive\`, suffixing on collision.
`,
);
await data(
  ids.storage,
  sidecar(
    [
      snippet(
        'a-atomic',
        'atomic write',
        'ts',
        `export async function writeText(file: string, content: string) {
  await ensureDir(path.dirname(file));
  const tmp = \`\${file}.\${process.pid}.\${Date.now()}.tmp\`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);   // atomic on the same volume
}`,
      ),
    ],
    'a-atomic',
  ),
);

await patch(ids.markdown, { description: 'Frontmatter in, frontmatter out — losslessly.', tags: ['core'] });
await body(
  ids.markdown,
  `gray-matter, wrapped so the rest of the server never sees YAML.

- \`parseNodeFile\` fills in defaults for a hand-written file rather than throwing.
- \`serializeNodeFile\` writes the required keys in a stable order, then any unknown
  keys it was given — forward compatibility for free.
- \`coverageOf\` is the whole of the "hollow node" rule: body trimmed, non-empty.
- \`validateRawNodeFile\` guards raw-mode saves so a bad edit can't corrupt a map.
`,
);

await patch(ids.dataCore, { description: 'Sidecar v2, and the lazy migration into it.', tags: ['core'] });
await body(
  ids.dataCore,
  `Normalises whatever is on disk into schema v2, and writes v1 files back once in
the new shape. An \`outSnippetId\` pointing at a deleted snippet is dropped, so the
"passes data" flag can never be a lie.

\`outputSnippet(data)\` is the single source for the ⌁ marker, the violet edges and
every **Incoming** list.
`,
);

await body(ids.configCore, 'Reads `/data/config.json` if present and merges it over the defaults in `packages/shared`.\n');

await patch(ids.boardsMod, {
  description: 'Map-level operations, and the autosave endpoint.',
  tags: ['server'],
});
await body(
  ids.boardsMod,
  `\`getBoard\` is where the two halves of storage are reconciled: it walks every node
file, takes \`title\`, \`status\` and \`description\` from the frontmatter, and computes
\`hasData\`, \`passesData\` and \`coverage\`. If board.json disagreed, it is rewritten.

\`saveGraph\` is the write half — it merges incoming positions and styles onto the
nodes it already knows, persists frames and texts verbatim, drops edges whose ends
have gone, and pushes any changed title or status back down into the frontmatter.

Renaming a map re-slugs the folder and repoints every reference to it.
`,
);

await patch(ids.nodesMod, {
  description: 'One function per semantic operation on a node.',
  tags: ['server'],
});
await body(
  ids.nodesMod,
  `A node is a file pair plus an entry in board.json, so every operation here is
multi-file and happens in one place:

- **create** — write \`.md\`, append to board.json
- **rename** — move the pair to the new slug, update the node id, rewrite every edge
  that referenced it; the frontmatter \`id\` stays as history
- **archive / restore** — move the pair to \`/data/archive\` and strip edges, or move
  it back and re-register the node
- **link / unlink sub-map** — write both the parent's \`childBoards\` and the child's
  \`parentBoard\` together

\`getNodeContent\` also computes \`incoming\` by walking the map's edges and reading
each upstream node's marked output.
`,
);

await patch(ids.framesMod, { description: 'Promote a frame into a map of its own.', tags: ['server'] });
await body(
  ids.framesMod,
  `The one operation that restructures two maps at once, so it is careful:

1. take a snapshot (this is not undoable from the canvas)
2. stage both maps' JSON in memory
3. only then move the member files into the new map
4. leave a drill-down node behind, with crossing edges re-pointed to it
`,
);
await body(ids.snapshotsMod, 'Copy the map folder to `snapshots/<map>/<ts>/`. Restore snapshots the current state first.\n');
await body(ids.exportMod, 'Walks nodes depth-first into one markdown doc; `descend` follows sub-maps a heading deeper.\n');

await patch(ids.getBoard, { description: 'Read a whole map, with computed flags.', tags: ['api'] });
await body(
  ids.getBoard,
  `Returns the \`Board\`: nodes with their per-node flags, edges, frames, texts and
viewport. This is the only call the canvas needs to draw a map.
`,
);
await data(
  ids.getBoard,
  sidecar(
    [
      snippet(
        'a-getboard',
        'Board (computed)',
        'ts',
        `interface BoardNode {
  id: string; title: string; description?: string;
  position: { x: number; y: number }; size: { width: number; height: number };
  shape: NodeShape; color?: string; status: NodeStatus;
  variant?: 'card' | 'chip'; frameId?: string; childBoards?: string[];
  hasData?: boolean; passesData?: boolean;   // server-computed
  coverage?: 'empty' | 'written';            // server-computed
}`,
      ),
    ],
    'a-getboard',
  ),
);

await patch(ids.putGraph, { description: 'The autosave endpoint. Last write wins.', tags: ['api'] });
await body(
  ids.putGraph,
  `The client debounces canvas changes by one second and PUTs the whole graph.
Idempotent, and safe to repeat — acceptable because this is a single-user tool.

The server refuses to create nodes here: anything it doesn't already know is
ignored, so a stale client can't resurrect an archived node.
`,
);
await data(
  ids.putGraph,
  sidecar(
    [
      snippet(
        'a-graph',
        'GraphPayload',
        'ts',
        `interface GraphPayload {
  nodes: BoardNode[];
  edges: BoardEdge[];
  frames?: BoardFrame[];   // absent = left as-is
  texts?: BoardText[];
  viewport?: { x: number; y: number; zoom: number };
}`,
      ),
    ],
    'a-graph',
  ),
);

await patch(ids.nodeRoutes, { description: 'Everything that touches one node.', tags: ['api'] });
await body(
  ids.nodeRoutes,
  `\`\`\`
POST   /boards/:id/nodes                 create
GET    /boards/:id/nodes/:nodeId         content + incoming
PUT    .../body                          notes (800ms debounce)
PUT    .../data                          sidecar v2
PATCH  .../                              title · status · tags · description
GET    .../raw   PUT .../raw             the file itself
POST   .../duplicate | archive | restore
POST   .../subboards/link | unlink
\`\`\`
`,
);

await patch(ids.apiClient, { description: 'The only place that knows a URL.', tags: ['client'] });
await body(
  ids.apiClient,
  `A typed function per route, sharing its types with the server through
\`packages/shared\`. Errors come back as \`ApiError\` with the server's code, and a
network failure is just another error the store can retry.
`,
);

await patch(ids.store, { description: 'Zustand. Maps the board to React Flow and back.', tags: ['client'] });
await body(
  ids.store,
  `The hinge of the client.

- **In** — \`boardToFlow\` turns the map into React Flow nodes: frames first (they are
  parents), then cards positioned relative to their frame, then texts.
- **Out** — \`splitFlow\` pulls them apart again into \`nodes\`, \`frames\` and \`texts\`,
  converting member positions back to absolute.
- **Autosave** — a change marks the store dirty, schedules a save 1s later, and
  retries every 3s if the volume doesn't answer. Work is never dropped silently.
- **Undo** — whole-graph snapshots. Undoing an archive also asks the server to
  restore the files, so canvas and disk stay in step.
`,
);
await data(
  ids.store,
  sidecar(
    [
      snippet(
        'a-split',
        'splitFlow',
        'ts',
        `function splitFlow(nodes: CGNode[]): {
  nodes: BoardNode[];    // cards — absolute positions
  frames: BoardFrame[];  // sections
  texts: BoardText[];    // labels
}`,
      ),
    ],
    'a-split',
  ),
);

await patch(ids.canvas, { description: 'React Flow, with our own node and edge types.', tags: ['client'] });
await body(
  ids.canvas,
  `Cards, chips, frames and text labels are all React Flow nodes; frames are
parents, which is what makes a frame drag its members for free.

Edges store only source and target — which side they leave and enter is derived
at render time from the current layout, so links always face each other. An edge
turns violet the moment its source marks an output snippet.
`,
);

await patch(ids.panel, { description: 'Overview · Notes · Data · Sub-maps · Settings.', tags: ['client'] });
await body(
  ids.panel,
  `Opens on Overview: description, a preview of the notes, the snippets with their
output marker, and what flows in.

Notes autosave 800ms after you stop typing; the Data tab writes the sidecar the
same way. Title, status, tags and description go through \`PATCH\`, which is also
what moves the file when a title changes.
`,
);

await patch(ids.sharedPkg, {
  description: 'Types and constants, imported by both sides.',
  tags: ['contract'],
});
await body(
  ids.sharedPkg,
  `\`Board\`, \`BoardNode\`, \`NodeData\`, \`AppConfig\`, the autosave timings, the default
palette. Zero runtime dependencies.

Because both halves compile against the same file, a change to the storage shape
breaks the client at build time rather than at runtime.
`,
);

// ------------------------------------------------------------------- layout
const card = (id, x, y, opts = {}) => ({
  id,
  title: '',
  position: { x, y },
  size: opts.size ?? { width: 300, height: 116 },
  shape: opts.shape ?? 'rounded',
  status: opts.status ?? 'built',
  color: opts.color,
  frameId: opts.frameId,
  showDescription: true,
});
const chip = (id, x, y, frameId) => ({
  id,
  title: '',
  position: { x, y },
  size: { width: 184, height: 76 },
  shape: 'rect',
  status: 'built',
  variant: 'chip',
  frameId,
});

const edge = (id, source, target, label, style) => ({ id, source, target, label, style });

await call('PUT', `/boards/${B}/graph`, {
  nodes: [
    card(ids.boardJson, 110, 290, { frameId: 'f-disk', color: '--node-paper' }),
    card(ids.nodeMd, 110, 430, { frameId: 'f-disk', color: '--node-paper' }),
    card(ids.sidecarFile, 110, 570, { frameId: 'f-disk', color: '--node-paper' }),
    chip(ids.archive, 110, 706, 'f-disk'),
    chip(ids.snapshotsDir, 110, 754, 'f-disk'),
    chip(ids.configFile, 110, 802, 'f-disk'),

    card(ids.storage, 550, 290, { frameId: 'f-core', color: '--node-paper' }),
    card(ids.markdown, 550, 430, { frameId: 'f-core', color: '--node-paper' }),
    card(ids.dataCore, 550, 570, { frameId: 'f-core', color: '--node-paper' }),
    chip(ids.configCore, 550, 706, 'f-core'),

    card(ids.boardsMod, 990, 290, { frameId: 'f-modules', color: '--node-paper' }),
    card(ids.nodesMod, 990, 430, { frameId: 'f-modules', color: '--node-paper' }),
    card(ids.framesMod, 990, 570, { frameId: 'f-modules', color: '--node-paper' }),
    chip(ids.snapshotsMod, 990, 706, 'f-modules'),
    chip(ids.exportMod, 990, 754, 'f-modules'),

    card(ids.getBoard, 1430, 290, { frameId: 'f-http', size: { width: 270, height: 116 }, color: '--node-paper' }),
    card(ids.putGraph, 1430, 430, { frameId: 'f-http', size: { width: 270, height: 116 }, color: '--node-paper' }),
    card(ids.nodeRoutes, 1430, 570, { frameId: 'f-http', size: { width: 270, height: 116 }, color: '--node-paper' }),

    card(ids.apiClient, 1820, 290, { frameId: 'f-client', size: { width: 310, height: 116 }, color: '--node-paper' }),
    card(ids.store, 1820, 430, { frameId: 'f-client', size: { width: 310, height: 130 }, color: '--node-paper' }),
    card(ids.canvas, 1820, 596, { frameId: 'f-client', size: { width: 310, height: 116 }, color: '--node-paper' }),
    card(ids.panel, 1820, 736, { frameId: 'f-client', size: { width: 310, height: 116 }, color: '--node-paper' }),

    card(ids.sharedPkg, 1180, 950, { shape: 'pill', color: '--node-lilac', size: { width: 300, height: 104 } }),
  ],
  edges: [
    // read path
    edge('r1', ids.nodeMd, ids.markdown, 'parse'),
    edge('r2', ids.sidecarFile, ids.dataCore, 'normalise'),
    edge('r3', ids.boardJson, ids.boardsMod, 'read'),
    edge('r4', ids.markdown, ids.nodesMod),
    edge('r5', ids.dataCore, ids.nodesMod),
    edge('r6', ids.storage, ids.boardsMod, 'fs'),
    edge('r7', ids.storage, ids.nodesMod, 'fs'),
    edge('r8', ids.boardsMod, ids.getBoard),
    edge('r9', ids.nodesMod, ids.nodeRoutes),
    edge('r10', ids.getBoard, ids.apiClient),
    edge('r11', ids.nodeRoutes, ids.apiClient),
    edge('r12', ids.apiClient, ids.store, 'typed'),
    edge('r13', ids.store, ids.canvas, 'boardToFlow'),
    edge('r14', ids.store, ids.panel),

    // write path
    edge('w1', ids.store, ids.putGraph, 'autosave 1s'),
    edge('w2', ids.panel, ids.nodeRoutes, 'notes 800ms'),
    edge('w3', ids.putGraph, ids.boardsMod, 'saveGraph'),
    edge('w4', ids.boardsMod, ids.boardJson, 'atomic write'),
    edge('w5', ids.nodesMod, ids.nodeMd, 'write'),
    edge('w6', ids.nodesMod, ids.sidecarFile, 'write'),

    // housekeeping
    edge('h1', ids.nodesMod, ids.archive, 'archive'),
    edge('h2', ids.framesMod, ids.snapshotsMod, 'snapshot first'),
    edge('h3', ids.framesMod, ids.boardsMod),
    edge('h4', ids.configFile, ids.configCore),

    // contracts — not a runtime flow
    edge('t1', ids.sharedPkg, ids.boardsMod, 'types', 'dashed'),
    edge('t2', ids.sharedPkg, ids.apiClient, 'types', 'dashed'),
  ],
  frames: [
    { id: 'f-disk', title: 'Disk · /data', position: { x: 80, y: 220 }, size: { width: 360, height: 650 }, color: '--node-slate' },
    { id: 'f-core', title: 'Server · core', position: { x: 520, y: 220 }, size: { width: 360, height: 650 }, color: '--node-sky' },
    { id: 'f-modules', title: 'Server · modules', position: { x: 960, y: 220 }, size: { width: 360, height: 650 }, color: '--node-mint' },
    { id: 'f-http', title: 'HTTP · /api', position: { x: 1400, y: 220 }, size: { width: 330, height: 650 }, color: '--node-lemon' },
    { id: 'f-client', title: 'Client', position: { x: 1790, y: 220 }, size: { width: 380, height: 650 }, color: '--node-lilac' },
  ],
  texts: [
    { id: 'tx-title', text: 'Cartographer — how it works', position: { x: 80, y: 90 }, size: 'lg', bold: true },
    {
      id: 'tx-sub',
      text: 'Files are the database. The server owns every write. The client asks and renders.',
      position: { x: 82, y: 140 },
      size: 'md',
    },
    { id: 'tx-flow', text: '→ read path · ⌁ violet carries data · dashed = types, not calls', position: { x: 82, y: 900 }, size: 'sm', italic: true },
  ],
  viewport: { x: -20, y: -30, zoom: 0.5 },
});

// --------------------------------------------------------- sub-map: writes
const writes = await call('POST', '/boards', {
  name: 'Write path',
  parentBoard: B,
  parentNode: ids.putGraph,
});
const W = writes.id;
const wNode = async (title, position) =>
  (await call('POST', `/boards/${W}/nodes`, { title, position })).id;

const w = {};
w.edit = await wNode('You move a node', { x: 80, y: 120 });
w.dirty = await wNode('Store marks dirty', { x: 80, y: 260 });
w.debounce = await wNode('Wait 1s', { x: 80, y: 400 });
w.split = await wNode('splitFlow', { x: 420, y: 400 });
w.put = await wNode('PUT /graph', { x: 760, y: 400 });
w.merge = await wNode('saveGraph merges', { x: 1100, y: 400 });
w.sync = await wNode('Sync frontmatter', { x: 1100, y: 260 });
w.write = await wNode('Atomic write', { x: 1440, y: 400 });
w.retry = await wNode('Retry every 3s', { x: 760, y: 560 });

await call('PUT', `/boards/${W}/graph`, {
  nodes: [
    { id: w.edit, title: '', position: { x: 80, y: 120 }, size: { width: 240, height: 76 }, shape: 'rounded', status: 'built' },
    { id: w.dirty, title: '', position: { x: 80, y: 260 }, size: { width: 240, height: 76 }, shape: 'rounded', status: 'built' },
    { id: w.debounce, title: '', position: { x: 80, y: 400 }, size: { width: 240, height: 76 }, shape: 'pill', status: 'built', color: '--node-lemon' },
    { id: w.split, title: '', position: { x: 420, y: 400 }, size: { width: 240, height: 76 }, shape: 'rounded', status: 'built' },
    { id: w.put, title: '', position: { x: 760, y: 400 }, size: { width: 240, height: 76 }, shape: 'rounded', status: 'built', color: '--node-lemon' },
    { id: w.merge, title: '', position: { x: 1100, y: 400 }, size: { width: 240, height: 76 }, shape: 'rounded', status: 'built', color: '--node-mint' },
    { id: w.sync, title: '', position: { x: 1100, y: 260 }, size: { width: 240, height: 76 }, shape: 'rounded', status: 'built', color: '--node-mint' },
    { id: w.write, title: '', position: { x: 1440, y: 400 }, size: { width: 240, height: 76 }, shape: 'rounded', status: 'built', color: '--node-sky' },
    { id: w.retry, title: '', position: { x: 760, y: 560 }, size: { width: 240, height: 76 }, shape: 'ellipse', status: 'sketched', color: '--node-blush' },
  ],
  edges: [
    { id: 'we1', source: w.edit, target: w.dirty },
    { id: 'we2', source: w.dirty, target: w.debounce },
    { id: 'we3', source: w.debounce, target: w.split },
    { id: 'we4', source: w.split, target: w.put },
    { id: 'we5', source: w.put, target: w.merge },
    { id: 'we6', source: w.merge, target: w.sync, label: 'title/status changed' },
    { id: 'we7', source: w.merge, target: w.write },
    { id: 'we8', source: w.put, target: w.retry, label: 'offline', style: 'dashed' },
    { id: 'we9', source: w.retry, target: w.put, label: 'again', style: 'dashed' },
  ],
  frames: [],
  texts: [
    { id: 'wt', text: 'One second of quiet, then the whole graph goes over', position: { x: 80, y: 50 }, size: 'md', bold: true },
  ],
  viewport: { x: 20, y: 20, zoom: 0.7 },
});

const wBody = (id, text) => call('PUT', `/boards/${W}/nodes/${id}/body`, { body: text });
await wBody(w.dirty, 'Every mutating action calls `scheduleSave()`. The save indicator turns to “Unsaved”.\n');
await wBody(w.debounce, '`AUTOSAVE_GRAPH_MS = 1000`. Dragging fires hundreds of changes and one save.\n');
await wBody(w.split, 'React Flow nodes are pulled back apart into nodes, frames and texts; member positions return to absolute.\n');
await wBody(w.merge, 'Positions and styles merge onto known nodes. Unknown ids are ignored — a stale client cannot resurrect an archived node.\n');
await wBody(w.sync, 'A changed title or status is written into the node file, so the frontmatter stays the source of truth.\n');
await wBody(w.write, 'Temp file, then rename. board.json is never seen half-written.\n');
await wBody(w.retry, 'A failed save keeps its state and tries again every 3s. The panel says “Offline — retrying”.\n');

// ----------------------------------------------------- sub-map: file life
const life = await call('POST', '/boards', {
  name: 'Node file lifecycle',
  parentBoard: B,
  parentNode: ids.nodeMd,
});
const L = life.id;
const lNode = async (title, position) =>
  (await call('POST', `/boards/${L}/nodes`, { title, position })).id;

const l = {};
l.create = await lNode('Create', { x: 80, y: 200 });
l.rename = await lNode('Rename', { x: 420, y: 200 });
l.edit = await lNode('Edit notes', { x: 420, y: 60 });
l.archiveStep = await lNode('Archive', { x: 760, y: 200 });
l.restoreStep = await lNode('Restore', { x: 1100, y: 200 });

await call('PUT', `/boards/${L}/graph`, {
  nodes: [
    { id: l.create, title: '', position: { x: 80, y: 200 }, size: { width: 240, height: 76 }, shape: 'rounded', status: 'built', color: '--node-mint' },
    { id: l.edit, title: '', position: { x: 420, y: 60 }, size: { width: 240, height: 76 }, shape: 'rounded', status: 'built' },
    { id: l.rename, title: '', position: { x: 420, y: 200 }, size: { width: 240, height: 76 }, shape: 'rounded', status: 'built', color: '--node-lemon' },
    { id: l.archiveStep, title: '', position: { x: 760, y: 200 }, size: { width: 240, height: 76 }, shape: 'rounded', status: 'built', color: '--node-peach' },
    { id: l.restoreStep, title: '', position: { x: 1100, y: 200 }, size: { width: 240, height: 76 }, shape: 'rounded', status: 'built', color: '--node-sky' },
  ],
  edges: [
    { id: 'le1', source: l.create, target: l.rename },
    { id: 'le2', source: l.create, target: l.edit },
    { id: 'le3', source: l.rename, target: l.archiveStep },
    { id: 'le4', source: l.archiveStep, target: l.restoreStep, label: 'undo', style: 'dashed' },
  ],
  frames: [],
  texts: [
    { id: 'lt', text: 'A node is a file pair plus a line in board.json', position: { x: 80, y: 120 }, size: 'md', bold: true },
  ],
  viewport: { x: 40, y: 40, zoom: 0.8 },
});

const lBody = (id, text) => call('PUT', `/boards/${L}/nodes/${id}/body`, { body: text });
await lBody(l.create, 'Slug from the title, `<id>.md` written with default frontmatter, entry appended to board.json.\n');
await lBody(l.edit, 'Body autosaves 800ms after you stop typing. `coverage` flips to `written`, and the node stops rendering hollow.\n');
await lBody(
  l.rename,
  'The file pair moves to the new slug, the board.json id changes, and every edge that referenced it is rewritten — in one server call.\n\nThe frontmatter `id` stays put, so history survives. The exception: a node you have never written to takes the new id, so naming a fresh node does not leave `id: untitled` behind.\n',
);
await lBody(l.archiveStep, 'Both files move to `/data/archive/nodes/<map>/`, the node leaves board.json and its edges are stripped.\n');
await lBody(l.restoreStep, 'Ctrl+Z asks the server to move the files back and re-register the node, so canvas and disk stay in step.\n');

await call('POST', `/boards/${B}/snapshots`);

console.log('done:', B, '· sub-maps:', W, L);
