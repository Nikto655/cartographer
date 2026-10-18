/**
 * Seeds "Cartographer — End to End": three layers (frontend, middleware, backend
 * storage) with the everyday journeys traced through them, in plain language.
 * Written for someone who wants to understand what happens when, not which
 * function calls which.
 *
 *   SEED_PASS=… node scripts/seed-endtoend.mjs
 */
import { call, signIn } from './lib/client.mjs';

await signIn();


const board = await call('POST', '/boards', { name: 'Cartographer — End to End' });
const B = board.id;
console.log('board:', B);

// Layer bands, and the rows inside each.
const FE = [300, 410, 520];
const MW = [700, 790];
const SRV = [970, 1060];
const DISK = [1240, 1330];
const COL = [140, 620, 1100, 1580, 2060];

const steps = [];
/** One step in a journey: which column, which layer row, what it says. */
const step = async (col, y, title, description, notes, opts = {}) => {
  const x = COL[col];
  const id = (await call('POST', `/boards/${B}/nodes`, { title, position: { x, y } })).id;
  if (description) await call('PATCH', `/boards/${B}/nodes/${id}`, { description });
  if (notes) await call('PUT', `/boards/${B}/nodes/${id}/body`, { body: notes });
  steps.push({ id, x, y, ...opts });
  return id;
};

// ───────────────────────────── ① Opening a map ─────────────────────────────
const a1 = await step(
  0,
  FE[0],
  'You open a map',
  'A click on the dashboard.',
  'The canvas is empty until the server answers — there is no local copy of your work in the browser.\n',
  { frameId: 'f-fe' },
);
const a2 = await step(
  0,
  MW[0],
  'Ask for that map',
  'GET /api/boards/:id',
  'One request fetches the whole map. Maps are small — a few hundred KB at most — so there is no paging or partial loading to reason about.\n',
  { frameId: 'f-mw', color: '--node-lemon' },
);
const a3 = await step(
  0,
  SRV[0],
  'Read the layout, then every note file',
  'One folder read, then one file per node.',
  'The server opens `board.json` for the layout, then opens every `.md` in the folder to pick up its title, status and description.\n\nThis is why a map you edited in a text editor is already correct when you open it here.\n',
  { frameId: 'f-srv', color: '--node-mint' },
);
const a4 = await step(
  0,
  DISK[0],
  'board.json + one .md per node',
  'The only place your work exists.',
  'No database, no cache, no index. If the folder is on disk, the map exists; if it is not, it does not.\n',
  { frameId: 'f-disk', color: '--node-sky' },
);
const a5 = await step(
  0,
  SRV[1],
  'Where they disagree, the file wins',
  'Notes are the truth; layout is a cache.',
  'If a title in `board.json` differs from the title in the note file, the note file is right and `board.json` is quietly corrected.\n\nThat rule is what makes editing the files by hand safe.\n',
  { frameId: 'f-srv', color: '--node-mint' },
);
const a6 = await step(
  0,
  MW[1],
  'Send back one map',
  'Positions, links, and per-node flags.',
  'The reply also carries things the server worked out: whether a node has notes, whether it has snippets, whether it passes data on. The front end never computes those itself, so two screens can never disagree.\n',
  { frameId: 'f-mw', color: '--node-lemon' },
);
const a7 = await step(
  0,
  FE[1],
  'The canvas draws it',
  'Cards, frames, labels, links.',
  'Everything you see is built from that one reply. Frames become containers, nodes become cards, and links work out which side to leave from based on where the cards ended up.\n',
  { frameId: 'f-fe' },
);

// ──────────────────────────── ② Creating a node ────────────────────────────
const b1 = await step(
  1,
  FE[0],
  'You double-click the canvas',
  'Or drag a tool off the pill.',
  'The card appears immediately with its title selected, so you can keep typing. Nothing is guessed locally — the server has already been asked.\n',
  { frameId: 'f-fe' },
);
const b2 = await step(
  1,
  MW[0],
  'Create a node here',
  'POST /api/boards/:id/nodes',
  'The request carries a title and a position. That is all a node needs to exist.\n',
  { frameId: 'f-mw', color: '--node-lemon' },
);
const b3 = await step(
  1,
  SRV[0],
  'Turn the title into a filename',
  '“Payment Screen” → payment-screen',
  'The title becomes a slug, and the slug becomes the filename. If that name is taken, it gets a number.\n\nThat is why nodes are findable in a file browser without opening the app.\n',
  { frameId: 'f-srv', color: '--node-mint' },
);
const b4 = await step(
  1,
  DISK[0],
  'Write payment-screen.md',
  'Frontmatter, then an empty body.',
  'The new file holds the small structured bits — id, title, created, status, tags — and nothing else. The body is yours to fill.\n',
  { frameId: 'f-disk', color: '--node-sky' },
);
const b5 = await step(
  1,
  DISK[1],
  'Add a line to board.json',
  'Where the card sits, and how it looks.',
  'Two files change when a node is born: the note file that holds its meaning, and the layout file that holds its position. Neither can describe the node on its own.\n',
  { frameId: 'f-disk', color: '--node-sky' },
);
const b6 = await step(
  1,
  FE[1],
  'The card is on the canvas',
  'Empty, dashed, waiting for words.',
  'It renders hollow until it has notes. That is a nudge, not a blocker — sketch the whole flow first if you like.\n',
  { frameId: 'f-fe' },
);

// ───────────────────────────── ③ Writing notes ─────────────────────────────
const c1 = await step(
  2,
  FE[0],
  'You type in the Notes tab',
  'Plain markdown, formatting bar optional.',
  'Nothing is sent while you are mid-sentence.\n',
  { frameId: 'f-fe' },
);
const c2 = await step(
  2,
  FE[1],
  'You pause for 800ms',
  'The save waits for you to stop.',
  'Typing for a minute produces one save, not a hundred. The panel shows “Saving…” then “Saved”, and if the server cannot be reached it says “Offline — retrying” and keeps trying rather than dropping the text.\n',
  { frameId: 'f-fe', color: '--node-lemon' },
);
const c3 = await step(
  2,
  MW[0],
  'Save this body',
  'PUT …/nodes/:id/body',
  'Only the prose is sent. The title, status and tags travel on a different call, so a slow save of one cannot clobber the other.\n',
  { frameId: 'f-mw', color: '--node-lemon' },
);
const c4 = await step(
  2,
  SRV[0],
  'Keep the frontmatter, replace the prose',
  'Your metadata survives an edit.',
  'The server re-reads the file, swaps the body, and writes it back with the frontmatter untouched — including any keys a future version of the app might have added.\n',
  { frameId: 'f-srv', color: '--node-mint' },
);
const c5 = await step(
  2,
  DISK[0],
  'Rewrite the .md, safely',
  'Written to a temp file, then renamed.',
  'A crash mid-save cannot leave a half-written note: the file is only replaced once it is complete on disk.\n',
  { frameId: 'f-disk', color: '--node-sky' },
);
const c6 = await step(
  2,
  FE[2],
  'The dashed outline fills in',
  'The card now has content.',
  'The server reports back whether the body has anything in it, and the card stops rendering hollow. Same signal drives the frame and dashboard strips.\n',
  { frameId: 'f-fe' },
);

// ─────────────────────── ④ Moving things around ────────────────────────────
const d1 = await step(
  3,
  FE[0],
  'You drag, resize, link',
  'Pure layout — no words change.',
  'Dragging a card fires hundreds of tiny updates in the browser. None of them touch the server.\n',
  { frameId: 'f-fe' },
);
const d2 = await step(
  3,
  FE[1],
  'You pause for 1s',
  'Then the whole layout goes over.',
  'One second of quiet and the entire graph is sent — every node position, every link, every frame. Simple, and safe for a single-user tool: the last write wins.\n',
  { frameId: 'f-fe', color: '--node-lemon' },
);
const d3 = await step(
  3,
  MW[0],
  'Save the layout',
  'PUT …/boards/:id/graph',
  'The autosave endpoint. It is deliberately dumb: it will not create or delete nodes, only move and restyle the ones it already knows about.\n',
  { frameId: 'f-mw', color: '--node-lemon' },
);
const d4 = await step(
  3,
  SRV[0],
  'Merge onto what it knows',
  'Unknown ids are ignored.',
  'If a stale browser tab sends a node the server has already archived, it is dropped rather than resurrected.\n',
  { frameId: 'f-srv', color: '--node-mint' },
);
const d5 = await step(
  3,
  DISK[0],
  'Only board.json changes',
  'Your notes are not touched.',
  'Moving a card never rewrites a note file. That separation is why a map is easy to review in version control: layout churn and writing churn land in different files.\n',
  { frameId: 'f-disk', color: '--node-sky' },
);
const d6 = await step(
  3,
  FE[2],
  'Saved',
  'The dot in the top-left goes quiet.',
  'If the save fails it keeps retrying every three seconds, and the indicator stays honest about it.\n',
  { frameId: 'f-fe' },
);

// ────────────────────────── ⑤ Renaming a node ──────────────────────────────
const e1 = await step(
  4,
  FE[0],
  'You rename a node',
  'In the panel, or on the card.',
  'A rename looks trivial on screen and is the most involved operation underneath.\n',
  { frameId: 'f-fe' },
);
const e2 = await step(
  4,
  MW[0],
  'Patch the node',
  'PATCH …/nodes/:id',
  'The same call carries status, tags and description changes.\n',
  { frameId: 'f-mw', color: '--node-lemon' },
);
const e3 = await step(
  4,
  SRV[0],
  'New filename, links rewritten',
  'All of it, or none of it.',
  'The file pair moves to the new name, the layout file learns the new id, and every link that pointed at the old one is repointed — inside a single operation, so the map is never half-renamed.\n',
  { frameId: 'f-srv', color: '--node-mint' },
);
const e4 = await step(
  4,
  DISK[0],
  'The file moves; its id stays',
  'History survives the rename.',
  'The `id` written inside the file does not change, so the node keeps its identity even though the filename followed the new title. A node you have never written to is the exception — it takes the new id, so a freshly named node does not keep “untitled” forever.\n',
  { frameId: 'f-disk', color: '--node-sky' },
);
const e5 = await step(
  4,
  FE[1],
  'Nothing breaks',
  'Links, sub-maps and history intact.',
  'Because the rewrite happened server-side in one go, the canvas just receives the new name.\n',
  { frameId: 'f-fe' },
);

// ─────────────────────────── the folder itself ─────────────────────────────
const folder = (await call('POST', `/boards/${B}/nodes`, {
  title: 'What the folder actually looks like',
  position: { x: 140, y: 1560 },
})).id;
await call('PATCH', `/boards/${B}/nodes/${folder}`, {
  description: 'One folder per map. Open it in Finder, a text editor, or git.',
});
await call('PUT', `/boards/${B}/nodes/${folder}/body`, {
  body: `Everything the app knows is here. Back it up by copying the folder; move it to
another machine by copying the folder.

\`archive/\` is where anything you remove goes — nothing is ever deleted outright.
`,
});
await call('PUT', `/boards/${B}/nodes/${folder}/data`, {
  version: 2,
  snippets: [
    {
      id: 'e2e-tree',
      label: 'data/',
      lang: 'txt',
      code: `data/
├── boards/
│   └── checkout-flow/            ← one folder per map
│       ├── board.json            ← positions, links, frames, labels
│       └── nodes/
│           ├── payment-screen.md         ← your writing
│           └── payment-screen.data.json  ← optional snippets
├── archive/                      ← everything you removed
└── snapshots/                    ← point-in-time copies`,
    },
    {
      id: 'e2e-md',
      label: 'payment-screen.md',
      lang: 'md',
      code: `---
id: payment-screen
title: Payment Screen
created: '2026-07-26'
status: documented
tags: [checkout]
description: Collects card details and validates them.
---

Everything below the dashes is yours. Plain markdown, no app-specific syntax.`,
    },
  ],
  outSnippetId: 'e2e-md',
});

// ───────────────────────────── the three rules ─────────────────────────────
const rule = async (title, x, notes) => {
  const id = (await call('POST', `/boards/${B}/nodes`, { title, position: { x, y: 1580 } })).id;
  await call('PUT', `/boards/${B}/nodes/${id}/body`, { body: notes });
  return id;
};
const r1 = await rule(
  'Files are the truth',
  1180,
  'Anything the app shows can be rebuilt from the folder. Nothing important lives only in the browser.\n',
);
const r2 = await rule(
  'The server does every write',
  1180,
  'The browser never writes a file. It asks for an operation — create, rename, archive — and the server does the whole thing at once, so a map is never half-changed.\n',
);
const r3 = await rule(
  'Nothing is deleted',
  1180,
  'Archiving moves files into `data/archive/`. Undo moves them back. The worst mistake you can make is recoverable with `mv`.\n',
);

// ──────────────────────────────── the layout ───────────────────────────────
const card = (s) => ({
  id: s.id,
  title: '',
  position: { x: s.x, y: s.y },
  size: { width: 300, height: 88 },
  shape: 'rounded',
  status: 'built',
  color: s.color,
  frameId: s.frameId,
  showDescription: true,
});
const chain = (prefix, ids) =>
  ids.slice(0, -1).map((source, i) => ({ id: `${prefix}${i}`, source, target: ids[i + 1] }));

await call('PUT', `/boards/${B}/graph`, {
  nodes: [
    ...steps.map(card),
    {
      id: folder,
      title: '',
      position: { x: 140, y: 1560 },
      size: { width: 460, height: 104 },
      shape: 'rounded',
      status: 'built',
      color: '--node-sky',
      showDescription: true,
    },
    ...[r1, r2, r3].map((id, i) => ({
      id,
      title: '',
      position: { x: 1180 + i * 300, y: 1580 },
      size: { width: 184, height: 76 },
      shape: 'rect',
      status: 'built',
      variant: 'chip',
    })),
  ],
  edges: [
    ...chain('a', [a1, a2, a3, a4, a5, a6, a7]),
    ...chain('b', [b1, b2, b3, b4, b5, b6]),
    ...chain('c', [c1, c2, c3, c4, c5, c6]),
    ...chain('d', [d1, d2, d3, d4, d5, d6]),
    ...chain('e', [e1, e2, e3, e4, e5]),
  ],
  frames: [
    {
      id: 'f-fe',
      title: 'Frontend · what you see and do',
      position: { x: 80, y: 240 },
      size: { width: 2360, height: 380 },
      color: '--node-lilac',
    },
    {
      id: 'f-mw',
      title: 'Middleware · the API between them',
      position: { x: 80, y: 660 },
      size: { width: 2360, height: 230 },
      color: '--node-lemon',
    },
    {
      id: 'f-srv',
      title: 'Backend · the rules that protect your work',
      position: { x: 80, y: 930 },
      size: { width: 2360, height: 230 },
      color: '--node-mint',
    },
    {
      id: 'f-disk',
      title: 'Storage · the files on disk',
      position: { x: 80, y: 1200 },
      size: { width: 2360, height: 230 },
      color: '--node-sky',
    },
  ],
  texts: [
    { id: 'e2e-title', text: 'Cartographer, end to end', position: { x: 80, y: 90 }, size: 'lg', bold: true },
    {
      id: 'e2e-sub',
      text: 'Five everyday journeys, each one falling down through the layers and back up.',
      position: { x: 82, y: 146 },
      size: 'md',
    },
    { id: 'e2e-j1', text: '① Opening a map', position: { x: 140, y: 196 }, size: 'sm', bold: true },
    { id: 'e2e-j2', text: '② Creating a node', position: { x: 620, y: 196 }, size: 'sm', bold: true },
    { id: 'e2e-j3', text: '③ Writing notes', position: { x: 1100, y: 196 }, size: 'sm', bold: true },
    { id: 'e2e-j4', text: '④ Moving things around', position: { x: 1580, y: 196 }, size: 'sm', bold: true },
    { id: 'e2e-j5', text: '⑤ Renaming a node', position: { x: 2060, y: 196 }, size: 'sm', bold: true },
    { id: 'e2e-rules', text: 'Three rules that explain most of the behaviour', position: { x: 1180, y: 1530 }, size: 'sm', italic: true },
    { id: 'e2e-read', text: 'Zoom in on any step to read what it does and why.', position: { x: 140, y: 1700 }, size: 'sm', italic: true },
  ],
  viewport: { x: -4, y: 34, zoom: 0.42 },
});

await call('POST', `/boards/${B}/snapshots`);
console.log('done:', B);
