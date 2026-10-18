# Configuration

Cartographer has two places to configure: **environment variables**, which decide how the
server runs, and an optional **`config.json`** in the data volume, which decides the vocabulary
boards use (statuses, shapes and colours). Neither needs a rebuild.

## Environment variables

Put them in `.env` at the repository root; start from [`.env.example`](../.env.example). Both
`docker compose` and `npm run dev` read that file, and a variable set in the real environment
always wins over it. `.env` is git-ignored, so passwords never end up in a tracked file.

### First boot

| Variable | Default | What it does |
|---|---|---|
| `ADMIN_PASSWORD` | *(required)* | Password for the first admin account. |
| `ADMIN_USERNAME` | `admin` in Docker; required in dev | Username for that account. |
| `ADMIN_DISPLAY_NAME` | the username | The name shown in the app. |

These are read **only while the database has no accounts**. The account is created with *must
change password* set, so the password works once: sign in, choose a new one, and from then on
the new password lives in `app.db` and editing `.env` changes nothing. If nobody can sign in,
see *Recovery* in [OPERATIONS.md](OPERATIONS.md). With no accounts and no `ADMIN_PASSWORD`, the
server refuses to start rather than run with no way in.

### Deployment

| Variable | Default | What it does |
|---|---|---|
| `COOKIE_SECURE` | `false` | Marks the session cookie `Secure`. Set `true` once you sign in over https. Turning it on earlier locks everyone out, because browsers drop a secure cookie sent over plain http, and nothing reports an error. |
| `TRUST_PROXY` | `true` in Docker, `false` in dev | Trusts `X-Forwarded-For` for the client's address. Set it to match what is really in front: on behind a reverse proxy, otherwise the per-IP login limit counts everyone as the proxy and ten sign-ins a minute are shared by all users; off with nothing in front, otherwise a client can fake its address to dodge that limit. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` (logs every request), `trace`, or `silent`. |
| `TZ` | `UTC` in Docker | Time zone for log timestamps. Stored data is always UTC. |

### Where things are

Docker sets all of these itself; you only need them to run the server directly.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` (Docker: `56321`) | Port the server listens on. |
| `HOST` | `0.0.0.0` | Interface to bind. The default is every interface, which exposes the sign-in page to your whole network; use `127.0.0.1` when you only reach it locally or through a proxy on the same machine. |
| `DATA_DIR` | `./data` (Docker: `/data`) | Where boards, node files, snapshots and `app.db` live. |
| `CLIENT_DIR` | `client/dist` (Docker: `/app/client/dist`) | The built web app the server hands out. |
| `API_URL` | `http://localhost:` + `PORT` | Development only: where the client's dev server proxies `/api` and `/mcp`. It follows `PORT` from `.env`, so set it only when the API runs somewhere else entirely. |
| `TEMPLATE_DIR` | `templates/starter` (Docker: `/app/templates/starter`) | The starter boards every new account is given. Point it at an empty folder to start new accounts with nothing. |

### Docker-only choices

These live in [`docker-compose.yml`](../docker-compose.yml) itself:

- **Published port.** `127.0.0.1:56321:56321` keeps the container reachable only from the host,
  which is where a reverse proxy connects. To use a different host port, change the first
  number only, e.g. `127.0.0.1:8080:56321`.
- **The volume.** `cartographer-data` is a named volume holding everything. It survives
  `docker compose down`; `docker compose down -v` deletes it. Backups are in
  [OPERATIONS.md](OPERATIONS.md#backups).
- **Log rotation.** Docker's log is capped at five 10 MB files.

### Behind a reverse proxy

Any proxy works: Caddy, nginx, Traefik or a tunnel. Point it at `127.0.0.1:56321`, terminate
TLS there, then set `COOKIE_SECURE=true` and keep `TRUST_PROXY=true`. The proxy must also:

- pass `X-Forwarded-For`;
- **not buffer** `text/event-stream` responses on `/api/…/events`, which is how an open board
  updates live (for nginx, `proxy_buffering off` on those locations);
- forward `/mcp` like any other path, if you use agents.

## `config.json`

Drop a `config.json` into the root of the data volume (next to `app.db`) to change the
vocabulary. In dev that is `data/config.json`; with Docker, copy it in:

```bash
docker compose cp config.json cartographer:/data/config.json
```
 It is read on every request, so changes apply on the next page load, with no
restart. Leave out any key to keep its default; a key that is empty or has the wrong type also
falls back to the default. A file that is not valid JSON at all is different: the API answers 500
until it is fixed, so check it with `jq . config.json` before copying it in.

```json
{
  "statuses": [
    { "id": "sketched", "label": "Idea", "colorToken": "--status-sketched" },
    { "id": "in-progress", "label": "In progress", "colorToken": "--status-documented" },
    { "id": "done", "label": "Done", "colorToken": "--status-built" }
  ],
  "shapes": ["rect", "rounded", "pill"],
  "colors": [
    { "id": "paper", "label": "White", "token": "--node-paper" },
    { "id": "sky", "label": "Blue", "token": "--node-sky" },
    { "id": "sand", "label": "Sand", "token": "--node-sand" }
  ]
}
```

| Key | Default | What you can set |
|---|---|---|
| `statuses` | `sketched`, `documented`, `built` | Any number of statuses, in the order the app cycles through them. `id` is what is stored in each `node.md` and what agents send; `label` is what people see. **Keep one with the id `sketched`**: new nodes always start with that status, so relabel it rather than removing it. `colorToken` must be one of `--status-sketched`, `--status-documented` or `--status-built`; statuses may share a colour. |
| `shapes` | all five | Any subset of `rect`, `rounded`, `ellipse`, `diamond` and `pill`, in the order the picker shows them. |
| `colors` | `clear`, `paper`, `slate`, `sky`, `aqua`, `mint`, `lemon`, `peach`, `blush`, `lilac` | The node colour palette, in order. `id` is the name agents use, `label` is shown in the app, and `token` must be one of the node colours in [`tokens.css`](../client/src/styles/tokens.css): those ten plus `--node-sand`. |

Changing the vocabulary never rewrites existing nodes. A node whose status was removed keeps it
and still reads fine, but new writes must use a status, shape or colour this file defines, and
both the API and the MCP tools refuse anything else with a message listing what is allowed.

New colours need a new token in `client/src/styles/tokens.css` and a rebuild, because every
colour in the app is a design token rather than a raw value.

There is also a `theme` key, but only `light` exists today, so it has no effect.
