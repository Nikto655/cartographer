/**
 * The MCP mount (v1.7 §1). Streamable HTTP at `/mcp`, on the existing server:
 * same container, same port, same volume, reachable through whatever proxy
 * already fronts the app. There is no second deployment surface, and nothing
 * here listens on its own.
 *
 * It sits *outside* the `/api` scope on purpose. Everything under `/api` is
 * behind `requireAuth`, which means a session cookie; an MCP client holds a
 * bearer token and no cookie, so this route authenticates itself — see
 * `identity.ts`, which is the only other way into a workspace.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Workspace } from '../../core/storage.js';
import { createSnapshot } from '../snapshots/index.js';
import { type McpIdentity, identify } from './identity.js';
import { registerTools } from './tools.js';

/*
 * The name every client shows beside the tool list, so it is the product's name
 * and not the repo's short one. `@cartograph/shared` and the React Flow node
 * type keep the abbreviation — those are identifiers nobody reads.
 */
const SERVER_INFO = { name: 'cartographer', version: '1.7.0' };

const INSTRUCTIONS = [
  'Cartographer is a visual thinking tool: boards of linked nodes, where every node is a markdown file on disk.',
  'Start with list_boards. A "map" board is cards on a canvas — processes, architecture, plans. A "graph" board is entities and their relationships.',
  'Statuses, shapes and colours are configured per deployment: call get_config once and use the ids it gives you rather than guessing. Setting an unknown status is refused.',
  'To build something: create_board, then create_nodes (write each node’s notes in the same call), then link_nodes for the flow, then create_frame to group what belongs together.',
  'To read something documented: export_board gives you the whole thing as one markdown document; read_node when you only need one.',
  'You are working in one person’s private workspace and can see nothing outside it. Nothing here can archive, delete or share — a person does those.',
].join('\n');

/*
 * **Stateless.** No session ids, and therefore no sessions to lose.
 *
 * The transport can run either way. Stateful was the obvious first choice — one
 * `McpServer` per client, an id in a header — and it works right up until the
 * process restarts. Sessions live in memory, so a deploy, a crash or an idle
 * sweep takes every one of them with it, and the next call from a client that
 * has been sitting there all night carries an id nothing recognises. The spec
 * says answer that with 404 and the client should start a new session; some do,
 * and the ones that do not simply stop working until the person restarts them.
 * That is what "Claude Desktop keeps disconnecting" looks like from this end.
 *
 * Stateless removes the failure rather than handling it. Every request carries
 * its own bearer token, which is the thing that actually says who is calling —
 * the session id never added any authority, it only had to be *kept*. A restart
 * is now invisible to a connected client, and so is a client that reconnects
 * with a stale id: there is nothing to check it against.
 *
 * The costs, and why they are acceptable:
 *
 *  - A fresh `McpServer` and transport per request, with all 26 tools
 *    registered. Measured at a few milliseconds — see OPERATIONS. Set against a
 *    client that hangs until it is restarted, that is not a trade worth making
 *    the other way.
 *  - No server-initiated notifications, which we never sent.
 *  - The once-per-run snapshot has to remember across requests now; it is keyed
 *    on the token below instead of on a session, which is closer to what it
 *    meant anyway — one snapshot per agent, per board, not per connection.
 */

/**
 * The first write of an agent run on a board takes a snapshot, so a run is
 * always one restore away from undone (§4).
 *
 * Keyed on the token rather than a connection: an agent that reconnects between
 * two writes is the same agent, and a second snapshot of the same board tells
 * nobody anything. Kept for `SNAPSHOT_MEMORY_MS` and then forgotten, so a run
 * tomorrow gets its own safety net.
 */
const SNAPSHOT_MEMORY_MS = 30 * 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;
const snapshotted = new Map<string, number>();

const sweep = setInterval(() => {
  const cutoff = Date.now() - SNAPSHOT_MEMORY_MS;
  for (const [key, at] of snapshotted) {
    if (at <= cutoff) snapshotted.delete(key);
  }
}, SWEEP_MS);
// Never the reason the process stays alive.
sweep.unref();

function buildServer(identity: McpIdentity): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  registerTools(server, {
    identity,
    /**
     * Failing to take a snapshot must not stop the write — a board with no
     * snapshot directory yet is the ordinary case, and refusing to work because
     * the safety net could not be hung would be the worse failure.
     */
    snapshotOnce: async (ws: Workspace, boardId: string) => {
      const key = `${identity.tokenId}:${ws.userId}:${boardId}`;
      const last = snapshotted.get(key);
      if (last !== undefined && Date.now() - last < SNAPSHOT_MEMORY_MS) return;
      snapshotted.set(key, Date.now());
      await createSnapshot(ws, boardId).catch(() => {});
    },
  });

  return server;
}

const jsonRpcError = (code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  error: { code, message },
  id: null,
});

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  /**
   * A DELETE terminating a session carries no body, and Fastify's JSON parser
   * refuses an empty one. It is a valid request in the protocol, so it is parsed
   * as "nothing" rather than rejected.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (!body) return done(null, undefined);
      try {
        done(null, JSON.parse(body) as unknown);
      } catch (err) {
        (err as Error & { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

  const handle = async (req: FastifyRequest, reply: FastifyReply) => {
    // Authenticated before anything is hijacked, so a bad token gets the app's
    // ordinary JSON error rather than a half-open stream. This is the whole of
    // the access decision now — there is no session to also agree with it.
    const identity = identify(req.headers.authorization);

    const server = buildServer(identity);
    const transport = new StreamableHTTPServerTransport({
      // Stateless: no id is issued, none is demanded back, and a stale one from
      // a client that has been asleep is simply ignored rather than rejected.
      sessionIdGenerator: undefined,
      /*
       * Answer with a JSON body rather than opening an SSE stream. A tool call
       * is a question and an answer with nothing to stream in between, and a
       * one-frame event stream is the shape most likely to be held up on the
       * way: proxies and CDNs buffer, coalesce and time out `text/event-stream`
       * in ways they never do an `application/json` body of the same size.
       */
      enableJsonResponse: true,
    });

    /*
     * One transport per request, closed with the response it served. The SDK is
     * explicit that a stateless transport must not be reused — two clients on
     * one would collide on message ids — and a transport that outlives its
     * response is a leak, which on a long-running instance is the same bug as
     * the sessions this replaced.
     */
    reply.raw.on('close', () => {
      void Promise.resolve()
        .then(() => transport.close())
        .catch(() => {});
      void Promise.resolve()
        .then(() => server.close())
        .catch(() => {});
    });

    await server.connect(transport);

    // From here the SDK owns the socket: it writes the status line, the headers
    // and the body. Fastify must not also try to.
    reply.hijack();
    try {
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      app.log.error(err);
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
      }
      if (!reply.raw.writableEnded) {
        reply.raw.end(JSON.stringify(jsonRpcError(-32603, 'Internal error.')));
      }
    }
  };

  app.post('/mcp', handle);

  /*
   * **No standalone stream.** The spec makes `GET /mcp` optional and says to
   * answer 405 when a server does not offer one, which is the honest answer
   * here: nothing on this server ever pushes to a client. Every reply is the
   * response to a request, and it comes back on that request's POST.
   *
   * Answering it anyway was worse than useless. The transport would open an SSE
   * stream carrying keep-alive comments and nothing else, a bridge would hold it
   * open for hours across a CDN, and when it eventually dropped — a sleeping
   * laptop, an edge recycling a connection — `mcp-remote` would retry twice and
   * then stop for good: "Maximum reconnection attempts (2) exceeded". After that
   * the bridge is a live process that will never speak to the server again, so
   * every tool call disappears into it. That is what "the agent hung" looked
   * like in the logs, and it is a whole failure class removed by declining a
   * stream we were never using.
   *
   * A client that reads the 405 simply does not open one, and posts as needed.
   */
  app.get('/mcp', async (_req, reply) =>
    reply
      .code(405)
      .header('allow', 'POST, DELETE')
      .send(jsonRpcError(-32000, 'This server does not offer a standalone stream; POST your requests.')),
  );

  // Ending a session that does not exist is a no-op, but clients send it on
  // shutdown and an error there reads as a fault. Acknowledged and dropped.
  app.delete('/mcp', handle);
}
