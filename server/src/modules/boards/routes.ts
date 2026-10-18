import type { FastifyInstance } from 'fastify';
import type { CreateBoardPayload, GraphPayload } from '@cartograph/shared';
import { safeId } from '../../core/storage.js';
import { isBoardVisible, workspaceOf, writableWorkspaceOf } from '../auth/index.js';
import { onBoardChange, onBoardIdentityChange } from '../../core/boardEvents.js';
import * as service from './service.js';

/**
 * Proxies and browsers both give up on a quiet connection. 25s is under the
 * usual 30s idle default with room to spare, and a comment line costs nothing.
 */
const HEARTBEAT_MS = 25_000;

export async function boardsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/boards', async (req) => {
    const summaries = await service.listBoards(workspaceOf(req));
    // On a share this is the shared tree rather than the owner's shelf (§5): the
    // list a viewer gets has to be the same set the router will open, and a
    // parent outside it is not a parent as far as this request is concerned.
    return summaries
      .filter((summary) => isBoardVisible(req, summary.id))
      .map((summary) =>
        isBoardVisible(req, summary.parentBoard ?? '')
          ? summary
          : { ...summary, parentBoard: undefined },
      );
  });

  /*
   * The Archive tab (v1.9). These sit *above* `/boards/:id` on purpose —
   * "archived" would otherwise be read as a board id by the route matcher, and
   * `assertBoardVisible` would 404 the whole tab.
   *
   * Writes take `writableWorkspaceOf`: an archive belongs to whoever owns the
   * workspace, and someone browsing a shared board has no business emptying it.
   */
  app.get('/boards/archived', async (req) => service.listArchivedBoards(workspaceOf(req)));

  app.post('/boards/archived/:entry/restore', async (req) => {
    const { entry } = req.params as { entry: string };
    return service.restoreBoard(writableWorkspaceOf(req), entry);
  });

  app.post('/boards/archived/:entry/delete', async (req) => {
    const { entry } = req.params as { entry: string };
    return service.deleteArchivedBoard(writableWorkspaceOf(req), entry);
  });

  app.post('/boards', async (req, reply) => {
    const board = await service.createBoard(writableWorkspaceOf(req), req.body as CreateBoardPayload);
    reply.code(201);
    return board;
  });

  /*
   * Live changes for one open board (Server-Sent Events).
   *
   * SSE rather than a websocket: this is strictly one-way, it rides the session
   * cookie the rest of `/api` already uses, `EventSource` reconnects by itself,
   * and it needs no dependency. Registered inside the guarded scope like every
   * other route, so it inherits `requireAuth` and `assertBoardVisible` — a board
   * you cannot see is a 404 here exactly as it is everywhere else.
   *
   * The payload is only "this board changed". The client refetches, so the files
   * stay the single description of a board and no diff can drift from them.
   */
  /**
   * The shelf's own stream. Same idea as the per-board one below, one level up:
   * the dashboard is a list of boards, so it has to hear about a board arriving,
   * being renamed or leaving — not only about one changing while you watch it.
   *
   * An agent creating a board is exactly the case: nothing on the dashboard was
   * open on it, so nothing was listening, and the shelf stayed as it was until
   * someone reloaded the page.
   *
   * Static path, so it can never be read as a board called "events" — Fastify
   * matches this before `/boards/:id/events` regardless of declaration order.
   *
   * The payload is deliberately empty. The client refetches the list, which
   * keeps the files the single description of what is on the shelf, and means a
   * burst of writes coalesces into one reload rather than N patches.
   */
  app.get('/boards/events', async (req, reply) => {
    const ws = workspaceOf(req);

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');

    /*
     * Never throws into the emitter. `emitBoardIdentityChange` runs its
     * listeners unguarded on purpose — a throw there would unwind a rename that
     * has already moved directories on disk — so the guard belongs here, on the
     * side that can fail. A dead socket is the ordinary way this ends.
     */
    const send = (event: string) => {
      try {
        reply.raw.write(`event: ${event}\ndata: {}\n\n`);
      } catch {
        /* the connection went away; `close` below is what tidies up */
      }
    };
    send('open');

    const offChange = onBoardChange((change) => {
      if (change.userId === ws.userId) send('shelf');
    });
    // Renames and archives never touch a board's own file, so they arrive here
    // and nowhere else — and they are half of what the shelf shows.
    const offIdentity = onBoardIdentityChange((change) => {
      if (change.userId === ws.userId) send('shelf');
    });
    const beat = setInterval(() => {
      try {
        reply.raw.write(': keep-alive\n\n');
      } catch {
        /* same */
      }
    }, HEARTBEAT_MS);

    const close = () => {
      clearInterval(beat);
      offChange();
      offIdentity();
    };
    req.raw.on('close', close);
    req.raw.on('error', close);

    return reply;
  });

  app.get('/boards/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const boardId = safeId(id);
    const ws = workspaceOf(req);

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // nginx buffers by default, which holds events until the buffer fills —
      // for a stream whose whole point is immediacy that reads as "broken".
      'x-accel-buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    // Named so a client can tell "connected" from "something happened".
    send('open', { boardId });

    const off = onBoardChange((change) => {
      if (change.userId !== ws.userId || change.boardId !== boardId) return;
      send('board', { boardId });
    });
    const beat = setInterval(() => reply.raw.write(': keep-alive\n\n'), HEARTBEAT_MS);

    const close = () => {
      clearInterval(beat);
      off();
    };
    req.raw.on('close', close);
    req.raw.on('error', close);

    // Fastify must not try to send a body of its own for a stream we own.
    return reply;
  });

  app.get('/boards/:id', async (req) => {
    const { id } = req.params as { id: string };
    const board = await service.getBoard(workspaceOf(req), safeId(id));
    // A sub-board can be shared on its own, and then its parent is somebody
    // else's private business: the id would be all a viewer ever saw of it, but
    // half a reference is worse than none — the breadcrumb has nowhere to go.
    if (!isBoardVisible(req, board.parentBoard ?? '')) {
      delete board.parentBoard;
      delete board.parentNode;
    }
    return board;
  });

  app.patch('/boards/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { name } = req.body as { name: string };
    return service.renameBoard(writableWorkspaceOf(req), safeId(id), name);
  });

  app.put('/boards/:id/graph', async (req) => {
    const { id } = req.params as { id: string };
    return service.saveGraph(writableWorkspaceOf(req), safeId(id), req.body as GraphPayload);
  });

  app.post('/boards/:id/duplicate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const board = await service.duplicateBoard(writableWorkspaceOf(req), safeId(id));
    reply.code(201);
    return board;
  });

  app.post('/boards/:id/archive', async (req) => {
    const { id } = req.params as { id: string };
    return service.archiveBoard(writableWorkspaceOf(req), safeId(id));
  });
}
