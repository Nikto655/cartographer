# Operations

## Running

```bash
npm run dev          # builds shared, then API :3000 and client :5173 together
npm run dev:server   # API only
npm run dev:client   # client only (proxies /api and /mcp to the API)
```

Open http://localhost:5173 and sign in. Both halves read the repo-root `.env` themselves, so
nothing needs exporting. To move the API off :3000, set `PORT` there: the client's proxy follows
it. Stop it with Ctrl-C.

`npm run build` then `npm start` for a production build.

## Deploying to a VPS

```bash
cp .env.example .env      # set ADMIN_PASSWORD
docker compose up -d --build
```

Settings come from `.env`, which is git-ignored, so no password ends up in a tracked file;
compose refuses to start without `ADMIN_PASSWORD`. Every option is in
[CONFIGURATION.md](CONFIGURATION.md).

The container listens on **56321** and is published to `127.0.0.1:56321` only, because it speaks
plain http — put a reverse proxy in front and terminate TLS there.

**The first thing to do on a new deployment is sign in and change that password.** The bootstrap
account is created *must change password*, so until you do, it can sign in and nothing else —
every other request, reads included, answers 403 `password_change_required`. That is the intended shape of a one-time key, not a fault.

Two settings depend on what is in front of the container: `COOKIE_SECURE` (turn it on once https
works, never before) and `TRUST_PROXY` (on behind a proxy, which is the compose default). See
[CONFIGURATION.md](CONFIGURATION.md#deployment) for why each matters.

**Data lives in a named volume, `cartographer-data`**, not a bind mount: it survives
`docker compose down`, it does not inherit a host directory's ownership, and `docker volume` can
inspect and back it up. Everything is in there — boards, node files, snapshots, `app.db`.

```bash
docker run --rm -v cartographer-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/cartographer-$(date +%F).tgz -C /data .
```

`docker compose down` keeps the volume. `docker compose down -v` **deletes it** — that is the one
command that loses everything, and nothing archives it first.

### Working inside a running container

The image carries `bash`, `jq`, `sqlite3`, `less` and `curl` on purpose. Files are the database
here, so most questions are answered by reading one:

```bash
docker compose exec cartographer bash
```

```bash
docker compose exec cartographer jq -r '.name, (.nodes | length)' /data/users/*/boards/<board-id>/board.json
```

```bash
docker compose exec cartographer sqlite3 /data/app.db 'select username, is_super_admin from users;'
```

`scripts/` ships too, so a forgotten password is recoverable without rebuilding the image — see
*Nobody can sign in* below, run as `docker compose exec cartographer node scripts/set-password.mjs …`.

The container runs as root. On a single-tenant box behind a proxy that is a deliberate simplicity
trade — a non-root user needs the named volume chowned on first boot, which is a moving part that
fails closed and confusingly. Worth revisiting if this ever hosts anyone untrusted.

### Agents

The mount answers a tool call with **JSON**, not an SSE stream. The transport supports both and
streaming is its default, but a tool call is a question and an answer with nothing to stream in
between, and a one-frame event stream is the shape most likely to be held up in transit —
proxies and CDNs buffer, coalesce and time out `text/event-stream` in ways they never do an
`application/json` body of the same size. The `GET /mcp` stream is still SSE; that one genuinely
streams, and the SDK keeps it alive with comment frames every 15s.

`GET /mcp` answers **405**. The spec makes the standalone server-to-client stream optional, and
nothing here ever pushes to a client — every reply is the answer to a request, returned on that
request's POST. Answering the GET anyway meant a bridge held an SSE connection open across a CDN
for hours carrying only keep-alives, and when it eventually dropped, `mcp-remote` retried twice
and then stopped for good. A client that reads the 405 never opens one. Measured: a real
`mcp-remote` probes three times at startup, is told no, and goes quiet.

MCP sessions are not kept: every request carries its token and stands alone.

`/mcp` is served by the same process on the same port, so an agent connects to your own base URL
plus `/mcp` — `https://your-domain/mcp`. **API & Agents** in the profile menu shows exactly that,
read from the address the browser is on, so it is right behind whatever proxy and hostname you
put in front without anything to configure.

The healthcheck hits `/`, not `/api/config`, because the API is behind auth.

### Environment

Every variable, its default in Docker and in development, and the `config.json` options are in
[CONFIGURATION.md](CONFIGURATION.md). Two things worth knowing here:

- `ADMIN_PASSWORD` only does anything on a database with no accounts. After first boot the
  password lives in `app.db`, and editing `.env` changes nothing.
- Outside Docker the server binds `0.0.0.0`, which puts the sign-in page on your whole network.
  Set `HOST=127.0.0.1` if you only reach it locally or through a proxy on the same machine.

## Signing in from scripts and the shell

Everything under `/api` except `POST /api/auth/login` needs a session cookie.

```bash
curl -sc /tmp/cg.jar -X POST localhost:3000/api/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"…"}'
```

A new account, the bootstrap admin included, has to change its password before anything else
answers:

```bash
curl -sb /tmp/cg.jar -X POST localhost:3000/api/auth/change-password -H 'content-type: application/json' -d '{"currentPassword":"…","newPassword":"…"}'
```

```bash
curl -sb /tmp/cg.jar localhost:3000/api/boards
```

Sessions are 30-day sliding, so a jar keeps working. In Node, use `scripts/lib/client.mjs`,
which signs in and replays the cookie:

```js
import { call, signIn } from './lib/client.mjs';
await signIn();
const board = await call('POST', '/boards', { name: 'Example' });
```

**A token is not a session.** The personal access tokens added in v1.7 are for `/mcp` only —
no `/api` route reads an `Authorization` header, so a script still signs in and keeps the jar.
Mint one from the profile menu under **API & Agents**: the secret is `cart_` plus 32 random
bytes, `app.db` keeps only its SHA-256, and it is shown once — a lost token is revoked and
replaced, never recovered. Twenty-five active tokens per account, revocation takes effect on
the next request, and disabling the account cuts off its tokens with it.

## Agents (MCP)

`/mcp` is a Streamable HTTP MCP server on the same port, container and volume as the app, so
whatever proxy already fronts Cartographer fronts it too — there is no second thing to deploy or
expose. The endpoint is the app's own origin plus `/mcp`; **API & Agents** in the profile menu
shows it, generates tokens, and carries the connector configuration to paste:

```json
{
  "mcpServers": {
    "cartograph": {
      "type": "http",
      "url": "https://your-domain/mcp",
      "headers": { "Authorization": "Bearer cart_…" }
    }
  }
}
```

The dialog fills the url in from the address the browser is on, so it is already right behind
whatever proxy and hostname front the container — deployed it reads `https://your-domain/mcp`,
and on a dev machine `http://localhost:5173/mcp`. The key `"cartograph"` is the connector's local
name and is yours to choose.

"The app's own origin plus `/mcp`" is exactly true in production, where one server hands out the
client bundle and answers the agent. In dev the two halves sit on different ports, so the dialog
opened at `:5173` would state an address that 404s — to somebody about to paste it into a
connector. `client/vite.config.ts` therefore proxies `/mcp` as well as `/api`, and in dev both
`http://localhost:5173/mcp` and `http://localhost:3000/mcp` reach the same server. In production
there is one port — 56321 inside the container — and one origin, whatever the proxy serves.

Scope is fixed when the token is minted: **Read-only** lists, reads, exports, searches and asks
what this deployment defines; **Read & write** also creates boards, nodes, edges, frames, notes
and text annotations. A write tool called with a read-only token comes back as a tool error
saying so, not a broken connection, so the agent can explain itself rather than hang.

There are twenty-six tools, seven read and nineteen write, and the
absences are the design: nothing archives, deletes a node or a board, deletes a folder, renames a
board, shares or administers, and v1 reaches only the token owner's own workspace — never a board shared with
them, never anyone else's. An agent *can* correct its own lines — `unlink_nodes` and
`update_edge` arrived after the first cut — which is not a crack in "archive, never delete": an
edge has no file behind it, it lives only in `board.json`, and the canvas's own save has always
dropped edges by omission. Ceilings a looping agent will meet first: 120 requests a minute per
token, 50 nodes per `create_nodes`, 200 edges per `link_nodes`, 100 000 characters of note body.

Layout is writable, not just readable. `style_nodes` carries a card's size beside its colour and
shape — 184×76 by default, never below the shared `MIN_NODE_SIZE` of 120×56 and never above
2000×2000, the upper bound being there so a caller that meant 240 and sent 240000 gets a
sentence back rather than a board with one card the size of a district. A frame holding a
resized node refits around it, as it does after `move_nodes`. Frames themselves take no size:
`update_frame` sets title, colour and collapsed state and nothing more, because a frame's box
follows its members.

Folders are the agent's too — `list_folders`, `create_folder`, `update_folder`,
`file_boards`. Organising was a person's job while the only thing an agent could do was add to a
shelf it could not see; that stopped holding once a run could leave ten new boards loose. The
line moved rather than went: **no tool deletes a folder**, because deleting one silently unfiles
everything in it. Folders are addressed by *name* — `list_boards` reports the name, and
`file_boards` takes it — so an agent never has to carry an id. Filing moves nothing on disk and
hides nothing; a filed board is still in Recent and All. 100 boards per `file_boards` call.

Text annotations are reachable too — `create_texts`, `update_text`, `remove_texts` — so the
words that describe a map rather than the things on it are the agent's to write. They carry no
file, so removing one is a `board.json` edit rather than an archive: up to 50 per call, 2 000
characters each.

Statuses, shapes and colours are per-deployment (`data/config.json`), so an agent is told to call
`get_config` and use the ids it hands back rather than the defaults. A status this deployment
does not define is now refused outright, over MCP and over `/api` alike; it used to go straight
into the frontmatter, where the card rendered as *sketched* and the node was left out of the
status strips on frames, dashboard cards and sub-map lists. Tags are writable too — 20 per node,
40 characters each — and are what the graph world colours dots by.

Nodes an agent created carry `createdVia: 'mcp'` and the token name in `board.json`, which is
what draws the small bot glyph on the card and on the graph dot — hover it for the token and
the date. Every MCP write also lands in the audit log with `via = 'mcp'` and the token's name.

Offboarding someone stops their agents at the same moment it stops them: `resolveToken` joins
`users` and re-resolves on every request, so disabling the account 401s the next call from every
token it owns — including an agent in the middle of a run, whose next call fails rather than
finishing on a stale identity. But disabling **suspends**; it does not revoke. `revoked_at` stays
null, and re-enabling the account makes the same secrets work again — so if someone is gone for
good, revoke their tokens as well. Cookie sessions differ: those are deleted outright on disable,
and re-enabling means signing in again.

To undo an agent run, restore the snapshot it took: a token's first write to a board snapshots that
board before touching it (once per token and board in any thirty minutes), so the board menu's Snapshots list already
holds the state the run started from. One restore, and the run never happened.

That snapshot is **best-effort, not a guarantee**. If taking it fails the write proceeds anyway,
on the grounds that refusing to work because the safety net could not be hung is the worse
failure — so check the Snapshots list before turning an agent loose on something you care
about, and take one by hand if it is empty. Restoring is itself undoable: it snapshots the
current state first.

## The starter boards

Every new account opens on the same boards — the docs, as boards, in a **Cartographer Docs**
folder. They are both the explanation of the app and a demonstration of it, which is the point: an
empty canvas explains nothing, and prose about a visual tool is the wrong medium for its subject.

They are a **copy of real boards**, not something a seed script rebuilds from code:

```bash
node scripts/make-template.mjs        # ./data → templates/starter, folder "Cartographer Docs"
```

Run that whenever the docs boards change and commit the result. A reconstruction drifts from the
boards it describes every time either side is edited; a copy cannot.

Planting happens on the first boot for the bootstrap admin, and on every `POST /admin/users`
afterwards. It is best-effort — a missing template must never stop an account being created — and
it **declines on any workspace that already has boards**, so it can never write over someone's
work. `TEMPLATE_DIR` overrides the location; the image sets it to `/app/templates/starter`.

## Seeding

Seeds write through the API, so they need credentials:

```bash
export SEED_PASS='your-password'
node scripts/seed-example.mjs        # product flow: frames, chips, shapes, data, sub-board
node scripts/seed-endtoend.mjs       # frontend → middleware → backend → files
node scripts/seed-guide.mjs          # what everything on the canvas is and does
node scripts/seed-architecture.mjs   # the plumbing: files, modules, routes
node scripts/seed-graph-example.mjs  # graph world: entities, derived links, ghosts
```

`SEED_USER` defaults to `admin`. `API` defaults to `http://localhost:3000/api`.

## Smoke test

145 end-to-end checks: auth, boards, nodes, links, snapshots, export, clipboard, sharing, tokens,
MCP, folders and the archive/delete/purge lifecycle. It asserts the tool *list* is 26 and
exercises 19 of them end to end — the absences are the ones the concurrency harness covers
(`create_folder`, `file_boards`, `list_folders`) plus `create_board`, `export_board`,
`set_node_data` and `move_to_frame`. Also agent attribution, tags, the unknown-status refusal,
edge correction, a read-only token refused a write, disabling an account cutting off its tokens,
and `folders.json` round-tripping with a minted id, a colour id resolved to its stored token,
renumbered order, an assignment to a missing folder pruned while one to an absent board is kept
— plus the access rules refusing what they should.

**It writes**, so run it against a throwaway instance. `scripts/throwaway.mjs` starts one on a
fresh temp directory, bound to `127.0.0.1`, with an `admin` and a `reviewer` account whose
passwords are already changed, and prints the variables the suites read:

```bash
npm run build
node scripts/throwaway.mjs          # port 3100; pass another as the argument
```

```bash
export API=… DATA_DIR=… SMOKE_PASS=… SMOKE_OTHER_PASS=…   # as printed
npm run smoke
```

Stop it with the `kill <pid>` it prints. Against an instance of your own instead, set
`SMOKE_USER`/`SMOKE_PASS` for an account that has changed its password, and
`SMOKE_OTHER_USER` (default `reviewer`) and `SMOKE_OTHER_PASS` for a second one; without the
second account the sharing checks are skipped and far fewer run.

The MCP section needs no setup of its own: it mints its own tokens through the API, speaks the
wire protocol with plain `fetch` — no SDK, no connector to configure — and revokes what it
made on the way out.

## Concurrency

```bash
node scripts/concurrency.mjs        # with the variables scripts/throwaway.mjs printed
```

33–34 checks, and it writes — same throwaway instance as the smoke test. It also reads files on
disk, so it needs `DATA_DIR` pointed at that instance's data, which the printed variables do. (The odd one out only
asserts when the per-IP login allowance is actually reached; it says so rather than claiming a
pass it never observed.) It is not a load test: it races the specific places where "files are the
database" has to supply what a database would give for free, and asserts the *outcome*.

It also covers the stale-write guard: a save built on the current board is accepted, the same
payload sent again is refused with 409, the refusal costs the board nothing, and a caller that
sends no base at all — every agent — is unaffected.

What it races: a **graph write against a body write** on one board — the 1000 ms/800 ms autosave
interleave `core/locks.ts` exists for, where both effects must survive; an agent over MCP against
a browser on one `folders.json`, made to genuinely disagree so a lost write would show; six
same-named boards created at once; two users overlapping; a sharee reading a board while its owner
writes it, with the owner's `board.json` compared byte-for-byte; concurrent sign-ins; and a
sustained mixed round to catch queue build-up.

`DATA_DIR=…` is optional and enables the byte-comparison check. The script spends part of the
per-IP login allowance itself, so it retries its own sign-in once — it can be run back-to-back.

Two things it established that are worth knowing before putting people on one instance:

**Board creation is serialized per workspace.** `uniqueSlug` is check-then-act, so six concurrent
creates of one name used to settle on three slugs and write three boards over each other — the
shelf came back short and nothing said so. `withBoardRegistry` now holds the mint and the
directory claim together, keyed on the workspace's `boards/` directory, so two *people* never
wait on each other. Duplicating, renaming and copying a shared tree take the same lock.

**Sign-ins are capped at ten a minute per IP**, and that bucket counts successes, not just
failures — `clearLoginRate` clears only the username bucket. From one address that is the
throttle working. **Behind a reverse proxy with `TRUST_PROXY` unset, every user shares one
bucket**, so the eleventh person to sign in within a minute is refused. Set `TRUST_PROXY=true`
when there is a proxy in front; the variable is in the table above and this is what it is for.

Everything else held: node moves, folder writes and board reads all survive overlapping writers,
one workspace never leaks into another under load, and six rounds of mixed traffic ran flat
(10–11 ms) with no latency climb.

## Folders

`data/users/<id>/folders.json` is one person's arrangement — the folders they made, which board
sits in which, which boards are starred. A file rather than a table because it is content
organisation: a copy of `data/` carries it, and `app.db` goes on holding only facts about the
system. It does not exist until somebody makes a folder, and an absent file reads as an empty
structure rather than an error.

Hand-editing is safe and needs no restart — the server reads the file per request and writes it
whole, atomically. Entries it cannot use are dropped rather than refused over the API: a folder
with no name or a repeated id disappears, and `order` is renumbered `0..n-1` on both read and
write, so gaps, ties and negatives in a hand-edited file are harmless. Colours must be palette
tokens this deployment defines (`--node-sky`; the API also accepts the bare id `sky`), at most
50 folders, names at most 60 characters.

**Malformed JSON is the one thing it will not tidy.** `readJson` throws, and since `listBoards`
merges folder membership into every summary, `GET /api/boards` throws with it — the whole
dashboard 500s, not just the Folders tab. That is the intended failure: hydrating a corrupt file
to empty would silently discard somebody's entire arrangement, where a 500 and a
`Malformed JSON in …` line in the server log is something you can act on. Fix the file, restore
it from a backup, or `rm` it and start again with everything unfiled.

Nothing here moves anything. Filing a board does not move its directory, and deleting a folder
deletes no boards — its boards read as unfiled the moment the folder is gone. An assignment for
a board that is not on the shelf is deliberately *kept*, so archiving a board and restoring it
months later lands it back in the folder it lived in.

## Deleting for good

Three resting places, and a board only ever moves down one step:

```
boards/           live
archive/boards/   the owner's own undo — the Archive tab lists it, they can restore it
deleted/boards/   out of the owner's world; nothing in their API surface reads it
```

**"Delete" in the Archive tab does not delete.** It moves the board to `deleted/`, where the owner
can no longer see or reach it and an administrator still can. That is deliberate: the deletion a
person makes while tidying is the one they most often regret, and an admin has to be able to
answer "where did that board go" months later.

Only a Super Admin can go further. Admin View shows each person's deleted boards under their row,
and **Delete for good** removes the files — the board, its nodes, its snapshots. That is the one
operation in Cartographer that destroys rather than moves; it is audited as `board.purge`, and the
audit row is the only trace that will remain.

## Recovery

### Nobody can sign in

A password reset needs a Super Admin, so if the only Super Admin is locked out there is no way
back through the app. Stop the server and:

```bash
node scripts/set-password.mjs admin 'new-password'
```

It writes the hash with the server's own argon2 parameters, clears that user's sessions, and
clears any forced-change flag. `DATA_DIR=… ` if the volume is elsewhere.

### Something was archived

The owner can do this themselves now: the dashboard's **Archive** tab lists every archived board,
most recently archived first, and restores one with a click. "Archived" there is `shelvedAt` —
stamped on the move, falling back to the directory's ctime for anything archived before that
existed, which no copy preserves. It comes back under its own slug, or a suffixed one if the name has
been taken since, and it comes back as a top-level board — a parent that no longer lists it would
leave it nested under something invisible.

By hand, or for anything the tab does not cover: look under `data/users/<id>/archive/` — `boards/<id>--<timestamp>/`
for boards, `nodes/<board-id>/` for nodes — and `mv` it back. Archived boards take their
snapshots with them, under `archive/snapshots/<same-name>`.

### A board looks wrong

Snapshots are full directory copies under `data/users/<id>/snapshots/<board-id>/<ts>/`.
Restore from the board menu, or `mv` by hand. Restoring takes a backup snapshot first.

## Backups

The whole story is `data/`. Copy the directory. `app.db` is SQLite in WAL mode — copy
`app.db`, `app.db-wal` and `app.db-shm` together, or checkpoint first. **Never copy `app.db`
alone and discard the `-wal`**: it silently reverts to the last checkpoint.

## Boot order

Schema → bootstrap admin if `users` is empty → multi-tenancy migration → node-directory
migration → listen. Migrations are snapshot-gated, idempotent and roll back on failure; both
are no-ops on a current volume but still load-bearing for restoring old snapshots.
