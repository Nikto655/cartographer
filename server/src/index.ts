import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import { getConfig } from './core/config.js';
import { HttpError } from './core/errors.js';
import { DATA_DIR, exists, initDataDir, listWorkspaces, workspaceFor } from './core/storage.js';
import { initDb } from './core/db.js';
import { runNodeDirMigration, runTenancyMigration } from './core/migrations.js';
import {
  assertBoardVisible,
  authRoutes,
  bootstrapAdmin,
  bootstrapAdminId,
  denyMutations,
  installAuth,
  requireAuth,
  requireSuperAdmin,
} from './modules/auth/index.js';
import { adminRoutes, auditBoardOpen } from './modules/admin/index.js';
import {
  followBoardIdentity,
  recordShareAccess,
  sharesRoutes,
  workspaceAccess,
} from './modules/shares/index.js';
import { onBoardIdentityChange } from './core/boardEvents.js';
import { createSnapshot } from './modules/snapshots/index.js';
import { boardsRoutes, seedStarterWorkspace } from './modules/boards/index.js';
import { nodesRoutes } from './modules/nodes/index.js';
import { snapshotsRoutes } from './modules/snapshots/index.js';
import { exportRoutes } from './modules/export/index.js';
import { framesRoutes } from './modules/frames/index.js';
import { clipboardRoutes } from './modules/clipboard/index.js';
import { tokensRoutes } from './modules/tokens/index.js';
import { foldersRoutes, followBoardRename } from './modules/folders/index.js';
import { mcpRoutes } from './modules/mcp/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const CLIENT_DIR = process.env.CLIENT_DIR ?? path.resolve(__dirname, '../../client/dist');

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 8 * 1024 * 1024,
  /*
   * Off by default: `X-Forwarded-For` is a client-supplied header and only
   * means anything when a proxy we trust rewrites it. Turn it on behind the
   * reverse proxy, or the per-IP login throttle sees one address for everyone.
   */
  trustProxy: process.env.TRUST_PROXY === 'true',
});

app.setErrorHandler((error, _req, reply) => {
  const err = error as Error & { statusCode?: number };
  if (err instanceof HttpError) {
    reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err.statusCode === 400) {
    reply.code(400).send({ error: { code: 'bad_request', message: err.message } });
    return;
  }
  // The message can carry an absolute path and another tenant's user id — it
  // goes to the log, never to the caller.
  app.log.error(err);
  reply.code(500).send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
});

// Boot order per v1.6 §8: schema → bootstrap admin → volume migration → serve.
await initDataDir();
app.log.info(`Data directory: ${DATA_DIR}`);
initDb();
try {
  await bootstrapAdmin((message) => app.log.info(message));
/*
 * The first account on a fresh volume gets the same welcome boards every later
 * one does. Deliberately after the migrations above: on an *existing* volume
 * `bootstrapAdmin` creates nobody, the workspace already has boards, and
 * `seedStarterWorkspace` declines rather than writing over them.
 */
{
  const first = bootstrapAdminId();
  if (first) {
    const planted = await seedStarterWorkspace(workspaceFor(first));
    if (planted) app.log.info(`Starter boards: ${planted} copied into the new workspace`);
  }
}
} catch (err) {
  app.log.error((err as Error).message);
  process.exit(1);
}

// A board id is a slug, so renaming or archiving frees it for reuse. Anything
// that keys on that id has to be told before the next board claims it — shares
// since v1.6, and folders, which key assignments and favourites on it too and
// silently unfiled a board the moment it was renamed.
onBoardIdentityChange(followBoardIdentity);
onBoardIdentityChange(followBoardRename);

await app.register(fastifyCookie);

/*
 * A URL segment of `.` or `..` addresses nothing this app serves: the API takes
 * ids, never paths, and the client bundle has no dot-segments either. Refusing
 * them here, before routing, stops the static handler answering such a request
 * with `403 Forbidden` — which surfaced as a 500 *and* told the caller their
 * traversal had been interesting. A flat 400 says nothing at all.
 *
 * A separator can arrive encoded too — `..%2f..%2f` or `..%5c` — so a segment
 * is split again after decoding, on either slash. Splitting only the raw URL let
 * those through to `@fastify/static`, which answered `\` with the same 403-as-500
 * and `/` with the SPA page: harmless, but a 200 for a traversal is still a lie.
 */
const hasDotSegment = (url: string): boolean =>
  url
    .split('?')[0]
    .split('/')
    .some((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        /* a malformed escape is not a dot-segment; the router will refuse it */
      }
      return decoded.split(/[/\\]/).some((part) => part === '.' || part === '..');
    });

app.addHook('onRequest', async (req, reply) => {
  if (!hasDotSegment(req.raw.url ?? '')) return;
  reply.code(400).send({ error: { code: 'bad_request', message: 'Invalid request path.' } });
  return reply; // short-circuits the lifecycle, the documented way
});

/** The board routes, whichever workspace the request has been pointed at. */
const boardSurface = async (scope: FastifyInstance) => {
  await scope.register(boardsRoutes);
  await scope.register(nodesRoutes);
  await scope.register(snapshotsRoutes);
  await scope.register(exportRoutes);
  await scope.register(framesRoutes);
  await scope.register(clipboardRoutes);
};

await app.register(
  async (api) => {
    installAuth(api);
    await api.register(authRoutes);

    // Everything else is behind the wall — including /config, which used to be public.
    await api.register(async (guarded) => {
      guarded.addHook('onRequest', requireAuth);
      // `:id` is a board id on every route that has one; one resolution for all
      // of them is what makes an invisible board a uniform 404 (§5).
      guarded.addHook('preHandler', assertBoardVisible);
      guarded.get('/config', async () => getConfig());
      await boardSurface(guarded);
      // Sharing is administered from the owner's own scope: who may see my
      // board is a fact about my board (§5). Tokens are the same shape of fact
      // — an agent's key to my workspace, mine alone to mint and revoke (v1.7 §2).
      await guarded.register(sharesRoutes);
      await guarded.register(tokensRoutes);
      // How my shelf is arranged is a fact about my workspace, same as the two
      // above — mine alone to read and write (v1.8 §7).
      await guarded.register(foldersRoutes);

      /*
       * Somebody else's workspace (§5): the same board surface, a root that is
       * not yours, and one middleware deciding which rung let you in — a share,
       * Admin View, or nothing at all. Admin opens are audited; shares are not,
       * being an arrangement the owner made on purpose.
       */
      await guarded.register(
        async (elsewhere) => {
          elsewhere.addHook('onRequest', workspaceAccess);
          elsewhere.addHook('onRequest', denyMutations);
          elsewhere.addHook('preHandler', auditBoardOpen);
          elsewhere.addHook('preHandler', recordShareAccess);
          await boardSurface(elsewhere);
        },
        { prefix: '/u/:ownerId' },
      );

      await guarded.register(async (admin) => {
        admin.addHook('onRequest', requireSuperAdmin);
        await admin.register(adminRoutes);
      });
    });
  },
  { prefix: '/api' },
);

/*
 * The MCP surface (v1.7 §1), mounted beside `/api` rather than inside it: an
 * agent presents a bearer token, not a session cookie, so it cannot pass
 * `requireAuth` and authenticates itself instead. Registered before the static
 * handler so `/mcp` is a route and not a missing file.
 */
await app.register(mcpRoutes);

const hasClient = await exists(path.join(CLIENT_DIR, 'index.html'));
if (hasClient) {
  await app.register(fastifyStatic, { root: CLIENT_DIR });
} else {
  app.log.warn(`Client bundle not found at ${CLIENT_DIR} — serving API only.`);
  app.get('/', async () => ({ ok: true, message: 'Cartographer API. Client bundle not built.' }));
}

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api') || !hasClient) {
    reply.code(404).send({ error: { code: 'not_found', message: `No route for ${req.method} ${req.url}` } });
    return;
  }
  reply.sendFile('index.html'); // SPA fallback: deep links land on the client router
});

// Nothing serves requests until the volume is in the current shape. Tenancy
// first (v1.6 §8.1): the node-directory pass then walks the user roots the move
// has just created, rather than a top level that no longer holds boards.
const migrationDeps = {
  snapshot: createSnapshot,
  log: (message: string) => app.log.info(message),
};
await runTenancyMigration({
  ...migrationDeps,
  adminUserId: bootstrapAdminId(),
  debug: (message: string) => app.log.debug(message),
});
await runNodeDirMigration(await listWorkspaces(), migrationDeps);

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
