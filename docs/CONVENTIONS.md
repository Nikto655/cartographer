# Conventions

Rules this codebase holds itself to. Most exist because breaking them caused a bug that is
recorded in KNOWN-ISSUES or DECISIONS.

## Comments

Explain **why**, not what. The code says what it does; a comment earns its place by recording
the reason a decision was made, the failure it prevents, or the assumption it rests on.

```ts
// Bind the callback now, not when the timer fires. `latest` tracks the newest
// render, and the panel may be pointing at a different node by then — firing the
// fresh closure with the old arguments wrote one node's body into another's file.
```

Not `// set the timer`. If a comment would restate the line below it, delete it.

Match the surrounding density. Some files are heavily commented because they encode
hard-won rules; others are plain because they are plain.

## Module boundaries

- Every server module exposes `index.ts`. **Siblings import from `index.js` only**, never
  from a module's internals.
- Trim barrels to what siblings actually import. An export nothing consumes is dead code.
- `core/` depends on nothing in `modules/`. If two modules need to talk and the dependency
  would be circular, put the seam in `core/` — see `core/boardEvents.ts`.
- **MCP tools shape arguments and call a service; they hold no board logic.** A rule about
  boards written in `modules/mcp/tools.ts` is a second implementation of that rule, and the two
  will drift. Reaching past a service to the lock or the volume is the tell, and it is the fifth
  invariant grep. If a tool needs behaviour the services do not have, add it to the service —
  that is how the REST path got batch creation, edge removal and `move_nodes` for free.
- **A module that another module reads must not read it back.** `boards` imports `folders`, so
  `folders` knows nothing about boards — which is what makes its pruning rule expressible at
  all: it cannot ask which boards exist, so it cannot prune by their absence. When a new module
  needs facts from both sides, pass them in rather than importing upward.
- **Validate deployment vocabulary in the service, not at the door.** Statuses, shapes and
  colours are checked in `core/config.ts` and called from the service functions, so the REST
  path and the MCP path cannot disagree about what a valid status is. "The only writer is a
  well-behaved client" stopped being true in v1.7.
- On the client, core may import `@/board-types` but nothing deeper. A world may not import
  another world.

## Filesystem and database

- **All fs access goes through `core/storage.ts`.** All SQLite through `core/db.ts`.
- **Never build a path by hand.** Ask a `Workspace`: `ws.boardFile(id)`, `ws.nodeDir(b, n)`.
  There is deliberately no global `paths` object — its absence is what makes forgetting to
  scope to a user a compile error rather than a leak.
- **Writes are atomic**: temp file + rename, in `writeText`. The temp name is per-call unique.
- **Every read-modify-write of `board.json` runs inside `withLock(ws.boardFile(id), …)`.**
  Do not nest locks; lock at the outermost service function.
- **Minting a slug and claiming its directory are one step.** `uniqueSlug` asks whether a name is
  free and the caller then takes it; anything between the two is a window where a second caller
  hears "free" about the same name. Node ids are safe because node creation already runs under the
  board's lock — board ids were not, and six concurrent creates of one name lost three boards. Take
  `withBoardRegistry(ws, …)` around both halves.
- **Archive, never delete.** Moving to `archive/` is the destructive operation, and a board goes
  down one step at a time — live → `archive/` → `deleted/` — never skipping. Only
  `purgeDeletedBoard` removes anything, it is reachable only by a Super Admin, and it is the
  single sanctioned exception to invariant 6. Take the
  board's snapshots and archived nodes with it, or a later board reusing the slug inherits them.
- **Anything keyed on a board id must subscribe to `emitBoardIdentityChange`** — ids are mutable
  and reusable. Two modules do: `shares` and `folders`. Adding a third store keyed on board id
  without a subscription is how folders silently unfiled every renamed board. Note the asymmetry
  the listener has to honour: `newId === null` is an archive, where the entry *stays* so a restore
  can find it; a non-null `newId` is a rename, where it must move.

## Access control

- Reads: `workspaceOf(req)`. Writes: **`writableWorkspaceOf(req)`**, always. "Which routes can
  write" should stay answerable by one grep.
- A board the caller cannot see is **404, never 403** — do not confirm that it exists.
- Service functions that write opportunistically on a read path must check `ws.canWrite`.
- New route under the guarded scope? It inherits auth automatically. Registering *outside*
  that scope is the only way to expose something, and needs a very good reason.

## Client

- **Selectors must return stable references.** Never return a fresh array or object literal
  from `useStore(…)`. Key on a joined string when you need a derived collection.
- **Distinguish user intent from library chatter.** React Flow emits `dimensions` changes on
  mount and viewport events for programmatic `fitView`; neither should dirty a board. The event
  argument is the discriminator.
- Every mutator that changes a board starts with `if (get().readonly) return;`. Hiding a button
  is not a guard.
- **No raw hex outside `client/src/styles/tokens.css`.** Use `var(--token)`.
- Debounced callbacks bind their target at *schedule* time, not fire time. `flush` flushes; if
  you want to discard, that is a different verb.
- **A React Flow parent makes `position` relative.** Anything that persists a position converts
  with `absolutePosition` first, and anything whose membership the model cannot store must never
  be given a parent at all. `BoardText` has no `frameId`; that absence is the rule, not an
  oversight.
- **Undo entries hang off gesture starts** — `onNodeDragStart`, `onResizeStart` — never off the
  change stream. `dragging: true` arrives per mousemove and the board is not dirty until the
  gesture ends, so inferring one from the other yields an entry per pixel or none at all.
- **A selected frame means its contents.** True for copy, duplicate and export. `selectedIds`
  carries frames and texts as well as cards, so anything that resolves ids against `board.nodes`
  expands frames and drops texts before sending them.
- **An empty result is rarely falsy.** Trim before testing a rendered string for emptiness — a
  document of one newline is truthy, and shipped a blank export past a disabled-when-empty button.
- **React Flow paints nodes over edge labels.** `.react-flow__edgelabel-renderer` and
  `.react-flow__nodes` are siblings at `z-index: auto`, so the nodes layer wins on DOM order
  alone — anything an edge draws at its midpoint is unreadable, and unclickable, under a node
  parked there. One rule in `styles/base.css` lifts the layer; it is safe because React Flow
  gives that layer `pointer-events: none` and each label opts itself back in.
- **Anything rendered markdown acts on must be re-checked against an index.** `marked` passes
  raw HTML through, so every `data-cg-*` hook `safeHtml` whitelists is also something a note body
  can hand-write — and DOMPurify cannot tell ours from theirs. A hook that only *reveals* is safe
  by accident; one that navigates, writes or fetches is not. Look the value up in the same index
  that produced the link, and ignore it when it is not there.
- **Nothing conditional goes in a card's title row.** The row is short of width to begin with,
  so anything that comes and goes there re-wraps the name — a shared board's title broke in a
  different place from an unshared one's, for 30px of badge. Keep that row to the world mark, the
  title and the always-present action cluster; conditional marks belong in the metadata line,
  which has room. The title takes `flex: 1` rather than leaving the slack to a `.spacer`, or it
  is only ever as wide as its own text and wraps early with a gap to its right.
- **One board can be on screen twice, so per-item UI state keys on the card, not the board.** A
  starred board is drawn in Recent's Pinned row *and* in the grid below it. Rename keyed on the
  board id turned both copies into inputs at once, both with focus-on-open — the second stole
  focus, the first fired `onBlur`, and blur commits and closes, so the editor appeared and
  vanished inside one frame. `renderCard` takes a `scope`; anything addressing a single card
  keys on `scope:boardId`.
- **`autoFocus` fires before React attaches `onFocus`.** The focus event from `autoFocus` happens
  during the commit, so a handler that would have run on it never does — a select-on-open written
  that way silently does nothing. Focus from an effect and call `select()` there.
- **A control inside a click-through card stops *every* pointer event, not the first one.** The
  card navigates on click, starts a long-press selection on pointer-down and opens on Enter, so a
  button or input living in it needs `onPointerDown`, `onMouseDown`, `onClick` and `onKeyDown`
  stopped. `InlineEdit` stopped them on the closed span and not on the open input, so renaming
  worked only if you typed it in one pass — clicking into your own text to move the caret
  navigated into the board and unmounted the field.
- **Never centre with `transform` on anything that animates `transform`.** Keyframes *replace*
  the declaration they animate, they do not compose with it, so `left: 50%; transform:
  translateX(-50%)` under `animation: rise` spends the whole animation half a width off-centre
  and snaps into place at the end. Centre with the `translate` longhand, which applies first and
  stacks (`.cg-selection`), or carry the offset through every keyframe (`panel-centre`). The
  `.toaster`/`.toast` split is the third way: position the wrapper, animate the child.

## TypeScript

- `packages/shared` is the single source of truth for anything both sides name. Add the type
  there, then `npm run build:shared` — the server reads the built output, so a type change
  without a rebuild silently serves stale data.
- No `any`. Prefer a narrow local type over widening a shared one.
- Server-computed fields on a shared type (`hasData`, `coverage`, `links`) are optional and
  never written back to disk.

## Verification

Before calling anything done:

1. `npm run typecheck` — all three workspaces.
2. The five invariant greps in [CLAUDE.md](../CLAUDE.md).
3. `npm run smoke` against a **throwaway** instance.
   Touching locking, ids or anything two writers share? `scripts/concurrency.mjs` too — it is the
   only thing that exercises overlap, and it found a real board-losing race the smoke test could
   not see, because every check in that suite runs one request at a time.
4. If the change touches the volume: hash every file before and after, **with no filtering**.
   Suffix filters and path-segment filters both hide changes and report a false "all clear".

**A concurrency assertion must fail when the lock is removed.** If you cannot name the line whose
deletion turns it red, it is measuring your payloads rather than the system — eight concurrent
whole-graph PUTs each carrying every node produce the same file with or without `withLock`. Race
two *different* endpoints and require both effects to survive. The same trap in miniature:
`[].every(…)` is `true`, and a check whose subject never occurred should say so, not report green.

Prove the failure before you fix it where you can, and say so when you could not — "fixed by
construction and exercised" is a weaker claim than "reproduced, then fixed", and the difference
matters to whoever reads it next.

## Writing to the user's data

The `./data` directory holds real content. Develop against copies:

```bash
cp -R data /tmp/scratch-data
(cd server && DATA_DIR=/tmp/scratch-data PORT=3100 HOST=127.0.0.1 npx tsx src/index.ts &)
```

Never delete a SQLite `-wal` file from a copy — it holds everything since the last checkpoint,
and removing it silently reverts the database.

**Stopping a dev server: kill the listener, by port, one port at a time.**

```bash
lsof -nP -iTCP:3100 -sTCP:LISTEN -t | xargs kill
```

- `pkill -f "PORT=3100"` matches nothing: `PORT` is an environment variable, not part of the
  command line.
- `lsof -i tcp:PORT` without `-sTCP:LISTEN` also matches *clients* of that port, so it kills
  whatever is connected to the server, such as an MCP bridge under test.
- `lsof -ti tcp:3100 tcp:5174` reads the second argument as a filename and returns nothing, so
  the kill silently does nothing. Run one `lsof` per port.

Afterwards, confirm the process is gone by its pid, not by asking `lsof` again.

`npm run dev` is the exception: the API runs under `tsx watch`, a parent that survives killing
the listener and holds no port of its own. Stop it with Ctrl-C in its terminal.

For the test suites, `node scripts/throwaway.mjs` starts a ready instance on a fresh temp
directory and prints the pid to stop.
