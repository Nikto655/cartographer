# Contributing to Cartographer

Thanks for taking the time. Cartographer is a small, opinionated codebase, so a short
conversation first saves wasted work: for anything bigger than a bug fix, open an issue
describing the change before you write it.

## Setup

Node 22 or newer.

```bash
npm ci
cp .env.example .env   # set ADMIN_PASSWORD
npm run dev            # API on :3000, client on :5173
```

Port 3000 taken? Set `PORT` in `.env`; the client's proxy follows it. Stop `npm run dev` with
Ctrl-C in its terminal. In dev the server logs that it found no client bundle: that is expected,
because Vite serves the client. `npm ci` may also warn that install scripts were skipped for
`better-sqlite3` and `esbuild`; both ship prebuilt binaries, so nothing is missing.

Sign in at http://localhost:5173 with the admin account from `.env`. You will be asked to
change the password on first sign-in.

## Before you open a pull request

- Read [CLAUDE.md](CLAUDE.md) and [docs/CONVENTIONS.md](docs/CONVENTIONS.md). They are short,
  and they are the rules review holds a change to.
- Check [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) before reporting a bug; it may be known.
- `npm run typecheck` must pass.
- If you touched the server, run the smoke suite against a throwaway instance:
  `npm run smoke` (see [docs/OPERATIONS.md](docs/OPERATIONS.md)). Never point it at a data
  directory you care about.
- If you touched locking, ids or concurrent writes, also run `node scripts/concurrency.mjs`.
- Keep a pull request to one change, and say in its description how you verified it.

## Licensing of contributions

Cartographer is licensed under the [GNU Affero General Public License v3.0](LICENSE). By
submitting a contribution you agree that it is licensed under the same terms, and that you
have the right to submit it.
