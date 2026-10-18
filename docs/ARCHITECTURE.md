# Architecture

## The one-paragraph version

Files are the database. A board is a directory: `board.json` holds layout only, and every node
is its own directory with a markdown file and an optional JSON sidecar. The server owns all
writes and is the only thing that touches disk. SQLite exists solely for facts *about* the
system — who exists, who is signed in, what is shared, what an admin did. Delete `app.db` and
you lose your accounts, not your maps.

```
┌────────── client (React) ──────────┐   ┌────────── server (Fastify) ─────────┐
│  app/          chrome, routing     │   │  modules/   routes + services       │
│  board-types/  map & graph worlds  │──▶│  core/      storage, db, links, …   │──▶ data/
│  modules/      panel, dashboard, … │   │             (only fs + only sqlite) │
│  shared/       store, api, ui      │   └─────────────────────────────────────┘
└────────────────────────────────────┘
```

## Layout on disk

```
data/
├── app.db                          # accounts, sessions, shares, tokens, audit. No content.
├── config.json                     # optional: statuses, shapes, colours, theme (global)
└── users/<user-id>/                # one private workspace per account
    ├── boards/<board-id>/
    │   ├── board.json              # nodes, edges, frames, texts, viewport — presentation only
    │   └── nodes/<node-id>/
    │       ├── node.md             # frontmatter (id, title, status, tags, description) + prose
    │       └── data.json           # optional sidecar: labelled snippets, one marked output
    ├── archive/                    # everything ever "deleted" — recover with mv
    ├── snapshots/<board-id>/<ts>/  # manual snapshots (full directory copies)
    └── folders.json                # folders, board→folder assignments, favourites. Absent until used.
```

**Ids are slugs derived from titles.** They are mutable (renaming re-slugs and moves the
directory) and reusable (archiving frees the slug). Anything that keys on one must be
maintained across both — see `core/boardEvents.ts`.

**`board.json` is a cache for presentation.** Titles, statuses, tags and descriptions live in
each node's frontmatter and are re-synced from it on read; the files win.

## Server

```
server/src/
├── index.ts        composition root: hooks, scopes, boot order
├── core/           depends on nothing in modules/
│   ├── storage.ts  ← the ONLY module importing node:fs. Workspace lives here.
│   ├── db.ts       ← the ONLY module importing better-sqlite3. Schema + migrations.
│   ├── locks.ts    per-board serialization of read-modify-write
│   ├── boardEvents.ts  board id changed / board gone → listeners (shares subscribes)
│   ├── links.ts    [[wiki-link]] parsing and resolution
│   ├── markdown.ts frontmatter parse/serialize, coverage
│   ├── data.ts     sidecar read/write, v1→v2 migration
│   ├── layout.ts   where a node goes when nobody said: grid placement, frame geometry
│   ├── ids.ts      edge and frame ids — board-local, never slugs, never path segments
│   ├── migrations.ts  one-shot boot migrations (node dirs, multi-tenancy)
│   ├── config.ts   data/config.json with defaults
│   ├── env.ts      .env loading
│   └── errors.ts   HttpError + helpers
└── modules/        each exposes index.ts; siblings import only that
    ├── auth/       sessions, guard, rate limit, user table
    ├── boards/     board CRUD, saveGraph, listBoards
    ├── nodes/      node CRUD, bodies, sidecars, sub-board links
    ├── shares/     shares table, access ladder, duplicate-to-workspace
    ├── admin/      user management + audit
    ├── clipboard/  duplicate-selection and paste
    ├── snapshots/  create / list / restore
    ├── export/     board or selection → markdown
    ├── frames/     create, membership, promote a frame into a sub-board
    ├── tokens/     personal access tokens: mint, list, revoke, per-token rate limit
    ├── folders/    folders.json read and written whole — arrangement, favourites; knows no boards
    ├── search/     substring search over one workspace's node files — no index, no routes
    └── mcp/        the agent front door: bearer identity, stateless transport, twenty-six tools
```

Module graph is acyclic and all arrows point inward:
`shares → boards`, `clipboard → boards + shares`, `export → boards + nodes`,
`boards → folders`, `mcp → boards + nodes + frames + export + search + snapshots + tokens +
admin + folders`, `tokens → admin` (the audit row, in both cases), everything → `core`.

**`boards` must not import `shares`.** That is why the dashboard's "who is this shared with"
comes from a separate `GET /api/my-shares` rather than a field on `BoardSummary`, and why
rename/archive announce through `core/boardEvents` instead of calling the shares module.

**`boards → folders` runs one way, and `folders` must not import `boards`.** `listBoards` reads
`folders.json` once per scan and merges `folderId` and `favorite` onto each summary; the folders
module has no board list and wants none. That absence is what decides the pruning rule: a read
drops an assignment whose *folder* is gone, because the mapping points at nothing, but keeps one
whose *board* it cannot see — it cannot tell an archived board from a deleted one, and guessing
wrong would quietly unfile every board waiting under `archive/` to be restored.

### Request path

```
onRequest  reject dot-segments (…/../…)            → 400
onRequest  requireAuth  → req.user, req.ws, req.access='own'
           (or workspaceAccess on /u/:ownerId → readonly + req.visible)
preHandler assertBoardVisible  → invisible board is a uniform 404, never 403
preHandler auditBoardOpen      → one row per admin-granted board, per session
handler    writableWorkspaceOf(req) for writes → 403 read_only unless access==='own'
service    withLock(ws.boardFile(id), …) → read-modify-write → atomic write
```

An agent takes the other door, and rejoins the path at the service call:

```
handler    identify(Authorization: Bearer cart_…) → {userId, tokenId, scope}, else 401
           per-token rate limit, 120/min          → 429
tool       write scope checked, then workspaceFor(userId) → the same Workspace
service    the same function the route calls, under the same board lock
```

48 routes under `/api`, plus `POST`/`GET`/`DELETE` on `/mcp`. **Every `/api` route except
`POST /api/auth/login` is behind the wall**, because `requireAuth` is a hook on a Fastify scope
that everything else is registered inside — a new route inherits it by default. `/mcp` is the
one route outside that scope, and it authenticates itself instead.

### Access model

Three facts are kept separate on purpose:

- `req.access` — `'own' | 'readonly'`. Governs whether you may write.
- `req.grant` — `'own' | 'share' | 'admin'`. How you got here; only `admin` writes audit rows.
- `req.visible` — the set of board ids addressable, or `null` for "everything here".

Resolution ladder (`modules/shares/routes.ts` → `workspaceAccess`): own → admin → share → 404.
This inverts the spec's own → share → admin; see DECISIONS.

`Workspace.canWrite` is a fourth, quieter fact: reads that opportunistically write (cache
reconciliation, sidecar migration) run *below* the route guard, so the workspace object itself
has to say whose files these are.

### The MCP surface

`modules/mcp/` is a second front door onto the services the REST routes already call: every
tool in `tools.ts` is argument-shaping, one service call and a JSON reply, and a rule about
boards appearing in that file would mean the rule is in the wrong place — that is what stops
the agent surface and the app drifting apart. It is mounted at `/mcp` beside `/api` rather than
inside it because an MCP client presents `Authorization: Bearer cart_…` and no session cookie,
so it cannot pass `requireAuth` and authenticates itself in `identity.ts` instead: hash the
secret, resolve the row, count the call against the token's ceiling, mark it used. What comes
back is a user id, and a user id is a `Workspace` through the same `workspaceFor` every request
uses — which is why tenancy needed no new rules, and why the tools take no owner argument at
all. There are no MCP sessions: every request carries its token and is decided on its own, so
nothing can outlive a revoked token or be lost to a restart.

Twenty-six tools, seven read and nineteen write. One of them is there to stop the caller guessing:
statuses, shapes and colours are per-deployment (`data/config.json`), so `get_config` hands back
this deployment's vocabulary and every field that takes one says to read it first. The matching
refusal lives in `core/config.ts` rather than in a tool, so `assertKnownStatus` guards the REST
path too — an unknown status used to reach the frontmatter, where the card fell back to
*sketched* and the status strip left the node out of its totals.

## Client

```
client/
├── index.html     the shell: title, favicon link, root div
├── public/        copied to the bundle root verbatim
│   └── favicon.svg    the app mark, colours written out literally — a favicon
│                      renders isolated from the page, so CSS custom properties
│                      resolve to nothing there. Outside src/, so it does not
│                      contradict the tokens.css rule below.
└── src/
    ├── app/           App shell, Chrome (breadcrumb, toolbars), routing
    ├── board-types/   the world registry — see below
    ├── modules/       auth, dashboard, folders, editor (node panel), share, admin,
    │                  palette (⌘K), walkthrough, export, tokens
    ├── shared/        store.ts (Zustand), api.ts, links, canvasActions, ui/
    └── styles/        tokens.css ← the only place raw colour values may appear
```

### The board-type registry

```
board-types/
├── registry.ts        { map, graph } — the ONLY file core may learn a world from
├── nodeTypes.ts       node type → renderer + panel tabs, with a default fallback
├── types.ts           BoardTypeDefinition, NodeTypeDefinition, NodeTabProps, …
├── map/               canvas/ + node-types/classic/   (cards, chips, frames, texts)
└── graph/             canvas/ + node-types/entity/ + controls/   (d3-force, dots)
```

Core imports `@/board-types` and nothing deeper. An unknown board type or node type falls back
to a default rather than erroring, which is what lets a classic node pasted into a graph render
as an entity with no special casing.

Each world renders its own edges, and the two now agree where it counts: both canvases put the
same `MarkerType.ArrowClosed` in `defaultEdgeOptions`, so a drawn edge points somewhere in the
graph world as well as on the map. Graph edges were originally drawn plain, on the
grounds that direction is an authoring detail there — but an edge stores a source and a target
either way, and a reader arriving from a map should not have to learn that the same line means
something different. Derived `[[wiki-link]]` edges stay arrowless, and not by a conditional:
`EntityEdge` passes `markerEnd` down to its `BaseEdge` and `DerivedEdge` simply never
destructures it. A mention notices something; a drawn edge points somewhere.

### The store

One Zustand store, ~1550 lines. It is genuinely cohesive: nearly every mutator runs
`pushHistory → set → scheduleSave`, and undo/redo, autosave and the clipboard all need the same
graph state. Two things in it do *not* belong and are the extraction to make if it grows:
the board↔React-Flow mapping functions (pure, ~180 lines) and the library slice
(`config`, `summaries`, `shared`, `sharedByMe`, read only by the dashboard).

Read-only mode is one flag with 33 mutators short-circuiting on it, plus suppressed
affordances. The flag and the API's board-URL scope move together in `setWorkspace`, so they
cannot drift.

**A selection is not a list of nodes.** `selectedIds` carries frames and text annotations
alongside cards, and only a card has a file behind it, so anything that matches a selection
against `board.nodes` has to expand it first: a selected frame means its members, and a text
means nothing at all. Copy and duplicate have always read it that way; the export dialog now
does the same, and falls back to the whole board when the expansion leaves nothing usable.
Passing a frame's own id through matched no node and produced a document of one newline — a
blank file that downloaded without complaint.

## Data flow, end to end

Opening a board:

1. `GET /api/boards/:id` → `getBoard` reads `board.json`, then every `node.md` and `data.json`
2. frontmatter wins: titles/statuses/tags/descriptions overwrite the cache (written back only
   if `ws.canWrite`)
3. `[[links]]` are parsed from the bodies and attached — never stored. The server resolves them
   against nodes only; the *client* also resolves a title no node claims against the board's
   sub-boards, which is why board links are a rendering concern and never reach `links[]`
4. client maps board → React Flow nodes via `boardToFlow`, the world's canvas renders them

Editing a node:

1. panel writes `PUT …/nodes/:id/body` (debounced 800 ms, bound at schedule time)
2. server rewrites `node.md`, touches `board.json`, both under the board's lock
3. canvas autosave (`PUT …/graph`, debounced 1000 ms) carries layout separately
