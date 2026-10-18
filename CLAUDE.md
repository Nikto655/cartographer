# Cartographer

A self-hosted visual thinking tool. Boards of linked nodes; **every node is a markdown file
on disk**. Multi-user since v1.6, with private workspaces and view-only sharing. Since v1.7 an
MCP server at `/mcp` lets an agent read and build boards with a personal access token.

npm workspaces monorepo: `packages/shared` (types + constants, zero runtime deps) ·
`server` (Fastify 5, ESM, NodeNext) · `client` (React 18, Vite 6, Zustand, React Flow v12).

Start here, then read `docs/` as needed:

| Doc | For |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how the code is laid out and how a request flows |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | the rules this codebase holds itself to |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | run it, seed it, test it, recover it |
| [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) | open defects — check before "discovering" one |
| [docs/DECISIONS.md](docs/DECISIONS.md) | why things are the way they are |

The app was built to a series of specs, v1.0 and v1.1–v1.8, which are not part of this
repository. Comments like `v1.6 §2` cite them. Read them as history: the code and `docs/` are
the source of truth, and `docs/DECISIONS.md` records the reasoning that matters.

## Running it

```bash
npm run dev          # API :3000, client :5173
```

Sign in at http://localhost:5173. Credentials come from `.env` (git-ignored) on first boot
only, for Docker and dev alike (see docs/CONFIGURATION.md) — after that they live in `data/app.db`. If nobody can sign in, see OPERATIONS.

```bash
npm run typecheck    # must pass before you call anything done
node scripts/throwaway.mjs     # a ready test instance (after npm run build); prints what the next two need
npm run smoke        # 145 end-to-end checks against that instance
node scripts/concurrency.mjs   # 33–34 overlap checks — run this when you touch locking or ids
node scripts/routes.mjs        # 2448 connector routes, no server — bundle it first, see the file's header
```

## Invariants

These are load-bearing. Each is one grep, and each exists because breaking it caused a real
bug. Check them before you finish.

```bash
grep -rln "node:fs" server/src | grep -v core/storage.ts          # must be empty
grep -rln "better-sqlite3" server/src | grep -v core/db.ts        # must be empty
grep -rn "board-types/\(map\|graph\)" client/src --include="*.ts*" \
  | grep -v "^client/src/board-types/"                            # must be empty
grep -rn "#[0-9a-fA-F]\{6\}" client/src --include="*.css" --include="*.ts*" \
  | grep -v tokens.css                                            # must be empty
grep -n "withLock\|readBoardFile\|writeJson\|writeText" \
  server/src/modules/mcp/tools.ts                                 # must be empty
```

1. **`core/storage.ts` is the only module that touches the filesystem.**
2. **`core/db.ts` is the only module that touches SQLite.**
3. **There is no global path builder.** A file can only be named through a `Workspace`
   obtained from `workspaceFor(userId)`. Forgetting to scope to a user does not compile.
4. **Core must not know what a graph is.** `client/src/board-types/` is a registry; core
   imports `@/board-types` and nothing deeper.
5. **The DB stores facts about the system; files store content.** No board or node data ever
   goes in `app.db`. Deleting `app.db` loses accounts, not maps.
6. **Archive, never delete — with exactly one exception.** Every destructive action moves files:
   `boards/` → `archive/boards/` (the owner's Archive tab, restorable) → `deleted/boards/` (out of
   the owner's world; only a Super Admin can see it). The exception is
   `DELETE /api/admin/users/:userId/deleted/:entry`, which removes files and is the only code in
   the system that does. It is admin-only, audited, and confirmed with a dialog in the UI. If you find
   yourself adding a second `removePath` on a content path, you are breaking this rule.
7. **Writes are atomic** (temp file + rename) and **serialized per board** (`core/locks.ts`).
8. **MCP tools contain no board logic.** Every tool in `modules/mcp/tools.ts` shapes arguments,
   calls the same service function a route calls, and returns JSON. Reaching past a service to
   the lock or the volume is the tell, and it is the fifth grep — a rule about boards written
   there is a second implementation, and the two will drift.

## Things that have actually bitten

- **Board and node ids are slugs, and renaming re-slugs them.** `PATCH …/nodes/:id` returns
  `renamedFrom` so a client can follow. Anything keyed on an id must follow a rename and let
  go on archive — that is what `core/boardEvents.ts` is for. Slugs are *reusable*, so a stale
  reference is not merely dangling, it can point at someone else's new board.
- **`PUT /boards/:id/graph` treats an absent key as "leave this alone".** A partial payload
  must never empty a board.
- **React Flow reports things that are not user intent.** A `dimensions` change on mount and a
  programmatic `fitView` both arrive as events; persisting them marks a board dirty and
  rewrites it for merely being opened. Guard on the event argument.
- **Zustand selectors must return stable references.** One returning a fresh array caused an
  infinite render loop. Key on a joined string; see `client/src/shared/links.ts`.
- **Reads must not write in someone else's workspace.** `getBoard` reconciles its cache and
  `readNodeData` migrates sidecars — both check `ws.canWrite`.
- **The MCP mount is stateless, and that is a reliability decision.** No session ids are issued,
  so a restart, a deploy or an idle client can never present one that no longer exists — the
  failure that reads as "the agent stopped working until I restarted it". The bearer token is
  what says who is calling, on every request, so workspace isolation does not depend on anything
  being remembered between them. A fresh `McpServer` per request is the price; it is a few ms.
- **`createdVia` is the server's to set.** The canvas sends it back in the graph payload, and
  `saveGraph` ignores it — attribution comes from the write that made the node, never from a
  client that could relabel a robot's work as its own.
- **A React Flow parent makes `node.position` relative.** Anything that saves a position must go
  through `absolutePosition`, and anything the model cannot store membership for must never be
  given a parent. A text acquired one by being dragged into a frame, and its relative
  coordinates were written as absolute — a save that looked like it failed but wrote the wrong
  number. `BoardText` has no `frameId`; that absence *is* the rule.
- **Undo entries hang off gesture starts.** `dragging: true` arrives on every mousemove, so
  inferring a gesture from the change stream gives either one entry per pixel or none at all —
  both shipped. Use `onNodeDragStart` and `onResizeStart`.
- **A selected frame means its contents**, for copy, duplicate and export alike. `selectedIds`
  holds frames and texts too, and passing those ids to something that matches against
  `board.nodes` silently yields nothing — an empty export, not an error.
- **An empty result is rarely falsy.** The export shipped a blank `.md` because `"\n"` is truthy
  and the Download button was guarded on `!preview`. Trim before you test.
- **`PUT …/graph` replaces; it does not merge.** The canvas sends the whole board, so a payload
  built on a stale read deletes whatever arrived meanwhile — by omission, leaving orphaned
  `node.md` files nothing points at. Two things stop it: the board pushes changes over SSE, and
  `baseUpdatedAt` on the payload is refused when it no longer matches. Anything new that writes a
  whole graph needs both, or neither protects it.
- **`node.position` is relative when the node has a frame.** Use `absolutePosition` from the
  store — exported for this. `focusNode` centred the viewport on the raw value and missed by the
  frame's offset (1829 units on a real board), and it fails silently because the node still
  selects and its panel still opens.
- **Locks cover board *content*, not board *lifecycle*.** Rename, archive, promote, paste and
  `getBoard`'s write-back are unlocked read-modify-writes; see KNOWN-ISSUES before adding a lock,
  because the obvious fix creates a lock-order inversion with `withBoardRegistry` and `withLock`
  queues forever rather than failing.
- **A board opens framed, not where it was left.** Both canvases call `fitView` on open and the
  stored `board.viewport` no longer decides it — a remembered scroll position is somebody else's
  place on a shared board and last session's place on your own, and on a graph the dots have
  moved since. The map world waits for `useNodesInitialized`; fitting before React Flow has
  measured anything computes a box out of zeroes and lands nowhere.
- **A guard on `updatedAt` catches your own writes too.** Creating a node, archiving one or
  pasting all write the board through another route, so the canvas moves the timestamp itself
  between reading it and saving. `saveGraph` therefore refuses on *loss*, not on movement: a node
  on disk the payload does not mention. Deletion has its own route, so an omission is never how
  the canvas asks for one.
- **Re-check state after every await, not just before it.** `refreshBoard` stood down when there
  was unsaved work, then applied its answer regardless of what had happened during the fetch —
  and the change event for a node you just created arrives *while the POST is still in flight*.
  A chip could be drawn and never appear, because the refresh landed on top of the only copy that
  knew it was a chip.
- **A text box stores a width, never a height.** `BoardText.width` is set only by dragging one
  of the two side grips; the words decide the height, before and after. Persist `node.width` and
  never `node.measured.width` — the measured one would freeze every text at whatever it happened
  to be the first time the board was saved, and it would never grow with its own text again.
- **`writeBoardFile` is how a board says it changed.** It stamps `updatedAt` and emits, in that
  order, and it is the only place that does — so a `writeJson(ws.boardFile(...))` anywhere else is
  a change nobody hears about. `createBoard` wrote that way, which is why a board an agent made
  never appeared on an open dashboard. The exception is `getBoard`'s cache reconciliation: a read
  announcing a change would have every client refetch on every read.
- **Layout arithmetic belongs on the server.** `core/layout.ts` is pure geometry — it takes boxes
  and edges and gives back positions, knowing nothing about workspaces. `arrangeNodes` and
  `moveNodes` share `applyMoves`, which takes no lock: both callers are already inside `withLock`
  on the board, and taking it again queues behind itself forever.
- **`GET /mcp` is a 405, deliberately.** Nothing on this server pushes to a client, so the
  optional standalone stream is declined rather than opened. Serving it gave a bridge a long-lived
  SSE connection to babysit, and `mcp-remote` gives up permanently after two failed reconnects —
  after which it is a live process that never speaks to the server again, which is what "the agent
  hung" looked like. Do not add a stream back without a reason to push.
- **A connector's sides are computed every frame unless pinned.** `sourceSide`/`targetSide` on
  `BoardEdge` are the author's intent; React Flow's `sourceHandle`/`targetHandle` are this frame's
  consequence of it, recomputed from where the cards are. Store the intent in edge `data`, never
  in the handle fields — the canvas overwrites those on every render. A rerouted end (drawn to a
  collapsed frame instead of the node) ignores the pin, because the face it names is not on screen.
- **An end is moved by two clicks, and React Flow's reconnect drag is not used at all.** The drag
  was built and taken out: its anchors fire the flow's own `onConnectEnd` on every pointer-up, so a
  canvas that makes a node from a dropped-on-nothing connection made one every time somebody missed
  while moving an end — and missing was easy, because the anchor is small and the card, its handles
  and the edge's own pill are all competing for the pointer along the way. `detachEnd` lifts an end,
  a click on any face puts it down and pins it there, and `cg-canvas--attaching` is what makes the
  faces targets. Nothing in the canvas passes `onReconnect`; do not reintroduce it without solving
  the `onConnectEnd` overlap first.
- **A connector drawn between two faces stays on them.** `onConnect` keeps
  `connection.sourceHandle`/`targetHandle` as the edge's pins, because choosing where to start and
  end the drag *is* the author saying where it should meet the cards. Throwing them away — which is
  what it did — left a connector that jumped to a recomputed face the moment either card moved, and
  no amount of pinning afterwards explained why the one you had just drawn did not hold.
- **`nodesConnectable` does nothing unless `isConnectable` is forwarded.** `CartographNode` does
  not pass it to `CardContent`, so every handle defaults to connectable and the prop is inert —
  the CSS in `.cg-canvas--heads` is what actually stops them taking the pointer. Do not forward
  it to "fix" this: an unconnectable handle is not a valid drop target either, so every attempt
  to move a connector's end onto one would fail instead of only the ones that miss.
- **A connector's grips live in the label layer, not in its own SVG.** Edges paint under nodes, so a
  grip sitting a standoff off a card — seven units, since the standoff shrank to the arrowhead's
  length — was *behind* that card, and the card took every click meant for it. React Flow's
  `.react-flow__edgelabel-renderer` carries `z-index: 1`, which clears an ordinary node's `0`, so
  rendering them there brings the grips forward and nothing else. Raising `.react-flow__edges`
  instead is the obvious fix and the wrong one: it brings the line's own interaction path with it,
  and then a card cannot be selected anywhere a connector happens to cross it. That layer is
  `pointer-events: none`, so anything drawn in it has to ask for the pointer back.
- **A refresh must not cost you your selection.** `refreshBoard` runs on every board change,
  including the one your own gesture just saved — and it rebuilds `edges` from the file. It carried
  node selection across from the start and edge selection not at all, which was invisible until a
  selected edge had a control on it: dragging a connector's shoulder saved, the save came back, and
  the pill and the grip vanished mid-gesture. It reads as "I can move it once and then it is gone".
  Anything else that rebuilds a collection from the server owes it the same care.
- **A face is approached from outside its card.** A connector arriving at a left face comes from
  the left and travels rightward into it — always. The first version of the router placed the elbow
  by arithmetic alone, so a source sitting to the right of the target's left face produced a line
  that crossed the card to reach its own endpoint, arrowhead on the inside of the face pointing out.
  Every turn in `canvas/orthogonal.ts` is fenced in by a standoff off each face for this reason, and
  `scripts/routes.mjs` checks all 2448 combinations of faces and relative positions. It is a pure
  function, so that test needs no server and no browser — and it is the only thing that looks at the
  awkward geometries at all: cards side by side, one behind the other, both pinned to faces pointing
  the same way (which needs a four-corner wrap, and whose shoulder slides on the *other* axis —
  which is why the router reports its axis instead of letting the caller assume).
- **Angled connectors are routed here, not by React Flow.** `getSmoothStepPath`'s `stepPosition`
  moves the middle segment only when both ends leave on the same axis; give it perpendicular faces
  and every value returns the same fixed elbow. Half the connectors on a board are perpendicular, so
  half of them had nothing to take hold of. Every bend a route has now gets a grip, and the bends
  are **offsets in canvas units from the source end, deliberately unbounded** — a fraction has ends
  and ends become limits, and a bend is meant to go wherever it is dragged. Nothing needs to clamp
  them because the standoffs make any value safe. Changing a connector's *shape* forgets them,
  wherever the change comes from: they describe turns only one of the two shapes has, so keeping
  them means a connector switched to curved and back silently reappears holding a shape nobody can
  see it still has, and the toggle stops meaning "start again". Bends sent in the same call are the
  caller saying otherwise and win. The router is never told a card's *size*, only
  the two anchors and their faces, so it cannot route around what it cannot see: two left faces at
  the same height must travel between the cards, and that is a limit of the inputs rather than a
  defect. What it can always do is pick a default turn that is provably outside the source — which
  is the source's own standoff, never a midpoint, because a midpoint crosses back over the card the
  connector has just left. Two facing ends within 10 units of true are drawn as one straight line
  instead, splitting the difference between them: a side face's anchor sits at its card's vertical
  middle, so two cards of different heights are almost never level to the pixel, and the couple of
  units between them showed as a step by the arrowhead that no amount of dragging could remove —
  because the step was the honest shape of an alignment nobody could achieve by moving cards.
- **A gesture must not save until it ends.** A save comes back as a board change, a board change
  rebuilds the edges, and a rebuilt edge is a new element — which drops the pointer capture the
  drag is holding. Committing on pointer-*down* to take the undo entry was enough to break the very
  gesture it was recording. Take history at the start, write at the end, and redraw in between.
- **An absent board is not a deleted board.** `folders.json` keeps an assignment or a star whose
  board is nowhere on the shelf, because archiving is what deletion is here and a restore has to
  land back where it lived. Pruning the file against the board list looks like tidying and
  quietly unfiles everything under `archive/` — invisibly, until someone restores one.

## Working style

Plan and verify in the main thread; delegate bulk code-writing to sub-agents. **Verify their
claims** — typecheck, an API call, a DOM probe, files on disk. Agents in this project have
reported passing tests that did not hold, and servers "left running" that were dead.

Before touching the volume, back it up and diff it afterwards — hash every file with no
filtering. Suffix and path-segment filters have produced false "all clear" results here twice.
