# Decisions

Why things are the way they are. Mostly the non-obvious ones — if a choice looks strange, the
reason is probably here.

## Files are the database

A node is a markdown file you can open in any editor, `grep`, and keep in git. `board.json`
holds only presentation — position, size, shape, colour — so losing it costs you a layout, not
your writing. Frontmatter wins over the cache on every read, which means editing a file outside
the app is a supported thing to do.

The cost is that a database's other guarantee — serialized writes — had to be built:
`core/locks.ts`. Two autosave timers (graph 1000 ms, body 800 ms) genuinely overlap, and
without a lock the later write clobbered the earlier one's changes wholesale.

## SQLite holds facts about the system, never content

Accounts, sessions, shares, audit. Nothing about a board goes in `app.db`, so it can be deleted
and rebuilt without losing a single map. This has been a standing rule since v1.6 and it is
worth defending: the moment board data mirrors into a table, the files stop being the truth.

The one concession is that `shares.board_id` and `audit.target` store board *slugs*, which are
derived from titles. That is a reference, not content — but it is what made the next decision
necessary.

## Board ids are slugs, and that has consequences

Ids are slugified titles because a directory called `signup-onboarding` is legible and a UUID
is not. Two consequences fall out, and both were originally missed:

1. **Renaming re-slugs**, moving the directory and repointing `parentBoard`/`childBoards`.
2. **Archiving frees the slug**, and the next board named the same thing takes it.

So a stale reference is not merely dangling — it can silently point at a *different, newer*
board. This was a real access-control hole: a share row left on a freed slug re-granted a third
party read (and copy) access to a private board they were never shown.

`core/boardEvents.ts` is the fix. `boards` announces identity changes; `shares` listens and
follows the rename or deletes the row. The event hub lives in `core` because `boards` must not
import `shares` — the dependency runs the other way.

The alternative was giving boards an immutable UUID alongside the slug. That is the cleaner
long-term answer and remains open; the event hub was the smaller change that closed the hole.

## No global path builder

`storage.ts` exports no path builder for *content*. The only way to name a board or a node file
is `ws.boardFile(id)` on a `Workspace` from `workspaceFor(userId)`. (It does export
`systemPaths`, which names `DATA_DIR`, `users/`, `config.json` and `app.db` — none of them
belongs to a user, so none of them can be reached by forgetting to scope.) This was chosen over passing a `userId` parameter
because with a parameter, a service function that forgets to scope still compiles — a global
`paths.boardFile()` is sitting right there. With the global deleted, forgetting is not
expressible, and the compiler swept the entire codebase during the v1.6 migration.

`Workspace.canWrite` was added later for a gap the route guard could not see: `getBoard`
reconciles its cache and `readNodeData` migrates sidecars, both on the *read* path, so browsing
someone's board edited their files.

## The board-type registry

`client/src/board-types/` is a hardcoded registry, not a plugin system. Core imports
`@/board-types` and learns that worlds exist without learning what any of them is. Unknown
board types and node types fall back to a default rather than erroring.

That fallback is what makes cross-world paste work with no special casing: a classic node
pasted into a graph keeps `type: "classic"`, the graph does not recognise it, and the registry
resolves it to an entity. Its `data.json` rides along inert.

The boundary is enforced by a grep in CI-of-the-mind rather than tooling. It has held.

## Access resolution runs own → admin → share

The original design ordered it own → share → admin. Inverted deliberately: a Super Admin who has
*also* been shared one board in a workspace they can already read whole would otherwise take the
share rung, which **narrows** Admin View to that single tree and skips the audit row. Duplicate
permission is read off the share row rather than the rung, so it is unaffected.

## One prefix for every foreign workspace

Admin browse and share viewing both go through `/api/u/:ownerId/…`, where the original route list
gave admin browsing a prefix of its own (`/api/admin/users/:id/boards…`). The client URL is
identical for both cases (`/u/:userId/b/:id`) and cannot know at navigation time which applies,
so two prefixes were unworkable. One resolver, one ladder, one read-only rendering path.

## Read-only is a store flag, not a second client

Sharing was meant from the start to reuse the admin read-only rendering path — build it once. So
there is one viewer, and `readonly` is a single store flag that 38 mutators check, plus suppressed
affordances. The server enforces independently; the client flag is UX only.

`setWorkspace` moves the flag and the API's URL scope together, because letting them drift is
exactly how a read-only viewer starts writing.

## Three colourless swatches

"Auto", "White" and "Transparent" are genuinely three states. A node's fill is normally decided
by *coverage* — white once notes exist, transparent while empty, which is a useful signal. Auto
preserves that. White and Transparent override it, because before this there was no way to say
either one: the palette's first swatch cleared the colour rather than setting white, so the two
appearances existed with no control that moved between them.

An explicitly-white empty node keeps its dashed border. Colour and coverage are different
facts, and the dashed edge is how the canvas says "nothing written here yet".

## Sub-board sharing is a choice, not implicit

The original design had a share cover the whole sub-board tree implicitly. Shipped as a
per-recipient toggle (`shares.include_children`, default on) so existing behaviour is preserved.
Honoured in exactly one place — `sharedTree()` — so visibility, copy permission, the card's
sub-board count and duplicate-to-workspace all inherit the answer.

## Sharedness is not on `BoardSummary`

A share is a row in the database; a summary describes a file. And `boards` does not import
`shares`. So the dashboard's "shared with N people" mark comes from a separate
`GET /api/my-shares` that the dashboard loads alongside `shared-with-me`.

Only boards with a share row of their own get the mark — a sub-board reachable *because* its
parent was shared does not, since its sharing is not revocable from its own card.

## Migrations that look dead but are not

Three compatibility paths cannot fire on current data and must stay:

Re-measured 2026-07-31, and two of the three justifications have since emptied out — which is
the point of writing the numbers down rather than the impression:

- **v1 sidecar migration** — **zero** v1 `data.json` remain anywhere: 28 sidecars under
  `snapshots/`, all v2. The original reason (20 of 117) is gone. Keep the code anyway — it costs
  nothing and an *older* backup restored into this volume would still need it — but it is no
  longer load-bearing for anything on disk today.
- **Flat `nodes/<id>.md` layout** — still real and still the strongest of the three: **397** node
  files under `snapshots/` use it. `restoreSnapshot` explicitly re-runs `migrateBoardNodeDirs`
  afterwards, which is why the shim exists.
- **`childBoard` singular → `childBoards`** — **no live `board.json` has it any more**; 19 files
  under `archive/` and `snapshots/` still do. Restoring or un-archiving either is what would
  reintroduce it, so the shim stays for the same reason as the one above.

The pre-v1.6 tenancy migration *is* dead on this volume but is the only thing standing between
a v1.5 backup and a broken restore. Retiring it is a deployment decision, not a code one.

## Credentials never live in tracked files

`scripts/smoke.mjs` and the seed scripts take passwords from the environment with no default,
because both are tracked and a baked-in password outlives whatever it was for. `.env` is
git-ignored and is where the real values go.

## The `services/` extraction did not happen, because it already had

The plan for the MCP server (v1.7) opened with "extract `services/`; routes become thin callers",
as the only structural work in that version. On this codebase there was nothing to extract: logic
has lived in `modules/*/service.ts` since v1.0 and the route files were then 60–145 lines of
parameter unpacking. Creating a top-level `server/src/services/` would have meant flattening nine
cohesive modules into one directory and breaking the rule that siblings import through
`index.ts` — paying that cost to buy a property the code already had.

So the MCP tools call `modules/*/index.js` directly, which satisfies what the extraction was *for*: one
implementation, two callers. Five service functions were genuinely missing and were added —
`nodes.createNodes`, `nodes.appendBody`, `boards.addEdges`, `frames.createFrame` /
`setFrameMembership` — because an agent's operations are batch-shaped and additive where the
canvas's are whole-graph. `createNode` now delegates to `createNodes`, so the single-node route
and a fifty-node tool call cannot produce subtly different nodes.

## MCP sessions were stateful, and are now pinned to nothing but the token

The transport supports a stateless mode, which is less to hold. Sessions were chosen first
because the automatic snapshot an agent's first write takes needs to know what "this agent run"
*is* — one snapshot per board per run, not per write and not per process lifetime — and a
session looked like the only boundary that meant that.

That was reversed. Sessions live in memory, so a deploy, a crash or an idle sweep took every one
of them with it, and a client still holding an old id was answered with a 404 it was supposed to
recover from. Some did; the rest stopped working until the person restarted them. The mount now
runs stateless (`sessionIdGenerator: undefined` in `mcp/routes.ts`): every request carries its
bearer token, which is what actually says who is calling, and a fresh `McpServer` per request
costs a few milliseconds. The run boundary moved to the token — a snapshot is remembered per
token, workspace and board for thirty minutes — which is closer to what a run meant anyway: an
agent that reconnects between two writes is the same agent.

The snapshot is taken best-effort and swallowed on failure. A safety net that can refuse the
work it is protecting is a worse failure mode than an occasional missing net, and the board
menu still offers a manual snapshot — but it does mean "one restore away from undone" is the
intent rather than a promise, and OPERATIONS says so.

While sessions existed they raised an access question of their own: an id in a header is a
capability. So a session recorded the token that opened it and refused any other, which made
"unguessable" a defence in depth rather than the only defence. Going stateless removed the
question rather than answering it — no session id is issued, so there is nothing to present
but the token itself.

## An agent's node says who drew it, and the client cannot say otherwise

`createdVia: 'mcp'` and `createdBy: {token, at}` are written by `createNodes` from the MCP
layer's own identity. The canvas round-trips both fields in its graph payload, and `saveGraph`
ignores them entirely — it merges from the stored node. A client that could set `createdVia`
could also clear it, and a mark you can quietly remove is not attribution.

## `move_to_frame` grows the frame

The first implementation left the frame alone: its box is the author's, and growing it moves
furniture nobody asked to move. Exercised end to end, that produced a board disagreeing with
itself — a node recorded as a member sitting outside the box — and on the canvas membership
*is* containment, so the next drag would have resolved it by ejecting the node.

The frame now grows to cover what it took in and never shrinks. It is the smaller intrusion: no
node moves, and the two facts go back to saying the same thing.

## Fourteen tools beyond the original twelve, and why each earned its place

The original design named twelve tools; twenty-six have shipped, and the extras are not scope
creep — each closes a way the twelve were wrong rather than merely incomplete. The four folder
tools and `arrange_nodes` have sections of their own (*Agents may organise, but may not
un-organise* and *Layouts are named, not computed by the caller*); the rest are below.

**`get_config`.** Statuses, shapes and colours live in `data/config.json` and are per
deployment. Without a way to read them, every tool description that mentioned a status had to
hardcode `"sketched", "documented", "built"` as examples — which is this deployment's defaults
presented to the caller as if they were the vocabulary. On an instance that customised them the
descriptions would have been actively misleading.

**`unlink_nodes` and `update_edge`.** `link_nodes` alone can draw a line and never unmake one,
so a caller that mislinked two nodes had no correction short of restoring the snapshot — a
heavy answer to a typo in a label. This does not bend "archive, never delete": an edge has no
file behind it, it lives only in `board.json`, and `saveGraph` has always dropped edges by
omission when the canvas sends a list without them. Removing one is ordinary board editing.
Node and board destruction stays out, which is where the line actually is.

**`move_nodes`.** `create_nodes` accepts a position and nothing else could ever change one, so a
caller could place a node but never move it — and the only way to tidy a board it had already
drawn was to build a *second* board. That is how you end up with duplicates instead of a
corrected map, and it happened on the first real run: a hub with four stacked children had edges
drawn straight across two of them, and there was no way to fix it in place.

Two things fall out of it. Frames are not positioned — each refits around whatever it contains,
shrinking as well as growing, because on the canvas membership *is* containment and a re-layout
that moved the nodes and left the boxes behind would produce a board disagreeing with itself.
And `get_board` now returns `position` and `size`: a tool that moves things is unusable by
anything that cannot first see where they are, which made the read side incomplete too.

**`style_nodes` and `update_frame`.** Colour, shape, chip-vs-card and a frame's tint were all
unreachable, so every frame an agent made came out the same neutral default and a whole map had
one appearance. Colour is not decoration on a board like this — it is how a map says two things
are the same kind of thing without drawing an edge between them, and a toolset that can write
prose but not group by eye is missing half of what the canvas is for.

The subtler half was in `get_config`, which handed back colours as `{id, label}` while
`board.json` stores tokens (`--node-sky`). An agent could be told "mint" and had no way to learn
what to write. It now returns the token too, and anywhere a colour is taken both spellings are
accepted — one name for one colour is the caller's business, not theirs. `null` clears a colour,
which is deliberately distinct from the `clear` swatch: unset lets coverage decide the fill,
`clear` pins it transparent, and both were already real states (see *Three colourless swatches*).

**`create_texts`, `update_text` and `remove_texts`.** Canvas annotations were the last part of a
board nothing could reach. They are not nodes with the chrome hidden — they carry no file, no
notes, no status and no edges — which is why they get their own three verbs rather than a flag
on `create_nodes`, and why removing one is a `board.json` edit rather than an archive.

`get_board` had to change with them: it was returning `texts` as bare strings, so even once an
annotation could be created there was no id by which to edit or remove one. A write surface is
only as usable as the read that addresses it — the same lesson `move_nodes` taught about
positions, learned twice.

## An unknown status is refused, everywhere

`assertKnownStatus` in `core/config.ts`, called from `createNodes` and `patchNode`. Before it,
`status: "in-progress"` was written straight into the frontmatter and then went wrong twice,
quietly: `CardContent` falls back to `--status-sketched`, so the card *looked* sketched, and
`StatusStrip` totals only ids it knows, so the node disappeared from every status bar. Nothing
errored and nothing looked broken.

Validating in the service rather than in the MCP layer means the REST path gets it too. That
was never a real risk from the canvas, which sets status from the list it just read — but "the
only writer is a well-behaved client" stopped being true the moment the MCP server shipped, and the rule
belongs where the write happens, not at one of the two doors.

Only a status being *set* is checked. A node still carrying an id that a later config removed
keeps it and reads fine, because failing to open a board over a vocabulary change would be a
worse cure than the disease.

## Disabling an account suspends its tokens rather than revoking them

`resolveToken` joins `users` and requires `is_disabled = 0`, and it re-resolves on every request
— so disabling someone stops their agents immediately, including one already mid-run. But
`revoked_at` stays null, and re-enabling the account brings the same tokens back.

Cookie sessions behave differently: `setDisabled` calls `killSessions`, so a re-enabled person
has to sign in again while their agent simply resumes. The asymmetry is deliberate — a session
is a thing you can trivially recreate by typing a password, and a token is a thing pasted into
a connector config somewhere you may no longer have access to. Destroying it on a reversible
administrative action would make "disable for a week" a re-onboarding project.

## Graph edges gained arrowheads

Graph edges were originally drawn plain, reasoning that direction is an authoring detail on a graph —
what matters is that two things are related. That is now overridden and the same
`MarkerType.ArrowClosed` the map uses is drawn on a graph's *drawn* edges.

The argument against the original: an edge stores a source and a target either way, the export
already reads them out as "Connects to" and "Connects from", and a reader arriving from a map
should not have to learn that the same line means something different here.

Derived `[[wiki-link]]` edges stay arrowless, and the mechanism is worth knowing because it is
not a conditional: the canvas's `defaultEdgeOptions` carries the marker, `EntityEdge` passes it
to its `BaseEdge`, and `DerivedEdge` simply does not destructure `markerEnd`. Spreading props
into that component would quietly promote every mention into a relationship.

## Undo hangs off gestures, not off the change stream

React Flow reports a drag as a `position` change carrying `dragging: true` — on **every
mousemove** — and a board is not dirtied until the drag ends. History used to be pushed from
`onNodesChange` on the first such change, guarded by `saveStatus !== 'dirty'`, which was one
guard doing two jobs and failing both: on a clean board it recorded an entry per mousemove, so
⌘Z rewound a few pixels; on a board with anything unsaved it recorded none, so ⌘Z skipped the
move entirely. Resizes were never recorded at all.

A gesture has a start, and the library already reports it. `onNodeDragStart` on both canvases
and `onResizeStart` on both resizers each push exactly one entry, taken before the first pixel
moves. Nothing infers a gesture from the change stream any more.

## A text is not a member of anything

`BoardText` has no `frameId`, so a text's frame membership is unstorable — but React Flow will
accept a parent for any node and then report its position *relative* to that parent. The map
canvas's drag-stop excluded only frames from membership, so dragging an annotation into a frame
gave it one, and the relative coordinates were saved as though absolute. On reload, with no
parent to subtract, the annotation reappeared somewhere else: a save that looked like it had
failed but had actually written the wrong number.

Texts are now excluded from membership alongside frames, and `splitFlow` converts a text's
position with `absolutePosition` like a card's — belt and braces, since a stale parent must not
be able to corrupt a save. The rule underneath: an annotation is canvas furniture, a caption
*over* a band rather than a thing *in* one, and the model already said so by leaving nowhere to
put the membership.

## A selected frame means its contents

Everywhere it comes up — copy, duplicate, and now export. The export dialog took
`selectedIds` straight from the canvas, which holds every selected node including frames and
texts, and sent a frame's id to a server that matches ids against `board.nodes`. Nothing
matched, so the document came back as a single newline — and the Download button stayed enabled,
because `"\n"` is truthy. A blank file, no warning, on a board made of frames.

A selected frame now expands to its member cards, texts are dropped, and an empty result falls
back to the whole board. The guard is on `preview.trim()` rather than `preview`, which is the
sharper half of the lesson: a whitespace-only result is empty for every purpose except
JavaScript's.

## API & Agents is a dialog, not a settings page

The original design placed it at "profile → API & Agents", which reads as a page. There is no
settings route in this client — self-service password change is a modal off the profile menu —
and adding one for a list of at most 25 rows would have been the app's first settings page built
for its smallest concern. It is a 520px modal in the same place, holding the endpoint, the
connector snippet, the generate form, the one-time secret and the list.

## Search has no index

`search_nodes` opens every `node.md` in the workspace, every time. An index would be a second
copy of the truth, and editing a node file outside the app is a supported thing to do here — so
it would go stale in exactly the case the feature exists to serve. What keeps it honest instead
is a ceiling: 50 results, 4 000 files opened, and a `truncated` flag so a caller is told when it
was cut short rather than shown a confident partial answer.

## Folders are metadata, and the design contradicted itself about forgetting them

The folder design (v1.8) said both that assignments referencing missing boards or folders are
pruned on read, and that an archived board's assignment is deliberately kept so a restore lands
it back where it lived. Both cannot hold.

The specific rule won. An assignment pointing at a **folder** that no longer exists is dropped —
it names nothing and never will again. An assignment whose **board** is absent is kept, because
absence is not deletion here: archiving is a move under `archive/`, and the board may come back.
Pruning by absence would discard exactly the case the second rule exists to protect, and the loss is
invisible until somebody restores a board a month later and finds it unfiled. Favourites follow
the same rule. The cost is one dormant line per genuinely-deleted board, which is nothing.

The direction of the dependency is what makes this expressible: `boards` imports `folders`,
never the reverse, so `readFolders` cannot ask which boards exist even if it wanted to. Pruning
takes no board list because it must not have one.

## Folder colours are tokens, like every other colour

The original folder design stored `"color": "sky"`. Everything else in this system stores the palette
*token* (`--node-sky`) because the client renders `var(${color})`, and a second convention would
mean a client-side id→token map that only folders needed. Writes accept either spelling and
normalise through `resolveColor`, which already refuses unknown colours — so `"sky"` is valid
input, it just is not what lands on disk.

## Sort and multi-select reach Recent too

The original design scoped both features to the arranging views: Recent was fixed at
newest-first, and selection was given to All and Folders. Shipped that way, and both readings
failed the same way in use — the dashboard *opens* on Recent, so the sort control was absent from
the first screen anyone sees and the app looked to have no sort at all, and a ⌘-click that
selects on one tab and silently opens a board on another reads as a bug rather than as a rule.

The reasoning behind each was sound and is still visible in the code: Recent answers "what was I
doing", which is a time question. But neither justified *hiding a control*. Recent now honours
the same four orders — sorted where it is rendered, since it draws a flat list off `summaries`
rather than the `roots` tree — and selects with the same modifier and long press as everywhere
else.

One asymmetry stayed: `compareBy` takes `favoritesFirst`, and Recent passes `false`. Starred
boards lead every other ordered view, but Recent already draws them in a Pinned row above the
grid, and leading the grid with them too would say the same thing twice.

## Folder colour and delete live on the card, not in the open folder

They were in the header of the opened folder, beside the breadcrumb — which meant recolouring
one folder took two clicks and an open, and the two actions sat somewhere no other card in the
app keeps its actions. They are now a ⋯ menu in the corner of the folder card, the same corner,
glyph and hover as a board card's. The palette is a swatch row inside the menu rather than a
submenu: `Menu` has none, and picking a colour is something you do by looking. It writes on
click and leaves the menu up, so trying two is one gesture.

Renaming stayed on the breadcrumb, because that is where the name is. **Unfiled** gets no menu —
it is a tally and a drop target, not a folder, and there is nothing on it to recolour or delete.

## Super Admins are searchable in the share dialog, not listed in it

The candidate list is "who else is on this instance", which put the admin account at the top of
*who would you like to share this with* — a role rather than a colleague, and the first thing a
person's eye lands on. Sharing with an admin is not forbidden and is sometimes exactly right, so
this is a listing decision and not an access rule: the server still delivers the account as a
candidate, now carrying `isSuperAdmin`, and typing the name finds it and shares normally.

The flag is `isSuperAdmin?: true` and absent for everyone else rather than `false`, so the wire
says nothing about the ordinary case. And the empty line had to learn a second sentence: "No one
else to add" is a lie while an admin sits behind the search, so with the list otherwise empty it
reads *Search by name to add an administrator* instead. A hidden thing that reports itself as a
missing thing is the failure worth avoiding here.

## `[[Title]]` reaches boards, and the node index is still asked first

The `[[` popover lists three sections — **Nodes**, then **Sub-boards**, then **Boards** — and a
title no node claims resolves to a board instead, rendered with a `↗` and navigating rather than
revealing.

Sub-boards keep a section of their own even though the resolver does not distinguish them:
"the children of what I am reading" is a different question from "anything on the shelf", and it
is nearly always the shorter answer. That split is presentation only — one index resolves both,
because a written title either names a board or it does not, and which list you picked it from
is not recorded anywhere and could not be.

Two indexes, not one, and the order between them is the whole design. Nodes keep every title
they already claimed, so no note anywhere means something different for this feature existing,
and a node created later silently takes its title back from a board. A sub-board whose name a
node already uses is simply left out of the popover: the brackets cannot express the difference,
so offering it would promise a link that resolves elsewhere.

The `/` in `[[board/node]]` stays reserved and inert, as it has been since v1.5 — this is not
that. It is a child of the board you are on, named plainly, which is why it needs no new syntax
and why a board link written on one map is meaningless copied to another.

Both lists come from `summaries`, which is workspace-scoped — so browsing somebody else's shared
tree offers theirs, and `boardHref` keeps the jump inside their workspace instead of landing on a
same-slug board of your own. The open board is left out of its own list.

Nothing new is written to the file: a board link is the same `[[Title]]` text a node link is,
and resolution happens at render time on the client. The server's `links[]` still means
node-to-node only, so backlinks and the graph world's derived edges are untouched by this.

**The click handler checks the id before following it.** `marked` passes raw HTML through, so a
note body can hand-write `data-cg-board="…"` — and it now survives sanitising, because
`safeHtml` has to whitelist the attribute for our own links to work. `data-cg-node` was
harmless without a check (`revealNode` no-ops on an id the canvas lacks); navigation is not, so
only ids in the sub-board index are followed. Confirmed by planting one and clicking it: the
attribute survived, the navigation did not happen.

## Looking at a board is not changing it

`setViewport` used to `scheduleSave()`, so a pan or a zoom wrote the whole board back and
stamped `updatedAt`. Opening a map, scrolling to read it and leaving pushed it to the top of
Recent as though it had been edited — which makes the recency list describe attention rather
than work, and those are not the same thing. Every such write was also another chance for an
open tab to clobber a change some other writer had made meanwhile (see KNOWN-ISSUES).

The viewport is still persisted; it just no longer *causes* a write. `saveNow` reads it from the
store at send time, so it rides along with the next real change. What is genuinely lost is a pan
you make and never follow with an edit. That is the trade, and it is the right way round: a
board's timestamp should answer "when did this last change", and a viewport nobody will look at
again is not worth a write to the volume.

Opening a node was the same bug wearing a different hat — revealing a node pans the canvas.

## Shift-click ranges are gone

They needed an anchor and a screen order, and the dashboard grid has neither honestly: cards are
drawn from several lists (roots and their children in All, a folder's own list and Unfiled in
Folders) and no single array is in screen order, so the range had to be recovered by reading
`[data-board-id]` back out of the DOM. A selection mechanism whose only correct definition is
"whatever the document happens to say" is one to delete rather than maintain — especially once
Recent could select too, where the Pinned row lists some cards twice and the DOM order is
therefore not even a sequence. ⌘-click and long press cover the same ground without a model of
the screen.

## Move is a tool, not only a modifier

Panning already had three gestures — middle-drag, right-drag, and `Space` + drag — and every one
of them is invisible to somebody holding an ordinary mouse. On the pane a left-drag draws a
selection box; on a node it moves the node. So the most natural thing to try was the one thing
that did not pan.

`pan` joins the tool pill beside Select, on `H`. Armed, it adds button 0 to React Flow's
`panOnDrag` list and turns `nodesDraggable` off — the second half matters more than the first: a
node that slid out from under the hand would make the tool useless on a full board, which is
exactly where you reach for it. The cursor goes to `grab` over the whole canvas rather than only
the pane, because with it armed a drag on a node pans too, and a crosshair there would promise
placing something.

It arms and disarms like every other tool, so `V` and `Escape` return to Select and nothing
about the gesture is modal beyond the pill saying so.

## Renaming a board card starts from its menu

The card title was an `InlineEdit` that opened on its own click, inside a card whose click opens
the board. The name is the most obvious thing to aim at when you mean "open this", so the most
common intent hit the least common action, and you landed in a text field with a caret in
somebody's title.

`InlineEdit` grew an optional controlled mode: pass `editing` and the parent owns activation,
and the closed label renders as plain text with no role, no `tabIndex` and no "click to rename"
— an affordance the click no longer honours is worse than none. Rename now sits in the ⋯ menu
with the other deliberate acts. The folder breadcrumb keeps the old self-activating behaviour,
where the name is a heading rather than a target.

The state keys on `scope:boardId`, not on the board id, because a starred board is drawn twice
in Recent — once in the Pinned row and once in the grid. Keyed on the board, both copies became
inputs at once and both took focus on open; the second won it, the first blurred, and blur
commits and closes. The editor opened and shut inside one frame, so the menu item looked inert.
That shipped, and it was reported.

Opening selects the whole name, so typing replaces it, and that has to be done from an effect:
`autoFocus` focuses during the commit, before React attaches `onFocus`, so a `select()` hung off
that handler never runs.

## Agents may organise, but may not un-organise

The MCP server (v1.7) drew the line at "agents create and refine, people destroy and share", and
folders sat on the person's side of it: `list_boards` reported the folder a board was in and said
outright that an agent could not change one. That held while the only thing an agent could do was
add to a shelf it could not see. It stopped holding the moment a run could produce ten boards and
leave every one of them loose for a person to file by hand.

So the line moved rather than went. `create_folder`, `update_folder` and `file_boards` are
writes an agent can make; **no tool deletes a folder**. Deleting one is not like deleting a
board — nothing is archived and nothing is recoverable, because a folder *is* the arrangement,
and dropping it silently unfiles everything inside. That is the destructive act here, and it
stays a person's.

Folders are addressed by **name**, not id. `list_boards` already reports the name, so taking one
is what lets an agent file a board without a separate id-tracking step; ids are accepted too and
`list_folders` shows them, but nothing requires you to carry one.

The service grew per-folder functions rather than the tools reading and rewriting the file. An
agent holds no arrangement of its own, and making it merge one to file a single board is exactly
how a partial payload erases a shelf — the same reasoning that gave `addEdges` and `move_nodes`
their own service functions instead of routing everything through `saveGraph`.

## Board creation is serialized per workspace

`uniqueSlug` asks whether a directory exists and the caller then writes it — check-then-act with
an `await` in the middle. Two creates of the same name overlapping both heard "free" and both
wrote `board.json` to the same path, so the second silently replaced the first. Measured, before
the fix: **six concurrent creates of one name produced three boards and lost three.** Nothing
reported an error; the shelf simply came back short.

`withBoardRegistry` holds the mint and the directory claim together, keyed on the workspace's
`boards/` directory — so two *people* never wait on each other, only two writers inside one
workspace, which is the only pair that can collide. Duplicating a board, re-slugging on rename
and copying a shared tree take the same lock, because each of them mints a board slug the same
way.

Creating a sub-board also read, modified and wrote the parent unlocked, so two sub-boards made
under one parent at once lost a `childBoards` entry — and with it the only route from the card to
the board it made. That now runs under the parent's own lock, *outside* the registry lock:
`core/locks.ts` forbids nesting, and this is precisely where it would have crept in.

## `absolutePosition` is exported, because "where is this node" has one answer

`focusNode` centred the viewport on `node.position`. For a node inside a frame that is the
position *relative to the frame*, so following a `[[wiki-link]]` or a ⌘K jump landed the viewport
short by the frame's own offset — measured at **1829 units** on the product-outline board, where
21 of 30 nodes are framed. It fails quietly: the node still selects and its panel still opens, so
it reads as "the canvas didn't follow" rather than as a bug.

The rule was already written down (CLAUDE.md, and the `BoardText` case that taught it). What was
missing was a single reachable implementation: `absolutePosition` sat unexported in the store
while `map/canvas/index.tsx` kept a local copy and `focusNode` used neither. It is exported now.

Deliberately *not* `flow.getInternalNode(...).internals.positionAbsolute`, which the drill-down
uses: that needs the node mounted and measured and returns nothing when it is not, which would
trade a wrong jump for no jump at all. The store's answer is derived from data already held and
is always available.

One honest limit: the corrected target was verified by probe — `focusNode` computes `(0, 1900)`
for the worst case, which is right — but the pan itself was never *watched* landing, because
`setCenter` animates on `requestAnimationFrame` and that is suspended while the headless browser
pane is hidden. The arithmetic is confirmed; the motion is not.

## A test that cannot fail is worse than no test

`scripts/concurrency.mjs` was written to prove the locking model holds, reported 28/28, and a
review found that several of its checks could not have failed:

- **The section that claimed to test `withLock` did not.** Eight concurrent whole-graph PUTs, each
  carrying all eight nodes with one moved, produce the same file with the lock deleted — the
  outcome is decided by the payloads, not by serialization. It now races a *graph* write against a
  *body* write, which is the 1000 ms/800 ms interleave `core/locks.ts` was actually written for,
  and requires both effects to survive.
- **Transport failures counted as passes.** `isError` was read off `result.isError`, which is
  absent on a 401, 404, 429 or 500 — so assertions about tool calls went green for requests the
  server had refused outright.
- **`[].every(…)` is `true`.** Two checks reported green on empty arrays. The refusal check now
  says out loud when the property was not exercised instead of claiming a pass.
- **It leaked a live write-scoped token on every run.** `POST /tokens` returns `{token, secret}`;
  the id was read as `token.id`, so cleanup issued `DELETE /tokens/undefined`. `scripts/smoke.mjs`
  had this right, which is what made the divergence invisible.
- **Two calls hit routes that do not exist** — `POST /folders/file` and
  `DELETE /boards/:id/shares/:userId` (the real one takes `?userId=`). One-sixth of the "mixed
  load" was a 404 nobody measured.

The general rule, now in CONVENTIONS: a concurrency assertion has to be one that *fails when the
lock is removed*. If you cannot say which line's deletion would turn it red, it is measuring the
payloads rather than the system.

## The canvas is told what changed, and refused when it argues

Two mechanisms, doing different jobs, because neither is sufficient alone.

**Push** (`GET /api/boards/:id/events`, Server-Sent Events) keeps an open board current. SSE
rather than a websocket: strictly one-way, rides the session cookie the rest of `/api` uses,
`EventSource` reconnects by itself, no dependency. It is emitted from `writeBoardFile`, the one
function that stamps `updatedAt` — so "the board changed" and "its timestamp moved" are the same
moment and no ordinary write can forget to announce itself. The payload is only *which* board;
the client refetches, so the files remain the single description of a board.

**The guard** (`GraphPayload.baseUpdatedAt`) catches what push misses — a slept tab, a dropped
stream, an nginx that buffers SSE. The canvas sends the `updatedAt` it built its copy from and
the server refuses a mismatch inside the board lock. Optional by design: only the canvas holds a
whole graph and only the canvas can clobber, so an agent adding one node sends no base and is
unaffected.

**On conflict, nothing is automatic.** The board stops saving, a banner says so, and the person
is told to note what is unsaved and reload. Refetching for them would discard the very edits the
guard just protected, and merging two whole graphs is not something this codebase can do
correctly — so the choice is handed to the only party who knows which half matters. For the same
reason `refreshBoard` stands down while a save is pending *and* while a conflict is open: a live
refresh is only safe when there is nothing local to lose.

The banner is not dismissible and takes no `Reload` button. Not dismissible because waving it
away and continuing to edit builds more work into a copy that can never be written; no button
because reloading is what discards the unsaved half, and that should cost a deliberate reach for
the browser's own control rather than sit under a stray return key. It is `pointer-events: none`
and pushes the chrome down by its measured height, so it can never come between the person and
the nodes they are trying to rescue.

## Three resting places, and one exception to "never delete"

A board goes live → `archive/boards/` → `deleted/boards/`, one step at a time. The Archive tab is
the owner's own undo; `deleted/` is out of their world entirely, and nothing in their API surface
reads it.

**"Delete" in the Archive tab moves rather than removes, and the copy does not say so.** The
confirmation reads as permanent — *"and everything in it will be deleted. This cannot be
undone."* — and from that account it is true: nothing in the owner's API surface reads `deleted/`,
so there is no route by which they could bring it back.

The gap between the copy and the mechanism is the point. Retention is a safety net for whoever
runs the instance — the deletion someone makes while tidying is the one most often regretted, and
an admin has to be able to answer "where did that board go" months later. Telling the person
"an administrator might still have it" would turn that net into a feature, and invite them to
treat delete as reversible and go asking. It is a soft delete presented as a delete, which is
ordinary, and the honest place for the detail is the operator documentation rather than a dialog
aimed at someone who has already decided.

One thing this constrains: `boardSlugTaken` checks only `boards/`, so a deleted board never
blocks its own name from being used again. That is what stops the retention leaking — a board you
"deleted" whose name is mysteriously still taken would give the whole thing away.

**A Super Admin can then remove it for good, and that is the only code in the system that
destroys anything.** Invariant 6 said "archive, never delete" without qualification, which was
true and is no longer — so the invariant now names this as its single exception rather than being
quietly contradicted. It exists because "we never delete anything" is not a promise one person
can keep on another's behalf: a board deleted by mistake has to be recoverable, and a board
deleted on purpose has to actually go. It is admin-only, audited as `board.purge`, and confirmed
with a dialog that is honest that snapshots go too.

**On the Archive tab "newest" means most recently archived**, not most recently edited — a board
untouched for a year but archived this morning belongs at the top, and the row says the word
*archived* because a bare timestamp beside a node count reads as "last edited" by convention. The
admin's deleted list uses the same field to answer its own question, "when did they delete it".

`shelvedAt` is stamped onto `board.json` as the board moves, through `writeJson` rather than
`writeBoardFile` — that helper stamps `updatedAt` and announces a change, and archiving is neither
an edit nor something a live board can be told about.

For boards shelved before the stamp existed it falls back to the directory's **ctime**. Not mtime:
a rename does not touch mtime, so an archived board's mtime is still the moment its last node file
was written — measured on the real volume, mtime and `updatedAt` were identical to the second,
which is exactly the value we are trying not to sort by. ctime *is* updated by a rename, and on
the live volume it reads as the real archive moment (one board showed a four-minute gap from its
last edit). It is only a fallback, and a fragile one: no copy preserves ctime — `cp -Rp` included,
because userspace cannot set it — so a restored backup flattens every old entry to the restore
time. Anything shelved from now on carries its own stamp and does not care.

Two details that fall out of the model rather than being chosen:

- **Restore mints a fresh slug when the old one is taken.** Coming back as `signup-flow-2` beats
  not coming back, and slugs are reusable, so the name may well have gone to a board made since.
- **A restored board comes back at the top level**, its `parentBoard` dropped. A parent that no
  longer exists — or that never took the board back into its `childBoards` — would leave it nested
  under something that does not list it, which is a board you cannot reach.

## Folders follow a rename; `core/boardEvents` is the seam that makes it possible

Assignments and favourites key on the board id, and a board id is a slug that renaming re-slugs.
`folders` never subscribed to `core/boardEvents`, so renaming a filed board left its assignment
stranded on the old slug: the board came back unfiled, and its star went with it. Reproduced
before the fix — `rename-probe` filed and starred, renamed to `rename-probe-renamed`, and
`folders.json` still said `rename-probe`.

`shares` has followed identity since v1.6 for exactly this reason. The hub exists so a module can
be told an id moved without anyone importing anyone — which matters here more than it did for
shares, because `folders` **must not** import `boards` and so has no other way to hear about it.

**Archive is not a rename, and the asymmetry is the point.** `newId === null` means the board went
to `archive/`, and the entry deliberately stays where it is so a restore lands it back where it
lived (see *Folders are metadata*). A listener that simply deleted the old key would break that promise, which is why this
is a repoint rather than a cleanup.

The same bug had a second head: **restore mints a fresh slug when the old one has been taken**,
and it announced nothing — so a board restored as `signup-flow-2` came back unfiled, breaking the
very promise the dormant assignment exists to keep. It now emits an identity change when, and only
when, the id actually moved.

## The Folders tab opens on the shelf, not inside something

Arriving on Folders used to drop you straight into the Unfiled tray with its card ringed as
though you had chosen it. That was not a decision — `openId: string | null` used `null` for *both*
"nothing is open" and "the Unfiled tray", and `null` is the initial state, so the tab could not
express the state it should start in.

Unfiled is now `UNFILED`, the same sentinel the drop targets already used, and `null` means
nothing is open. The shelf is what you came to look at; contents belong to a folder you picked.
Unfiled gets a breadcrumb of its own too, so there is a way back from the tray and not only from
a real folder.

Search still narrows to folder *cards* rather than reaching inside them, which is the same rule
seen from the other end: a board that matches shows you the folder holding it, and you open that
folder to see it.

## The deployment image carries tools, and root

Three choices worth stating, because each looks like sloppiness and is not.

**`bash`, `jq`, `sqlite3`, `less` and `curl` ship in the runtime image.** A few MB against an
architecture where the answer to most live questions is to go and read a file — `jq` a board.json,
`sqlite3` the accounts, `less` a node.md. Their absence turns a five-second look into copying data
off the host. `scripts/` ships for the same reason: a forgotten password should not need a rebuild.

**`better-sqlite3` compiles in its own stage.** It is native and has no musl prebuild, so Alpine
always builds it from source — which needs python3 and a C++ toolchain in *both* the build and
deps stages, and in neither case does the compiler reach the shipped image. Installing it in the
runtime stage instead is what left this Dockerfile unbuildable on Alpine until it was tried.

**The container runs as root.** A non-root user needs the named volume chowned on first boot,
which is an entrypoint that can fail closed in a way that is hard to read. On a single-tenant box
behind a proxy the trade is worth it; it is the first thing to revisit if this ever hosts anyone
untrusted.

## The welcome boards are a copy, not a script

There were already seed scripts that build example boards through the API, and the starter
workspace deliberately does not use them. A script is a *second description* of the boards: edit
the real ones and the script still makes the old ones, silently, until somebody notices. The
template is a capture of the actual boards on disk (`scripts/make-template.mjs`), so what a new
person opens is what you would have shown them.

This only works because files are the database. A board is a directory; copying it into a fresh
workspace is the whole operation, and the ids, `parentBoard` links and `childBoards` inside stay
self-consistent because slugs are per-workspace and a new account has nothing to collide with.

Two guards that matter more than they look:

- **It declines on a workspace that already has boards.** The bootstrap path runs on every boot,
  not only the first, and an existing volume must come back untouched.
- **It is best-effort.** A damaged or missing template must not stop an account being created —
  somebody who cannot sign in is worse off than somebody whose first screen is empty, and the
  second failure explains itself while the first looks like the app is broken.

Only the roots are filed. Sub-boards come along because a board is useless without the boards its
cards drill into, but filing them separately would list them twice on the Folders tab.

## The back button needs the view to have an address

The dashboard's tab and open folder were React state, so the URL was `/` whichever of them you
were looking at. Leaving for a board and pressing back therefore returned you to Recent with
nothing open — the default, not where you were. The browser can only take you back somewhere that
had a name.

They are now `/all`, `/folders`, `/folders/:id`, `/archive`, with `/` still meaning Recent. That is
the whole fix: the router already used `pushState` and listened for `popstate`, and board-to-board
navigation had always worked. What was missing was that half the app's states were unaddressable.

`/folders/unfiled` names the tray, using the same sentinel the drop targets already had — which is
also what made "nothing is open" expressible in the first place.

## Export is a permission, not a consequence of reading

A share used to carry a download with it: anyone who could open a board could take every node
away as markdown files. That is a different act from reading one on screen — it leaves the
workspace, it keeps working after the share is revoked, and the owner was never asked. It is the
duplicate flag's sibling, so it is modelled the same way, on the same row, checked in one place.

`can_export` defaults to **0**, unlike `include_children`, which defaults to 1. The difference is
deliberate in both directions. Sub-boards came with a board before the flag existed, so an
omitted value has to keep that behaviour or an old client silently narrows a share. Export was
also open before the flag existed — and there the old behaviour is the bug, so every existing row
loses it on upgrade rather than keeping a permission nobody granted.

The clipboard is *not* on this flag. Pasting a selection into a board of your own is a copy, and
copies answer to "may duplicate" — the small version of the whole-board copy, read off the same
row. Export means the node files leaving as markdown. Two different acts, two flags, and neither
stands in for the other.

Admin View is untouched. A Super Admin already reads every word of every node in the workspace;
letting an owner "withhold" an export from them would be theatre, not a control.

## Layouts are named, not computed by the caller

`arrange_nodes` takes a shape — `flow`, `grid`, `row`, `column`, `circle`, `align`, `distribute` —
and works out the coordinates itself. `move_nodes` still exists for the case where a caller really
does know where something goes, but naming a shape is the one an agent should reach for.

The reason is cost, not taste. An agent laying out fifteen nodes with `move_nodes` computes thirty
numbers token by token, which is slow and is where the mistakes come from: two cards in the same
place, a column that drifts, a gap that closes. Naming a layout moves that arithmetic to where it
is exact and free.

**`flow` is also most of the fix for edges crossing cards.** It layers the selection by following
its edges, so every connection runs between adjacent layers with a clear lane. On a fifteen-node
process graph that took edge-over-card crossings from five to zero.

It is not all of the fix, and the limit is worth naming: an edge that spans many layers — an
exception path from step two to step fifteen — still cuts straight across everything between. No
arrangement of the nodes helps, because the edge is a straight line between two of them. That
needs waypoints, which is edge routing, a different feature. Measured: the same graph with one
such edge went from seven crossings to eight.

## What is not built

**MCP access to shared boards.** The MCP server is own-workspace-only on purpose, and that still
stands. A token resolves to a user and every call goes down the same `(userId, boardId)` path a
browser session does, so widening it is a visibility question, not a plumbing one.

**Destructive tools over MCP.** No archive, delete, rename-board, share or admin. Agents create
and refine; people destroy and share. The intended shape, if they ever come, is a separate
confirm scope on the token rather than more ordinary write tools.

**MCP resources and prompts.** Only tools are exposed. `export_board` is the obvious first
resource once real usage says it is wanted.

**Deleting a folder over MCP.** The other folder tools shipped — see *"Agents may organise, but
may not un-organise"* above. Deletion did not, and that is the whole of what is still withheld:
nothing is archived and nothing is recoverable, because the folder *is* the arrangement.

**Nested folders, folder sharing, and foldering a board shared with you.** All left out on
purpose when folders shipped in v1.8. (Archived boards do have a UI now — the Archive tab, with
restore and delete; see *Three resting places*.)

**Edit-sharing and public links.** A share is read-only and names a person. A shared board on
screen does update live — the canvas opens the same per-board event stream through
`/api/u/:ownerId`, so a write by the owner or their agent reaches a recipient's open view — but
the dashboard's *Shared with me* list does not: it is read when the dashboard loads and again by
the Refresh button on a shared board.

**Any test suite.** `npm run smoke` is 145 end-to-end checks through the API and the MCP mount,
and is the closest thing; `scripts/concurrency.mjs` adds 34 overlap checks, and
`scripts/routes.mjs` exercises the connector router as a pure function with no server. None of
them is a test framework, and there is no lint config.
