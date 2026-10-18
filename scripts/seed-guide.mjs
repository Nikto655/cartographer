/**
 * Seeds "How Cartographer Works" — a product tour, built with the product.
 * Where seed-architecture.mjs explains the plumbing, this explains what you are
 * looking at on screen and what each part does.
 *
 *   SEED_PASS=… node scripts/seed-guide.mjs
 */
import { call, signIn } from './lib/client.mjs';

await signIn();


const board = await call('POST', '/boards', { name: 'How Cartographer Works' });
const B = board.id;
console.log('board:', B);

const ids = {};
const add = async (key, title, x, y) => {
  ids[key] = (await call('POST', `/boards/${B}/nodes`, { title, position: { x, y } })).id;
};
const body = (id, text) => call('PUT', `/boards/${B}/nodes/${id}/body`, { body: text });
const patch = (id, payload) => call('PATCH', `/boards/${B}/nodes/${id}`, payload);
const data = (id, payload) => call('PUT', `/boards/${B}/nodes/${id}/data`, payload);

// ------------------------------------------------------------- vocabulary
await add('vMap', 'A Map', 110, 310);
await add('vNode', 'A Node', 110, 366);
await add('vChip', 'A Chip', 110, 422);
await add('vFrame', 'A Frame', 110, 478);
await add('vText', 'A Text label', 110, 534);
await add('vEdge', 'An Edge', 110, 590);
await add('vSub', 'A Sub-map', 110, 646);

// ------------------------------------------------------- anatomy of a node
await add('sample', 'Payment Screen', 830, 360);
await add('empty', 'Refund policy', 830, 545);
await add('cTitle', '① Title', 600, 300);
await add('cDesc', '② Description', 600, 360);
await add('cSpine', '③ Status spine', 600, 420);
await add('cData', '④ { } snippets', 1120, 300);
await add('cFlow', '⑤ ⌁ passes data', 1120, 360);
await add('cSub', '⑥ ▣ sub-maps', 1120, 420);
await add('cEmpty', '⑦ Dashed = empty', 600, 545);
await add('sSketched', 'sketched', 1120, 500);
await add('sDocumented', 'documented', 1120, 548);
await add('sBuilt', 'built', 1120, 596);

// --------------------------------------------------------------- the panel
await add('pOverview', 'Overview', 1410, 310);
await add('pNotes', 'Notes', 1410, 366);
await add('pData', 'Data', 1410, 422);
await add('pSubmaps', 'Sub-maps', 1410, 478);
await add('pSettings', 'Settings', 1410, 534);

// ------------------------------------------------------------- data flow
await add('dOne', 'Signup Form', 140, 810);
await add('dTwo', 'Email verified?', 480, 810);
await add('dThree', 'Welcome Email', 820, 810);

// ------------------------------------------------------------ getting out
await add('gExport', 'Export', 1180, 790);
await add('gWalk', 'Walkthrough', 1180, 846);
await add('gSnap', 'Snapshots', 1180, 902);
await add('gArchive', 'Archive', 1180, 958);

// ------------------------------------------------------------------ words
await body(
  ids.vMap,
  `One canvas, one folder on disk. Everything you draw on it lives in that folder as
plain files, so a map is portable, diffable and readable without this app.

The dashboard lists your maps: **Main** shows the ones that stand alone, **All** adds
sub-maps underneath their parent.
`,
);
await body(
  ids.vNode,
  `The only thing on the canvas with a **file behind it**: \`nodes/<id>.md\`.

A node is a step, a screen, a decision — whatever you are mapping. Double-click it to
open the panel and write. Everything else on the canvas (frames, labels, edges) is
just arrangement.
`,
);
await body(
  ids.vChip,
  `The same node, drawn small. Press \`C\` to switch a node between card and chip.

Nothing is lost — a chip has the same notes, snippets, status and sub-maps as the
card it was. Use chips when a region needs to be scannable rather than readable.
`,
);
await body(
  ids.vFrame,
  `A labelled region. Drop a node ≥50% inside and it joins; drag a frame and its
members come along.

The bar in a frame's header aggregates the statuses of everything inside it, so a
section tells you how done it is at a glance. Collapse it to hide the detail, or
**promote** it to turn the whole section into a sub-map.
`,
);
await body(
  ids.vText,
  `Free-floating words. No file, no panel — just a label for a region or an arrow.

Select one to change size, or make it bold, italic or underlined.
`,
);
await body(
  ids.vEdge,
  `A link between two nodes. Drag from the dot on a node's edge to another node —
or onto empty canvas, which creates the next node already connected.

- **Solid** — it happens.
- **Dashed** — tentative, planned, not real yet.
- **Violet with ⌁** — the source passes data forward (see below).
`,
);
await body(
  ids.vSub,
  `A map hanging off a node, for when a step deserves its own canvas.

Open the **Sub-maps** tab on any node to create one, link an existing map, or
detach it again. A node can hold several.
`,
);

await patch(ids.sample, {
  description: 'Collects card details and validates them before charging.',
  tags: ['example'],
});
await body(
  ids.sample,
  `This card is a live example — everything the callouts point at is real.

It has notes (so it is filled, not hollow), one snippet marked as its output, and a
sub-map. Open the panel and poke around.
`,
);
await data(ids.sample, {
  version: 2,
  snippets: [
    {
      id: 'g-out',
      label: 'session payload',
      lang: 'json',
      code: `{
  "userId": "string",
  "plan": "'free' | 'pro'"
}`,
    },
  ],
  outSnippetId: 'g-out',
});

await body(
  ids.empty,
  '', // deliberately empty: this node demonstrates the hollow state
);

await body(
  ids.cTitle,
  `Click it in the panel to rename. The file on disk follows the new name, and every
link to this node is rewritten in the same move — nothing breaks.
`,
);
await body(
  ids.cDesc,
  `One or two lines, edited under the title in the panel. Show or hide it on the card
from **Settings → Show description on card**.

It fades out as you zoom past ~60%, so a wide view stays readable.
`,
);
await body(
  ids.cSpine,
  `The coloured bar. Cycle it with \`S\`, or from the status chip in the panel.

Its colour is the same one that fills the strips on frames and on dashboard cards,
so progress reads the same at every zoom level.
`,
);
await body(
  ids.cData,
  `Shown when the node has snippets in its **Data** tab — code, payload shapes,
queries, whatever belongs to this step.
`,
);
await body(
  ids.cFlow,
  `Shown when one of those snippets is marked **⌁ Output**. That snippet is what this
node passes to everything downstream, and the links leaving it turn violet.
`,
);
await body(
  ids.cSub,
  `Shown when the node has sub-maps. The numbers are how many nodes in the sub-map
are finished, out of the total.
`,
);
await body(
  ids.cEmpty,
  `A dashed outline means the node has no notes yet. It is a nudge, never a blocker —
sketch the shape of a flow first, fill it in later.
`,
);
await body(ids.sSketched, 'First position. It exists, nothing more.\n');
await body(ids.sDocumented, 'The thinking is written down.\n');
await body(ids.sBuilt, 'It exists in the world, not just on the canvas.\n');

await body(
  ids.pOverview,
  `Where you land. Description, a preview of the notes, the snippets with their output
marker, and what flows in from upstream.
`,
);
await body(
  ids.pNotes,
  `The writing surface: markdown with a formatting bar and a preview toggle.

It saves itself 800ms after you stop typing. The file stays clean markdown — no
private syntax, so it reads fine in any editor.
`,
);
await body(
  ids.pData,
  `Labelled snippets belonging to this node, and one of them can be marked **⌁ Output**.

Below them, **Incoming** shows the output of every node that links into this one.
That list is computed from the map each time, so it can never go stale.
`,
);
await body(
  ids.pSubmaps,
  `The maps hanging off this node. Create one, link an existing map, or remove one —
removing asks whether to just unlink it or delete it.
`,
);
await body(
  ids.pSettings,
  `How the node is drawn — card or chip, shape, colour, whether the description shows.
Plus the file paths behind it, and archiving.
`,
);

await patch(ids.dOne, { description: 'Marks a snippet as ⌁ Output.' });
await body(
  ids.dOne,
  `Mark a snippet **⌁ Output** here and two things happen at once: the links leaving
this node turn violet, and every node downstream lists this snippet under
**Incoming**.
`,
);
await data(ids.dOne, {
  version: 2,
  snippets: [
    { id: 'g-flow', label: 'session', lang: 'json', code: `{ "userId": "string" }` },
  ],
  outSnippetId: 'g-flow',
});
await patch(ids.dTwo, { description: 'Sees it under Incoming. Passes nothing on itself.' });
await body(
  ids.dTwo,
  `Open this node's **Data** tab: the session payload from Signup Form is listed under
Incoming, read-only, with a link back to its source.

This node marks no output of its own, so the link leaving it stays grey.
`,
);
await body(
  ids.dThree,
  `Nothing flows in here, because the node before it passes nothing on. The chain
stops where someone stops marking outputs.
`,
);

await body(
  ids.gExport,
  `Select some nodes and press \`⌘E\`. You get one markdown document: a heading per
node, its notes, and its snippets as fenced blocks — with an option to descend into
sub-maps. This is the hand-off artefact.
`,
);
await body(
  ids.gWalk,
  `Step through a flow one node at a time, notes rendered full screen. At a fork it
stops and asks which way to go, rather than guessing.
`,
);
await body(
  ids.gSnap,
  `A copy of the whole map folder, taken on demand from the ⌥ camera button.
Restoring one snapshots the current state first, so restoring is itself undoable.
`,
);
await body(
  ids.gArchive,
  `Nothing is ever deleted. Archived nodes and maps move to \`data/archive/\`, and
undo brings them back from there.
`,
);

// ----------------------------------------------------------------- layout
const card = (id, x, y, w, h, opts = {}) => ({
  id,
  title: '',
  position: { x, y },
  size: { width: w, height: h },
  shape: opts.shape ?? 'rounded',
  status: opts.status ?? 'built',
  color: opts.color,
  frameId: opts.frameId,
  showDescription: opts.showDescription ?? true,
});
const chip = (id, x, y, frameId, status = 'built') => ({
  id,
  title: '',
  position: { x, y },
  size: { width: 184, height: 76 },
  shape: 'rect',
  status,
  variant: 'chip',
  frameId,
});
const edge = (id, source, target, label, style) => ({ id, source, target, label, style });

await call('PUT', `/boards/${B}/graph`, {
  nodes: [
    chip(ids.vMap, 110, 310, 'f-vocab'),
    chip(ids.vNode, 110, 366, 'f-vocab'),
    chip(ids.vChip, 110, 422, 'f-vocab'),
    chip(ids.vFrame, 110, 478, 'f-vocab'),
    chip(ids.vText, 110, 534, 'f-vocab'),
    chip(ids.vEdge, 110, 590, 'f-vocab'),
    chip(ids.vSub, 110, 646, 'f-vocab'),

    card(ids.sample, 830, 360, 240, 128, { frameId: 'f-anatomy', color: '--node-sky', status: 'documented' }),
    card(ids.empty, 830, 545, 240, 76, { frameId: 'f-anatomy', status: 'sketched', showDescription: false }),
    chip(ids.cTitle, 600, 300, 'f-anatomy'),
    chip(ids.cDesc, 600, 360, 'f-anatomy'),
    chip(ids.cSpine, 600, 420, 'f-anatomy'),
    chip(ids.cData, 1120, 300, 'f-anatomy'),
    chip(ids.cFlow, 1120, 360, 'f-anatomy'),
    chip(ids.cSub, 1120, 420, 'f-anatomy'),
    chip(ids.cEmpty, 600, 545, 'f-anatomy'),
    chip(ids.sSketched, 1120, 500, 'f-anatomy', 'sketched'),
    chip(ids.sDocumented, 1120, 548, 'f-anatomy', 'documented'),
    chip(ids.sBuilt, 1120, 596, 'f-anatomy', 'built'),

    chip(ids.pOverview, 1410, 310, 'f-panel'),
    chip(ids.pNotes, 1410, 366, 'f-panel'),
    chip(ids.pData, 1410, 422, 'f-panel'),
    chip(ids.pSubmaps, 1410, 478, 'f-panel'),
    chip(ids.pSettings, 1410, 534, 'f-panel'),

    card(ids.dOne, 140, 810, 250, 116, { frameId: 'f-flow', color: '--node-mint' }),
    card(ids.dTwo, 480, 810, 250, 116, { frameId: 'f-flow' }),
    card(ids.dThree, 820, 810, 250, 116, { frameId: 'f-flow', showDescription: false }),

    chip(ids.gExport, 1180, 790, 'f-out'),
    chip(ids.gWalk, 1180, 846, 'f-out'),
    chip(ids.gSnap, 1180, 902, 'f-out'),
    chip(ids.gArchive, 1180, 958, 'f-out'),
  ],
  edges: [
    // callouts point at the sample
    edge('c1', ids.cTitle, ids.sample, '', 'dashed'),
    edge('c2', ids.cDesc, ids.sample, '', 'dashed'),
    edge('c3', ids.cSpine, ids.sample, '', 'dashed'),
    edge('c4', ids.cData, ids.sample, '', 'dashed'),
    edge('c5', ids.cFlow, ids.sample, '', 'dashed'),
    edge('c6', ids.cSub, ids.sample, '', 'dashed'),
    edge('c7', ids.cEmpty, ids.empty, '', 'dashed'),

    // the flow demo — the first edge goes violet on its own
    edge('d1', ids.dOne, ids.dTwo, 'carries the output'),
    edge('d2', ids.dTwo, ids.dThree, 'carries nothing'),
  ],
  frames: [
    { id: 'f-vocab', title: 'What things are', position: { x: 80, y: 250 }, size: { width: 400, height: 500 }, color: '--node-slate' },
    { id: 'f-anatomy', title: 'Anatomy of a node', position: { x: 560, y: 250 }, size: { width: 780, height: 440 }, color: '--node-sky' },
    { id: 'f-panel', title: 'The node panel', position: { x: 1380, y: 250 }, size: { width: 380, height: 380 }, color: '--node-lilac' },
    { id: 'f-flow', title: 'How data moves between nodes', position: { x: 80, y: 750 }, size: { width: 1030, height: 250 }, color: '--node-mint' },
    { id: 'f-out', title: 'Getting work back out', position: { x: 1150, y: 750 }, size: { width: 300, height: 320 }, color: '--node-lemon' },
  ],
  texts: [
    { id: 'gt-title', text: 'How Cartographer works', position: { x: 80, y: 120 }, size: 'lg', bold: true },
    {
      id: 'gt-sub',
      text: 'Nodes hold your writing. Everything else on the canvas arranges them.',
      position: { x: 82, y: 176 },
      size: 'md',
    },
    {
      id: 'gt-hint',
      text: 'Every card here is a real node — open one to see what it is describing.',
      position: { x: 82, y: 1035 },
      size: 'sm',
      italic: true,
    },
    { id: 'gt-status', text: 'the three statuses', position: { x: 1122, y: 470 }, size: 'sm' },
  ],
  viewport: { x: -28, y: -54, zoom: 0.65 },
});

// ------------------------------------------------- a real sub-map for ⑥
const child = await call('POST', '/boards', {
  name: 'Card validation',
  parentBoard: B,
  parentNode: ids.sample,
});
const C = child.id;
const cAdd = async (title, position) =>
  (await call('POST', `/boards/${C}/nodes`, { title, position })).id;
const c1 = await cAdd('Luhn check', { x: 120, y: 180 });
const c2 = await cAdd('Expiry in the future', { x: 420, y: 180 });
const c3 = await cAdd('CVC length by brand', { x: 720, y: 180 });

await call('PUT', `/boards/${C}/graph`, {
  nodes: [
    { id: c1, title: '', position: { x: 120, y: 180 }, size: { width: 230, height: 76 }, shape: 'rounded', status: 'built' },
    { id: c2, title: '', position: { x: 420, y: 180 }, size: { width: 230, height: 76 }, shape: 'rounded', status: 'built' },
    { id: c3, title: '', position: { x: 720, y: 180 }, size: { width: 230, height: 76 }, shape: 'rounded', status: 'sketched' },
  ],
  edges: [
    { id: 'cv1', source: c1, target: c2 },
    { id: 'cv2', source: c2, target: c3 },
  ],
  frames: [],
  texts: [
    { id: 'cvt', text: 'A sub-map is just another map — same tools, one level down', position: { x: 120, y: 110 }, size: 'md', bold: true },
  ],
  viewport: { x: 40, y: 40, zoom: 0.8 },
});

await call('PUT', `/boards/${C}/nodes/${c1}/body`, {
  body: 'Rejects mistyped numbers before anything is sent. Cheap, client-side.\n',
});
await call('PUT', `/boards/${C}/nodes/${c2}/body`, {
  body: 'Month and year, compared against today in the shopper’s timezone.\n',
});

await call('POST', `/boards/${B}/snapshots`);
console.log('done:', B, '· sub-map:', C);
