# Known issues

Open defects, found in a full-stack review and left unfixed. Each was **confirmed** unless
marked otherwise. Check here before reporting a discovery.

Fixed items are removed, except the recent ones collected at the end; see DECISIONS for the
fixes that shaped the architecture.

## Client — correctness

**"Edit label" on an edge is inert the second time.** Escape sets `editing = false` but leaves
`editingEdgeId` pointing at the edge, so re-selecting writes the same id, the selector returns
an identical string, and the effect never re-runs. Both worlds. *Fix: clear `editingEdgeId` on
escape and on commit.*

**The clipboard and a few local preferences do not follow a rename.** `Clipboard.sourceBoardId`
(`shared/store.ts`) and the `cartograph.collapsedParents` / `cartograph.lastBoard` localStorage
keys all hold board ids, and none is told when one changes. Copy from a board, rename it, and the
paste fails; a folded parent quietly unfolds. Same class as the folders-follow-a-rename bug (see DECISIONS), but all
of it is per-browser, recoverable by repeating the action, and none of it touches the volume — so
it is recorded rather than wired. *Fix, if it bites: the client would need its own subscription to
the rename, which today it has no channel for.*

**Closing the tab mid-save can lose the newest edits.** On unload the store re-sends the canvas as
a keepalive request at once rather than queueing it, because nothing after that tick runs. If an
ordinary save was already on the wire *and* the canvas changed after it left, and the server
finishes the earlier one first, the keepalive copy carries a stale `baseUpdatedAt` and is refused.
The window is a few milliseconds wide. A graph whose payload is over the 63 KiB keepalive cap gets
an ordinary save and the browser's "Leave site?" prompt instead; leaving anyway loses it.

## Client — performance

**`App` subscribes to the whole `nodes` array** (`app/App.tsx`) but only needs `nodes.length`
and the selection. Every `onNodesChange` — i.e. every mousemove during a drag — re-renders the
chrome, breadcrumb (which walks `summaries` on each render), toolbars, canvas and panel. None
are memoised.

**`key={mode}` remounts the editor subtree** when toggling side ↔ centre, destroying the
CodeMirror instance and losing cursor, selection, undo history and scroll. The
`cg-editor--centre` class already does the work.

**`FrameNode` subscribes to the whole `nodes` array** to count members, defeating its own
`memo()`.

## Accessibility

- `Modal` has no focus trap, no initial focus, no `aria-modal`, no focus restoration. Tab walks
  out into the canvas behind it.
- `Menu` uses `role="menu"` but never moves focus into itself and has no arrow-key navigation,
  so every popover is mouse-only in practice.
- The editor's resize divider is `role="separator"` with `onMouseDown` only — no `tabIndex`, no
  arrow keys, no `aria-valuenow`.

## Server

**Input validation is uneven.** Roughly half the routes destructure `req.body` with `?? {}` and
half do not; a literal `null` body would 500 rather than 400. *Suspected — Fastify's parser may
reject it first; untested.* Geometry from `PUT …/graph` (`position`, `size`, `viewport`) is
stored verbatim with no numeric validation, so `{"x":"abc"}` persists and later makes
`boundingBox` return `NaN`. Self-inflicted, own workspace only.

Status is no longer part of this: `assertKnownStatus` (v1.7) rejects an id this deployment does
not define, on both the REST and MCP paths. `saveGraph` is the remaining exception — it syncs
status straight from the canvas payload without checking, on the grounds that the canvas only
ever sends what it just read. That assumption is now the only thing holding.

**`duplicateBoard` keeps `parentBoard` without registering the copy under the parent.** The
dashboard nests it; drill-down and `sharedTree` cannot reach it. Safe direction (a share of the
parent will not pick up the copy) but the two views of the tree disagree. *Suspected.*

**New nodes always start as `sketched`.** `createNode` falls back to the shared
`DEFAULT_STATUS` constant, not to the first status in `config.json`. A deployment whose config
drops `sketched` therefore creates nodes with a status it does not define: they render with the
fallback style and are left out of every status strip. CONFIGURATION tells people to keep that id
and relabel it. *Fix: default to `(await getConfig()).statuses[0].id` in `createNode`, and use the
same in the parse fallback in `core/markdown.ts`.*

**`assertBoardVisible` assumes `:id` is always a board id.** True for all 45 routes today, but
it is an unenforced convention — a future route with a different `:id` would be silently 404'd,
or a board sub-route with a different param name would skip visibility resolution.

**CSRF rests entirely on `SameSite=Lax`.** No token, no Origin check. Holds today (Lax blocks
cross-site POSTs and there are no state-changing GETs) but it is a single mechanism with no
defence in depth.

**Username lockout by noise.** 10 failed attempts/minute on a known username also throttles the
real user for the rest of that minute.

**The per-IP login bucket counts successes.** `checkLoginRate` runs before authentication and
`clearLoginRate` clears only the *username* bucket, so ten sign-ins a minute from one address is
a hard cap however many of them are valid. Correct from one address; behind a reverse proxy with
`TRUST_PROXY` unset it is *every user* sharing one bucket, and the eleventh person to sign in
within a minute is refused. Measured with `scripts/concurrency.mjs`. *Fix: set `TRUST_PROXY=true`
behind a proxy — or clear the IP bucket on success too, which trades a little brute-force
resistance for not throttling a shared egress.*

**No password policy** beyond 8 characters.

**Expired session rows are only deleted when presented**, so a long-lived instance accumulates
them. A boot-time sweep would tidy it.

**`npm audit` reports four moderate advisories**, one chain: `gray-matter` → `js-yaml` 3 →
`argparse` → `sprintf-js`. Clearing it needs a major upgrade of `gray-matter`, which parses every
`node.md`, so it is a deliberate change with its own test rather than an `npm audit fix`.

**Whole-board lifecycle operations take no lock.** `withLock` covers board *content* — `saveGraph`,
node writes, frames, folders — but six paths read, mutate and write a `board.json` (or move its
directory) with no lock at all: `copySelection` (`clipboard/service.ts`, every paste and ⌘D),
`archiveBoard` and `renameBoard` (`boards/service.ts`), `promoteFrame` (`frames/service.ts`),
`getBoard`'s cache write-back, and the cross-board `childBoards` edits in `linkSubBoard` /
`unlinkSubBoard` (`nodes/service.ts`), which write two *other* boards under the first one's lock.

The sharp case is that `writeText` calls `ensureDir` before writing: a `saveGraph` that read a
board just before a rename or archive moved its directory will **recreate the old directory**
after the move, leaving a ghost board on the shelf holding a stale graph — and its slug is then
permanently taken, because `boardSlugTaken` tests the directory.

Found by review, **not reproduced**: `copySelection` was raced against autosave 20 times without
losing data, because the copy's per-node work outlasts the graph write. Treat these as latent
rather than active. *Fix, one at a time with a test each:* wrap each in the board's own lock.
**Do not batch it** — `promoteFrame` calls `createBoard`, and `renameBoard` sits beside
`withBoardRegistry`, so the naive wrapping puts the registry lock inside a board lock. That
establishes `boardFile → boardsDir` in one place and `boardsDir → boardFile` in `createBoard`,
and since `withLock` queues rather than fails, the result is a permanent deadlock rather than
contention.

**An open tab can still hold work it cannot save.** `PUT …/graph` takes the whole graph, so a
stale payload replaces rather than merges — it used to delete, silently, whatever had arrived
while the tab was open. Two things now stand in the way: the board pushes changes over SSE so an
open canvas refreshes itself, and `saveGraph` refuses a payload whose `baseUpdatedAt` no longer
matches the file.

What is left is the residue, and it is a real cost rather than a bug: when the guard fires the
tab keeps unsaved edits that can never be written. Nodes are safe — they are POSTed as they are
made — but links, frames, text annotations and layout since the last save exist only in that tab,
and the banner tells the person to note them and reload. There is deliberately no automatic
recovery: refetching would discard exactly those edits, and merging two whole graphs is a thing
this codebase has no way to do correctly.

**A corrupt `folders.json` breaks the board list, not just the folders.** `listBoards` reads it
on every scan, and `readJson` throws on malformed JSON exactly as it does for `board.json` — so
a hand-edit that loses a brace 500s the dashboard rather than quietly resetting somebody's
organisation. That is the right trade of the two, but it is a new dependency for the board list,
and the file is one people will reasonably hand-edit. *Fix, if it bites: catch at the
`listBoards` call site and serve the boards unfoldered with a warning.*

## Server — MCP and tokens

**`update_node` is two writes, not one.** A patch that changes both frontmatter and body takes
the board lock twice, so another writer can land between them. The two halves are each
consistent; the pair is not atomic. Chosen over nesting locks, which `core/locks.ts` forbids
and which would deadlock. *Suspected to be unobservable in practice — one agent, one board.*

**Search reads whole files to find a substring.** `readText` per node, no streaming, capped at
4 000 files. On a personal instance that is milliseconds; on a very large one a search costs a
full read of the workspace. The caps bound it rather than fix it.

## Consolidation not done

**The two canvas keyboard hooks share ~45 identical lines** — palette, export, copy, the
read-only gate, undo/redo, duplicate, paste, delete, status cycle, drill, open. All of these are
*core* concerns, not world concerns: core reaches a board type only through the registry. This is the highest-value refactor left: it
is the one place the map/graph split produced copy-paste rather than parallel structure, and a
v1.6 rule ("⌘C survives read-only") already had to be written twice by hand.
*Fix: extract `useCoreCanvasKeyboard({ onExport, onPalette, onCreate, onDrill, disabled })` and
let each world layer its own cases on top.*

**`SettingsTab` tails** — the colour section, file paths, sub-board button and danger zone are
near-identical between worlds; the middles legitimately differ.

**Edge components** duplicate the inline label-edit form and the delete button; the path
geometry and styling genuinely differ and should stay separate.

## Copy drift

**"Sub-map" and "sub-board" are both in the UI**, and since v1.5 only one of them is right in
general — a child board can be a graph. Most strings say *sub-board*; a handful predating board
types still say *sub-map*.

Seven user-facing sites, not three. **Four are accurate** — all of `SelectionToolbar`'s
"Promote to sub-map" strings, because `promoteFrame` passes no `boardType` and a promoted frame
always becomes a map. **Two are wrong**: `CardContent`'s `title="Opens a sub-map"` on the
drill-down glyph, and the walkthrough's `▣ Enter sub-map` button — both open whatever the child
is, graph included, and the graph world's own glyph already says "Opens a sub-board", so the two
canvases label the same affordance differently. **One is latent**: the `'Sub-map'` fallback in
`store.ts`'s created-toast never fires, because both call sites pass the world's own label. The
dashboard's "sub-maps" in the All tab is a comment, not user-facing. Three seed scripts also name
the node-panel tab "Sub-maps"; it is labelled "Sub-boards". *Fix: one term, and it should be
"sub-board"; keep "map" only where a map is genuinely what you get.*

## Not bugs, but worth knowing

- **`UNIQUE(board_id, recipient_id)` on `shares`** means two owners cannot share same-slug
  boards with the same person. Detected and reported as a clean 409. The constraint is deliberate.
- **`undo` does not restore `links`**, and `promoteFrame` does not refresh them. *Suspected.*

## Fixed for the public release

**Leaving a board dropped its pending save.** Only some call sites flushed first; the palette,
the walkthrough, browser Back and moving to a shared board did not. The store now flushes in
`openBoard`, `closeBoard` and `setWorkspace`, writes queue in order on a per-opening save line,
and a graph records a dragged dot's position on release rather than when the layout settles.

**Closing the tab saved nothing.** The `beforeunload` save was an ordinary fetch the browser
aborts. It is now a `keepalive` request, sent from `pagehide` as well.

**Canvas shortcuts fired under dialogs.** Backspace with the Export dialog open archived the
selection behind it, and the walkthrough's arrows nudged the node it started from. Overlays now
register with `shared/overlay.ts` and both canvas hooks, and ⌘P, stand down while one is open.

**Context menus did not own the keyboard either.** With the board menu or an edge menu open,
Backspace archived the selection — and the edges on it — behind the menu. `Menu` now registers
as an overlay, and the dashboard asks `overlayOwnsKeyboard()` rather than looking for a modal
backdrop. The ⋯ buttons on board and folder cards also stopped *every* keydown to keep Enter off
the card, so Escape never reached the menu they open; they now stop Enter alone.

**`@fastify/static` advisories.** Upgraded 8 → 10, and `npm audit fix` cleared the rest of the
high and critical findings (`fastify`, `proxy-addr`, the MCP SDK and others). The dot-segment
hook in `index.ts` now also refuses encoded separators (`..%2f`, `..%5c`) with a 400.

**A shared board drew no connections.** `.cg-canvas--readonly .cg-handle { display: none }`
took the handles out of the DOM, and React Flow measures each handle from the DOM to know where
an edge leaves a node — with no box it drops the edge entirely. Only the recipient of a share
ever saw it, which is the one view nobody looks at while building a board. Hide handles with
`opacity` and `pointer-events`, never by unrendering them.

**The shelf sometimes showed only shared boards.** `api.listBoards()` read an ambient
module-level scope that a *different* effect sets, so leaving a shared board fired two summary
loads either side of the scope changing and whichever answered last won. The owner is now passed
explicitly, taken from the URL at the moment of the call, with a generation guard so only the
newest load may set state.
