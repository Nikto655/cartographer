# Cartographer guide

The full reference for running and using Cartographer: deployment, accounts, agents, the
storage layout, every keyboard shortcut and canvas element, and configuration. For an overview,
see the [README](../README.md); for working on the code, start with [CLAUDE.md](../CLAUDE.md).

## Run it

```bash
cp .env.example .env      # set ADMIN_PASSWORD
docker compose up -d --build
```

Every setting is in `.env`, which is git-ignored; [CONFIGURATION.md](CONFIGURATION.md) lists them
all.

The container listens on **56321**, published to `127.0.0.1` only — it speaks plain http, so put a
reverse proxy in front and terminate TLS there. Data lives in the named volume
`cartographer-data`, which survives `docker compose down`. Sign in and change the bootstrap
password: it is a one-time key, and until it is changed the account can sign in and nothing else.
See [OPERATIONS.md](OPERATIONS.md) for backups, `COOKIE_SECURE` / `TRUST_PROXY`, and
working inside the container. The dashboard opens on **Recent** — every board
you have touched, sub-boards included, each one saying which board it lives under, with anything
you have starred pinned in a row above it — and carries three more tabs. **All** is the shelf:
top-level boards with their children nested and foldable beneath them. **Folders** is where you
arrange them, as a grid of folders each summing its boards' statuses into one strip, plus an
**Unfiled** card for everything else. A folder is a label rather than a place — filing a board
moves nothing on disk, deleting a folder deletes no boards, and a foldered board still appears
in Recent and All. Recolour or delete a folder from the ⋯ menu in the corner of its card;
rename it from the breadcrumb once it is open. Boards get filed by being dragged onto a folder,
from a card's ⋯ menu, or several at a time — ⌘-click picks boards out, and a long press starts
a selection on a touchscreen. **Archive** is everything taken off the shelf, restorable with a click. Deleting from there
presents as permanent and removes the board from that account completely — under the hood it moves
to `deleted/`, which only a Super Admin can see or finally empty (see
[OPERATIONS.md](OPERATIONS.md)). `/` focuses the search, which filters whichever tab you are on, and the order — newest, oldest, A–Z, most nodes — applies to
every tab and is remembered between visits. Maps live in
the `cartographer-data` volume (`./data` in development) — plain files, readable and editable
with any editor. Keep the reverse proxy in front
of the container: the login is defence in depth inside that wall, not a substitute for it.

Every new account starts with the **Cartographer Docs** folder — the app explained as boards you
can open, edit and take apart. They are a copy of real boards rather than a generated sample; run
`node scripts/make-template.mjs` to re-capture them after editing.

## Accounts

One account per person, backed by `data/app.db` (SQLite). **The database holds facts about the
system — users, sessions, shares, admin actions. Files still hold all content**, so `app.db` can
be deleted and rebuilt without losing a map.

The first boot with an empty `users` table creates a Super Admin from `ADMIN_USERNAME` /
`ADMIN_PASSWORD` and marks it *must change password* — that password is a one-time key, and the
app refuses to start if neither the variables nor a user exist. Sessions are opaque tokens in an
httpOnly cookie with a 30-day sliding expiry; the profile menu on the dashboard changes your
password (current password required) and signs you out. There is no signup: accounts are created
by an admin.

## Agents

The same server answers MCP at `/mcp`, so an agent can read your maps and build new ones — same
port, same volume, behind the same proxy. **API & Agents** in the profile menu generates a
personal access token (read-only, or read & write), shows the endpoint and hands you a connector
config to paste; the secret is shown once and stored only as a hash.

A token resolves to its owner and nothing else, so an agent sees exactly the workspace you see
and never another person's. It gets twenty-six tools — seven read, nineteen write: list, read,
export, search, and ask what statuses, shapes and colours this deployment defines on one side;
create boards, nodes, notes, links, frames and text annotations, lay out and restyle what it
made, and correct or remove a link it drew, on the other. Nothing archives, deletes a node or a
board, renames a board or shares one — agents create and refine, people destroy and share. It can also file what it builds: list, create and rename folders, and move boards
between them — but never delete a folder, because that would unfile everything inside it. A
status the deployment does not define is refused rather than written. What an agent made wears a
small bot glyph on the card (hover for the token and date), and an agent's first write to a
board snapshots it first, so any run is one restore away from undone.

**A board you have open updates itself** as an agent writes to it — no reload. And if a change
somehow slips past that, the next save is refused rather than allowed to overwrite it: the board
stops saving and says so, rather than silently dropping the work that arrived while you were
looking at it.

## Develop

```bash
npm install
cp .env.example .env       # development only — compose sets its own values
npm run dev
```

The API runs on :3000 (`DATA_DIR` defaults to `./data`), the Vite client on :5173 with `/api`
and `/mcp` both proxied to it — so the endpoint **API & Agents** shows you, the app's own origin
plus `/mcp`, is a working address in dev as well as in production, where one server serves the
bundle and answers `/mcp` itself. The server reads `.env` from the repo root at boot, so
`npm run dev` needs nothing exported by hand; a real environment variable always wins over the
file. `npm run typecheck` checks every workspace; `npm run build` produces `server/dist` + `client/dist`.

## Example board

With the server running, seed a board that exercises every feature — frames, chips, all five
shapes, colours, statuses, coverage, data sidecars, dashed edges, text labels and a sub-board:

Seeding writes through the API, so it signs in first — set `SEED_PASS` (and `SEED_USER`
if you are not `admin`):

```bash
export SEED_PASS='your-password'
node scripts/seed-example.mjs       # a product flow that exercises every feature
node scripts/seed-endtoend.mjs      # frontend → middleware → backend → files
node scripts/seed-guide.mjs         # what everything on the canvas is, and does
node scripts/seed-architecture.mjs  # the plumbing: files, modules, routes
node scripts/seed-graph-example.mjs # a graph world: entities, derived links, ghosts
```

**Cartographer — End to End** is the one to read first: four layers (frontend, the API
in the middle, the backend rules, the files on disk) with five everyday journeys —
opening a map, creating a node, writing notes, moving things, renaming — traced down
through the layers and back up. **How Cartographer Works** is the tour: the vocabulary, a labelled anatomy of a node,
what each panel tab is for, and a live three-node demo of data flowing between nodes.
**Cartographer Architecture** is the same system from underneath — disk, server core,
server modules, HTTP, client — with *Write path* and *Node file lifecycle* as sub-maps.

It creates **Signup & Onboarding** plus its **Setup Wizard Steps** sub-map, and takes a
snapshot. Delete it like anything else: archive it from the dashboard, then `rm -r` the folder
under the workspace's `archive/` if you want it gone for good.

## How the storage works

```
data/
├── app.db                              # accounts, sessions, shares, tokens, audit — no content
├── config.json                         # optional: statuses, shapes, colours, theme
└── users/<user-id>/                    # one private workspace per account
    ├── boards/<board-id>/
    │   ├── board.json                  # nodes, edges, frames, texts, viewport (presentation only)
    │   └── nodes/<node-id>/
    │       ├── node.md                 # frontmatter (+ description, type) + your prose
    │       └── data.json               # optional: labeled snippets, one marked as output
    ├── archive/                        # everything ever "deleted" — recover with mv
    ├── snapshots/<board-id>/<ts>/      # manual snapshots (full folder copies)
    └── folders.json                    # folders, which board is in which, favourites
```

- **The server owns all writes.** The client calls semantic operations; multi-file changes
  (a node is a directory plus an entry in `board.json`) happen inside one server function.
- **Presentation and content are separate.** Position, size, shape and colour live in
  `board.json`; meaning lives in the markdown. A node file makes sense opened in any editor.
- **Archive, never delete.** Every destructive action moves files under the owner's
  `archive/`. Undoing an archive on the canvas moves the files back. Archiving a board
  takes its snapshots with it, so a later board of the same name starts clean.
- **Paths are scoped by account.** A file can only be named through the workspace of the
  signed-in user, so no request can reach another person's boards by construction.
- **Sub-maps are just maps.** Hierarchy is a `parentBoard` / `childBoards` reference, not nesting
  on disk. A node can hold several sub-maps, and an existing map can be linked under one.
- **Folders are labels, not locations.** Which map is filed where lives in `folders.json`
  alongside the boards, never in `board.json` and never in `app.db` — so it travels with a copy
  of the volume, and no directory moves when you file something. A sub-map is never filed on its
  own; it is in a folder because the map above it is.

The app calls each map a **Map**; on disk the folder is still `boards/` and the API still speaks
`/api/boards`, so existing volumes and scripts keep working.

`title` and `status` exist in both `board.json` and the frontmatter. The server writes both in
one operation, and on board load the file wins — files are the truth.

## Keyboard

| Key | Context | Action |
|---|---|---|
| `N` | dashboard / canvas | New map / new node at viewport centre |
| `/` | dashboard | Focus the search |
| `Enter` | node selected | Open editor |
| `Esc` | editor / overlay | Close |
| `Del` / `Backspace` | selection | Archive node(s) / delete edge |
| `Ctrl+K` | anywhere | Command palette / quick-jump |
| `Ctrl+Z` / `Ctrl+Shift+Z` | canvas | Undo / redo |
| `Ctrl+D` | node selected | Duplicate |
| `S` | node selected | Cycle status |
| `E` | node selected | Expand into / open sub-map |
| Arrows | node selected | Nudge 8px (Shift = 1px) |
| `Ctrl+E` | selection | Export dialog |
| `Space` + drag | canvas | Pan |
| `H` | canvas | Arm the move tool — left-drag pans, on nodes as well as empty canvas |
| `1`–`5` | node selected | Set shape |
| `C` | node selected | Toggle card ↔ chip |
| `F` | multi-selection | Wrap selection in a frame (alone: arm the frame tool) |
| `T` | canvas | Arm the text tool |
| `V` / `Esc` | canvas | Back to the select tool |
| `Ctrl+B` / `Ctrl+I` | notes editor | Bold / italic |
| `Ctrl+K` | notes editor | Insert link (the palette moves to `Ctrl+P` while typing) |
| `Ctrl+Shift+8` / `7` | notes editor | Bullet / numbered list |

Drag from a node's edge onto empty canvas to create the next node already linked, with its
title focused — the fastest way to sketch a whole flow. Every tool in the top-centre pill also
supports drag-out: pull a node, chip, frame or label straight onto the canvas.

## Canvas elements

| Element | What it is | Where it lives |
|---|---|---|
| **Node** | A card backed by `nodes/<id>/node.md` (+ optional `data.json`) | files + `board.json` |
| **Chip** | The same node rendered as a compact pill (`C` toggles) | files + `board.json` |
| **Frame** | A section: tinted box, live status strip, collapse, promote-to-sub-map | `board.json` only |
| **Text** | A freestanding label; select it to switch between three sizes | `board.json` only |
| **Edge** | Solid or dashed (dashed = tentative), optional label | `board.json` only |

## Data flow

A node's sidecar holds **labeled snippets**, and at most one is marked ⌁ **Output** — that is what
the node passes downstream. Nothing about inputs is stored: every node computes its **Incoming**
list from the graph, so it can never drift from the upstream truth. Edges whose source marks an
output render violet with a ⌁ pill, live.

The node panel has five tabs:

- **Overview** — description, a preview of the notes, the snippet list with output markers, and
  what flows in. The default.
- **Notes** — the markdown editor with a formatting toolbar and an Edit ↔ Preview toggle.
- **Data** — full snippet editors plus read-only incoming cards.
- **Sub-boards** — the boards attached to this node; each can be a map or a graph: create one, link an existing map, or remove one
  (unlink keeps the map, delete archives it).
- **Settings** — show/hide the description on the card, variant, shape, colour, file paths, archive.

The panel always opens docked to the right edge; the ⤢ button in its header expands it to a large
centred surface (and back). The canvas stays live behind it either way, so clicking another node
still moves the panel — and keeps your expanded view while the panel stays open. Closing it resets
to docked.

Sidecars written before v1.3 upgrade on first read: the old `out` object becomes a snippet marked
as the output, `in` is kept as a plain snippet so nothing is lost, and existing snippets keep their
titles as labels.

Dropping a node ≥50% inside a frame makes it a member; dragging it out clears that. Dragging a
frame moves its members; collapsing one hides them and reroutes their edges to the frame card.
Selecting one means its contents wherever contents are what is meant — copy, duplicate and
Export all read a selected frame as the cards inside it.

**Promote to sub-map** turns a frame into its own map: member files move into the new map's
`nodes/`, edges that crossed the boundary re-point to the drill-down node left behind. It
restructures files, so it is *not* undoable with Ctrl+Z — the server takes a snapshot first, and
the confirm dialog says so.

## Configuration

Drop a `config.json` into the data volume to change statuses, shapes or colours without a
rebuild. [CONFIGURATION.md](CONFIGURATION.md#configjson) has every option and its valid values.

```json
{
  "statuses": [
    { "id": "sketched", "label": "Sketched", "colorToken": "--status-sketched" },
    { "id": "documented", "label": "Documented", "colorToken": "--status-documented" },
    { "id": "built", "label": "Built", "colorToken": "--status-built" },
    { "id": "verified", "label": "Verified", "colorToken": "--status-built" }
  ]
}
```

Colour tokens are CSS custom properties defined in `client/src/styles/tokens.css`.

## Repository

```
packages/shared/   types + constants shared by both sides (zero runtime deps)
server/src/core/   ALL filesystem access (storage.ts), ALL SQLite access (db.ts), markdown, config
server/src/modules/{auth,boards,nodes,snapshots,export,frames,shares,admin,clipboard,
                    tokens,folders,search,mcp}/                   one folder per domain
client/src/board-types/{map,graph}/   the canvas worlds; core reaches them only via registry.ts
client/src/modules/{auth,dashboard,folders,editor,walkthrough,export,palette,share,admin,tokens}/
client/src/shared/{api,store,router,links,canvasActions,ui}/
client/src/styles/tokens.css   the design system — no raw hex lives anywhere else
```

Modules expose an `index.ts`; nothing else crosses a module boundary. Adding a feature
(validation, git history) means a new module folder, not edits scattered across the app — that
is how search and the MCP server arrived without disturbing anything already there.

