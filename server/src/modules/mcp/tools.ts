/**
 * The toolset (v1.7 §3). Curated and task-shaped rather than a mirror of the
 * REST surface: an agent should be able to build a documented map in one
 * conversation, and should not be able to destroy one at all.
 *
 * **No board logic lives here.** Every tool is argument-shaping, a call into the
 * same service function a route calls, and a JSON reply. If a rule about boards
 * appears in this file it is in the wrong place — that is the whole point of the
 * arrangement, and it is what stops the MCP surface and the app drifting apart.
 *
 * Deliberate absences (§3): nothing archives, deletes, renames a board, shares,
 * administers, or reads another person's workspace. Agents create and refine;
 * people destroy and share.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BoardType, EdgeSide } from '@cartograph/shared';
import { getConfig } from '../../core/config.js';
import { HttpError, badRequest } from '../../core/errors.js';
import { type Workspace, ensureWorkspace, safeId, workspaceFor } from '../../core/storage.js';
import { recordAudit } from '../admin/index.js';
import {
  addEdges,
  createBoard,
  createTexts,
  getBoard,
  listBoards,
  arrangeNodes,
  moveNodes,
  removeEdges,
  removeTexts,
  styleNodes,
  updateEdge,
  updateText,
} from '../boards/index.js';
import {
  appendBody,
  createNodes,
  getNodeContent,
  patchNode,
  putBody,
  putData,
} from '../nodes/index.js';
import { createFolder, fileBoards, readFolders, updateFolder } from '../folders/index.js';
import { createFrame, setFrameMembership, updateFrame } from '../frames/index.js';
import { exportPath } from '../export/index.js';
import { searchNodes } from '../search/index.js';
import type { McpIdentity } from './identity.js';

/*
 * Input caps (§4). Polite bounds, not security: the token already decides what
 * can be reached. These are what keeps a confused agent from flooding a board
 * faster than its owner can notice — a wrong loop should cost one clear error,
 * not fifty thousand nodes.
 */
const MAX_NODES_PER_CALL = 50;
const MAX_EDGES_PER_CALL = 200;
const MAX_NODE_IDS_PER_CALL = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_BODY_LENGTH = 100_000;
const MAX_SNIPPETS_PER_NODE = 20;
const MAX_SNIPPET_LENGTH = 50_000;
const MAX_TAGS_PER_NODE = 20;
const MAX_TAG_LENGTH = 40;
const MAX_TEXTS_PER_CALL = 50;
const MAX_BOARDS_PER_CALL = 100;
const MAX_TEXT_LENGTH = 2_000;

/**
 * Statuses, shapes and colours are per-deployment (`data/config.json`), so no
 * description here may name one: `get_config` is where a caller learns the
 * vocabulary, and every field that takes one says so.
 */
const STATUS_HINT = 'A status id from this deployment — call get_config for the list.';
/**
 * Unset is not the same as the `clear` swatch: unset lets coverage decide the
 * fill (white once written, transparent while empty), `clear` pins it
 * transparent. Both are choices, so both have to be sayable.
 */
const COLOR_HINT =
  'A colour id or token from get_config, e.g. "sky" or "--node-sky". null removes the colour and lets coverage decide the fill.';

/** What every tool is handed: who is asking, and the session they are asking in. */
export interface ToolContext {
  identity: McpIdentity;
  /**
   * Takes one snapshot per board per session, the first time this session writes
   * to it (§4). An agent run is then always one restore away from undone, and
   * the tenth write of a run does not take a tenth copy of the board.
   */
  snapshotOnce: (ws: Workspace, boardId: string) => Promise<void>;
}

// ---- replies ----

/** Compact on purpose: every byte here is a token the caller pays for. */
const json = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

const document = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }] });

/**
 * Errors come back as tool errors carrying the message, not as transport
 * failures. An agent reads them and corrects itself; a bare 400 gives it nothing
 * to act on.
 */
const failed = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

const READ_ONLY_TOKEN =
  'This token is read-only. Generate a “Read & write” token in Cartographer under Profile → API & Agents to make changes.';

/**
 * One wrapper around every handler, so no tool can forget any of it: the
 * workspace is resolved from the token and never from an argument, write scope
 * is checked before anything runs, and a thrown `HttpError` becomes a sentence
 * the caller can act on.
 */
function tool<A>(
  context: ToolContext,
  mode: 'read' | 'write',
  run: (ws: Workspace, args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    if (mode === 'write' && context.identity.scope !== 'write') return failed(READ_ONLY_TOKEN);
    try {
      // The one place a token becomes a set of paths. Always the owner's own
      // workspace — v1 does not reach shared boards at all (§3).
      const ws = workspaceFor(context.identity.userId);
      await ensureWorkspace(ws);
      return await run(ws, args);
    } catch (err) {
      if (err instanceof HttpError) return failed(err.message);
      // Anything else can carry an absolute path and another tenant's user id.
      // It is logged by the transport; the caller gets a sentence.
      throw err;
    }
  };
}

/** One row per write, stamped with the transport and the token (§4). */
function audit(context: ToolContext, action: string, target: string): void {
  recordAudit(context.identity.userId, `mcp.${action}`, target, {
    via: 'mcp',
    label: context.identity.tokenName,
  });
}

/** How an agent-drawn node says who drew it (§4). */
const attribution = (context: ToolContext) => ({
  token: context.identity.tokenName,
  at: new Date().toISOString(),
});

function capped(value: string | undefined, limit: number, what: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > limit) throw badRequest(`${what} is limited to ${limit} characters.`);
  return value;
}

function cappedList<T>(items: readonly T[], limit: number, what: string): readonly T[] {
  if (items.length > limit) {
    throw badRequest(`${what}: at most ${limit} per call — split it across calls.`);
  }
  return items;
}

function cleanTags(tags: string[] | undefined): string[] | undefined {
  if (tags === undefined) return undefined;
  cappedList(tags, MAX_TAGS_PER_NODE, 'Tags');
  for (const tag of tags) capped(tag, MAX_TAG_LENGTH, 'A tag');
  return tags;
}

// ---- schemas shared by several tools ----

const boardIdArg = z.string().describe('Board id — the slug from list_boards, e.g. "signup-flow".');
const nodeIdArg = z.string().describe('Node id — the slug from get_board.');
const shapeArg = z
  .enum(['rect', 'rounded', 'ellipse', 'diamond', 'pill'])
  .describe('Card shape. Default "rect".');

// ---- registration ----

export function registerTools(server: McpServer, context: ToolContext): void {
  registerReadTools(server, context);
  registerWriteTools(server, context);
}

function registerReadTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'get_config',
    {
      title: 'Get this deployment’s vocabulary',
      description:
        'The statuses, node shapes and colours this Cartographer defines, plus the theme. All of it is configurable per deployment, so do not assume the defaults — read them here before setting a status, shape or colour. Colours have both an `id` ("sky") and the `token` actually stored ("--node-sky"); either is accepted wherever a colour is taken.',
    },
    tool(context, 'read', async () => {
      const config = await getConfig();
      return json({
        statuses: config.statuses.map((s) => ({ id: s.id, label: s.label })),
        shapes: config.shapes,
        colors: config.colors.map((c) => ({ id: c.id, label: c.label, token: c.token })),
        theme: config.theme,
      });
    }),
  );

  server.registerTool(
    'list_boards',
    {
      title: 'List boards',
      description:
        'Every board in your Cartographer workspace: id, name, world (map or graph), parent board, node count, status counts, when it last changed, and the folder it is filed under (`folder`, null when unfiled). `folder` is the folder’s name, which is also what file_boards takes. Start here — every other tool takes a board id.',
    },
    tool(context, 'read', async (ws) => {
      const [summaries, { folders }] = await Promise.all([listBoards(ws), readFolders(ws)]);
      const names = new Map(folders.map((folder) => [folder.id, folder.name]));
      // The name, not the id: an agent has no folder list to resolve an id
      // against, and `folderId` would be an opaque string it could only echo.
      // `favorite` is left out for the same reason — a star is a human's
      // emphasis and says nothing an agent can act on.
      return json(
        summaries.map(({ folderId, favorite: _favorite, ...summary }) => ({
          ...summary,
          folder: (folderId && names.get(folderId)) || null,
        })),
      );
    }),
  );

  server.registerTool(
    'list_folders',
    {
      title: 'List folders',
      description:
        'The folders on this workspace’s shelf, in the order they are shown, with how many boards each holds. A folder is a label rather than a place: filing a board moves nothing on disk, and a board is listed in Recent and All whether it is filed or not. Use the name with file_boards — ids are shown but you never need one.',
    },
    tool(context, 'read', async (ws) => {
      const { folders, assignments } = await readFolders(ws);
      const counts = new Map<string, number>();
      for (const folderId of Object.values(assignments)) {
        counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
      }
      return json(
        folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          color: folder.color ?? null,
          boards: counts.get(folder.id) ?? 0,
        })),
      );
    }),
  );

  server.registerTool(
    'get_board',
    {
      title: 'Get a board',
      description:
        'The structure of one board: nodes (id, title, type, status, description, frame, whether it has data or sub-boards), edges, frames, text annotations, and the [[wiki-links]] found in the notes. Note bodies are NOT included — read those one at a time with read_node.',
      inputSchema: { boardId: boardIdArg },
    },
    tool(context, 'read', async (ws, { boardId }: { boardId: string }) => {
      const board = await getBoard(ws, safeId(boardId));
      return json({
        id: board.id,
        name: board.name,
        boardType: board.boardType,
        parentBoard: board.parentBoard,
        nodes: board.nodes.map((node) => ({
          id: node.id,
          title: node.title,
          type: node.type,
          status: node.status,
          description: node.description,
          // Returned so a caller can reason about a layout it did not create —
          // `move_nodes` is unusable without knowing where things already are.
          position: node.position,
          size: node.size,
          shape: node.shape,
          color: node.color,
          variant: node.variant,
          frameId: node.frameId,
          hasData: !!node.hasData,
          documented: node.coverage === 'written',
          childBoards: node.childBoards,
          createdVia: node.createdVia,
        })),
        edges: board.edges,
        frames: board.frames.map((frame) => ({
          id: frame.id,
          title: frame.title,
          position: frame.position,
          size: frame.size,
          color: frame.color,
          collapsed: frame.collapsed,
        })),
        texts: board.texts.map((t) => ({
          id: t.id,
          text: t.text,
          position: t.position,
          size: t.size,
          bold: t.bold,
          italic: t.italic,
          underline: t.underline,
        })),
        links: board.links ?? [],
        warnings: board.warnings,
      });
    }),
  );

  server.registerTool(
    'read_node',
    {
      title: 'Read a node',
      description:
        'One node in full: frontmatter, the note body, its data snippets, whatever flows into it from upstream nodes, and the wiki-links it makes and receives.',
      inputSchema: { boardId: boardIdArg, nodeId: nodeIdArg },
    },
    tool(context, 'read', async (ws, args: { boardId: string; nodeId: string }) => {
      const board = safeId(args.boardId);
      const node = safeId(args.nodeId);
      const content = await getNodeContent(ws, board, node);
      // Links are computed from every note on the board, so they only exist on
      // the board read — there is nothing stored on the node to return instead.
      const links = (await getBoard(ws, board)).links ?? [];
      return json({
        frontmatter: content.frontmatter,
        body: content.body,
        data: content.data,
        incoming: content.incoming,
        // `nodeId: null` is a link written to a title nothing answers to — a
        // ghost on the canvas, and worth telling the caller apart from a hit.
        linksOut: links
          .filter((link) => link.sourceId === node)
          .map((link) => ({ title: link.targetTitle, nodeId: link.targetId })),
        linksIn: links.filter((link) => link.targetId === node).map((link) => link.sourceId),
      });
    }),
  );

  server.registerTool(
    'export_board',
    {
      title: 'Export a board as markdown',
      description:
        'The whole board as one markdown document — every node’s notes and data in reading order, the same output as the app’s Export. Use this to read a documented board in one call instead of node by node. `descend` follows sub-boards.',
      inputSchema: {
        boardId: boardIdArg,
        descend: z.boolean().optional().describe('Include sub-boards. Default false.'),
      },
    },
    tool(context, 'read', async (ws, args: { boardId: string; descend?: boolean }) => {
      const result = await exportPath(ws, safeId(args.boardId), {
        nodeIds: [],
        descend: args.descend ?? false,
      });
      return document(result.markdown);
    }),
  );

  server.registerTool(
    'search_nodes',
    {
      title: 'Search node text',
      description:
        'Find text across titles, descriptions and note bodies in your workspace. Returns the board and node it was found on plus the match in context. Narrow it to one board with `boardId`.',
      inputSchema: {
        query: z.string().describe('Text to look for. Case-insensitive, matched as a substring.'),
        boardId: boardIdArg.optional().describe('Search only this board. Default: everything.'),
      },
    },
    tool(context, 'read', async (ws, args: { query: string; boardId?: string }) =>
      json(
        await searchNodes(ws, args.query, {
          boardId: args.boardId ? safeId(args.boardId) : undefined,
        }),
      ),
    ),
  );
}

function registerWriteTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'create_board',
    {
      title: 'Create a board',
      description:
        'A new board. "map" is the ordinary world — cards on a canvas, for processes and architecture. "graph" is for entities and their relationships, laid out by force simulation. Pass both parentBoardId and parentNodeId to hang it under an existing node as a sub-board.',
      inputSchema: {
        name: z.string().describe('Board name. The id is slugified from it.'),
        boardType: z.enum(['map', 'graph']).optional().describe('Default "map".'),
        parentBoardId: boardIdArg.optional().describe('Board holding the node it hangs from.'),
        parentNodeId: nodeIdArg.optional().describe('Node it hangs from, in parentBoardId.'),
      },
    },
    tool(
      context,
      'write',
      async (
        ws,
        args: { name: string; boardType?: BoardType; parentBoardId?: string; parentNodeId?: string },
      ) => {
        // Both or neither: a node id alone does not say which board it is on, and
        // guessing would attach the new board to whichever one happened to match.
        if (!!args.parentBoardId !== !!args.parentNodeId) {
          throw badRequest('Pass parentBoardId and parentNodeId together, or neither.');
        }
        const board = await createBoard(ws, {
          name: capped(args.name, MAX_TITLE_LENGTH, 'A board name')!,
          boardType: args.boardType,
          parentBoard: args.parentBoardId ? safeId(args.parentBoardId) : undefined,
          parentNode: args.parentNodeId ? safeId(args.parentNodeId) : undefined,
        });
        audit(context, 'create_board', board.id);
        return json({ id: board.id, name: board.name, boardType: board.boardType });
      },
    ),
  );

  server.registerTool(
    'create_nodes',
    {
      title: 'Create nodes',
      description:
        'Add nodes to a board, in one call. Positions are optional and usually best left out — a node without one is placed in a grid below whatever is already on the board, so a run lands as a legible block. On a graph board a position is only a starting point: the force simulation moves the node from wherever you put it, so it is rarely worth sending. Write each node’s note body here rather than in a second call.',
      inputSchema: {
        boardId: boardIdArg,
        nodes: z
          .array(
            z.object({
              title: z.string(),
              description: z.string().optional().describe('One or two sentences, shown on the card.'),
              body: z.string().optional().describe('The note, in markdown. [[Titles]] link nodes.'),
              status: z.string().optional().describe(STATUS_HINT),
              color: z.string().optional().describe(COLOR_HINT),
              tags: z
                .array(z.string())
                .optional()
                .describe('Free-form labels. Graph boards can colour by tag.'),
              shape: shapeArg.optional(),
              frameId: z.string().optional().describe('Put it in this frame.'),
              position: z.object({ x: z.number(), y: z.number() }).optional(),
            }),
          )
          .describe(`Up to ${MAX_NODES_PER_CALL} nodes.`),
      },
    },
    tool(
      context,
      'write',
      async (
        ws,
        args: {
          boardId: string;
          nodes: {
            title: string;
            description?: string;
            body?: string;
            status?: string;
            color?: string;
            tags?: string[];
            shape?: 'rect' | 'rounded' | 'ellipse' | 'diamond' | 'pill';
            frameId?: string;
            position?: { x: number; y: number };
          }[];
        },
      ) => {
        const board = safeId(args.boardId);
        const inputs = cappedList(args.nodes ?? [], MAX_NODES_PER_CALL, 'Nodes');
        if (!inputs.length) throw badRequest('Give me at least one node to create.');
        await context.snapshotOnce(ws, board);

        const createdBy = attribution(context);
        const created = await createNodes(
          ws,
          board,
          inputs.map((input) => ({
            title: capped(input.title, MAX_TITLE_LENGTH, 'A node title')!,
            description: capped(input.description, MAX_DESCRIPTION_LENGTH, 'A description'),
            body: capped(input.body, MAX_BODY_LENGTH, 'A note body'),
            status: input.status,
            color: input.color,
            tags: cleanTags(input.tags),
            shape: input.shape,
            frameId: input.frameId,
            position: input.position,
            createdBy,
          })),
        );
        audit(context, 'create_nodes', `${board} (${created.length})`);
        return json(created.map((node) => ({ id: node.id, title: node.title })));
      },
    ),
  );

  server.registerTool(
    'update_node',
    {
      title: 'Update a node',
      description:
        'Change a node field by field — anything you leave out is left alone. `body` replaces the note; `appendBody` adds to the end of it, which is what you want when documenting as you go. Renaming a node changes its id: the new one is in the reply, and every [[link]] to it is rewritten for you.',
      inputSchema: {
        boardId: boardIdArg,
        nodeId: nodeIdArg,
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.string().optional().describe(STATUS_HINT),
        tags: z.array(z.string()).optional().describe('Replaces the node’s tags entirely.'),
        body: z.string().optional().describe('Replaces the whole note.'),
        appendBody: z.string().optional().describe('Added to the end of the note instead.'),
      },
    },
    tool(
      context,
      'write',
      async (
        ws,
        args: {
          boardId: string;
          nodeId: string;
          title?: string;
          description?: string;
          status?: string;
          tags?: string[];
          body?: string;
          appendBody?: string;
        },
      ) => {
        const board = safeId(args.boardId);
        let node = safeId(args.nodeId);
        if (args.body !== undefined && args.appendBody !== undefined) {
          throw badRequest('Pass body or appendBody, not both — they disagree about the note.');
        }
        await context.snapshotOnce(ws, board);

        let renamedFrom: string | undefined;
        if (
          args.title !== undefined ||
          args.description !== undefined ||
          args.status !== undefined ||
          args.tags !== undefined
        ) {
          const result = await patchNode(ws, board, node, {
            title: capped(args.title, MAX_TITLE_LENGTH, 'A node title'),
            description: capped(args.description, MAX_DESCRIPTION_LENGTH, 'A description'),
            status: args.status,
            tags: cleanTags(args.tags),
          });
          // The frontmatter edit may have re-slugged the node, and the body write
          // below has to land on the file that now exists rather than the one the
          // caller named.
          renamedFrom = result.renamedFrom;
          node = result.node.id;
        }

        if (args.body !== undefined) {
          await putBody(ws, board, node, capped(args.body, MAX_BODY_LENGTH, 'A note body')!);
        } else if (args.appendBody !== undefined) {
          await appendBody(
            ws,
            board,
            node,
            capped(args.appendBody, MAX_BODY_LENGTH, 'A note body')!,
          );
        }

        audit(context, 'update_node', `${board}/${node}`);
        const content = await getNodeContent(ws, board, node);
        return json({
          nodeId: node,
          renamedFrom,
          title: content.frontmatter.title,
          status: content.frontmatter.status,
        });
      },
    ),
  );

  server.registerTool(
    'set_node_data',
    {
      title: 'Set a node’s data snippets',
      description:
        'Replaces the node’s labelled code/data snippets. Mark one as the output with `outSnippetId` and it flows to every node this one points at — that is how a documented pipeline carries its example payloads.',
      inputSchema: {
        boardId: boardIdArg,
        nodeId: nodeIdArg,
        snippets: z
          .array(
            z.object({
              id: z.string().optional().describe('Keep an existing snippet’s id to update it.'),
              label: z.string(),
              lang: z.string().describe('e.g. "json", "ts", "sql", "txt".'),
              code: z.string(),
            }),
          )
          .describe('The complete list — anything left out is removed.'),
        outSnippetId: z
          .string()
          .nullable()
          .optional()
          .describe('Which snippet flows downstream, or null for none.'),
      },
    },
    tool(
      context,
      'write',
      async (
        ws,
        args: {
          boardId: string;
          nodeId: string;
          snippets: { id?: string; label: string; lang: string; code: string }[];
          outSnippetId?: string | null;
        },
      ) => {
        const board = safeId(args.boardId);
        const node = safeId(args.nodeId);
        const snippets = cappedList(args.snippets ?? [], MAX_SNIPPETS_PER_NODE, 'Snippets');
        for (const snippet of snippets) capped(snippet.code, MAX_SNIPPET_LENGTH, 'A snippet');
        await context.snapshotOnce(ws, board);

        // Version 2 explicitly: the sidecar reader treats anything else as a v1
        // file and migrates it, which would rewrite what was just sent (v1.3 §5).
        const content = await putData(ws, board, node, {
          version: 2,
          snippets,
          outSnippetId: args.outSnippetId ?? null,
        });
        audit(context, 'set_node_data', `${board}/${node}`);
        return json(content.data);
      },
    ),
  );

  server.registerTool(
    'link_nodes',
    {
      title: 'Link nodes',
      description:
        'Draw edges between nodes on one board, in one call. An edge that already exists is skipped rather than duplicated, so re-running a step is safe. A dashed edge reads as tentative or planned.',
      inputSchema: {
        boardId: boardIdArg,
        edges: z
          .array(
            z.object({
              source: z.string().describe('Node id the edge leaves.'),
              target: z.string().describe('Node id the edge arrives at.'),
              label: z.string().optional(),
              style: z.enum(['solid', 'dashed']).optional().describe('Default "solid".'),
            }),
          )
          .describe(`Up to ${MAX_EDGES_PER_CALL} edges.`),
      },
    },
    tool(
      context,
      'write',
      async (
        ws,
        args: {
          boardId: string;
          edges: { source: string; target: string; label?: string; style?: 'solid' | 'dashed' }[];
        },
      ) => {
        const board = safeId(args.boardId);
        const edges = cappedList(args.edges ?? [], MAX_EDGES_PER_CALL, 'Edges');
        if (!edges.length) throw badRequest('Give me at least one edge to draw.');
        await context.snapshotOnce(ws, board);

        const result = await addEdges(ws, board, edges);
        audit(context, 'link_nodes', `${board} (${result.added.length})`);
        return json({ added: result.added.length, skippedAsDuplicate: result.skipped });
      },
    ),
  );

  /*
   * The two edge-correction tools go beyond v1.7 §3, which had only `link_nodes`.
   * Added because a caller that can only ever draw a line cannot fix one it drew
   * wrong, and "restore the snapshot" is a heavy answer to a typo in a label.
   * They are not a crack in the no-destructive-tools rule: an edge has no file
   * behind it, and the canvas's own save has always dropped edges by omission.
   */
  server.registerTool(
    'unlink_nodes',
    {
      title: 'Remove edges',
      description:
        'Deletes edges by id — get the ids from get_board. Use this to correct a link you drew wrongly. Ids that are not on the board are counted and ignored, so a retry is safe. This removes the arrow only: both nodes and everything written on them stay exactly as they are.',
      inputSchema: {
        boardId: boardIdArg,
        edgeIds: z.array(z.string()).describe('Edge ids, from get_board’s `edges`.'),
      },
    },
    tool(context, 'write', async (ws, args: { boardId: string; edgeIds: string[] }) => {
      const board = safeId(args.boardId);
      const edgeIds = cappedList(args.edgeIds ?? [], MAX_EDGES_PER_CALL, 'Edges');
      if (!edgeIds.length) throw badRequest('Give me at least one edge id to remove.');
      await context.snapshotOnce(ws, board);

      const result = await removeEdges(ws, board, edgeIds);
      audit(context, 'unlink_nodes', `${board} (${result.removed})`);
      return json({ removed: result.removed, notOnBoard: result.notFound });
    }),
  );

  server.registerTool(
    'update_edge',
    {
      title: 'Change an edge',
      description:
        'Changes one edge’s label, style, or which side of a card each end attaches to. An empty label removes it; a "solid" style removes the dashed marking. Anything you leave out is left alone.\n\n' +
        'By default an end follows the cards: the canvas picks the nearest faces every time anything moves, which is right almost always. Pin a side when the diagram needs to read a particular way — a loop that should leave the bottom and return to the left, or a set of arrows that should all enter one face of the same card. Pass "auto" to let an end follow again.',
      inputSchema: {
        boardId: boardIdArg,
        edgeId: z.string().describe('Edge id, from get_board’s `edges`.'),
        label: z.string().optional().describe('Empty string removes the label.'),
        style: z.enum(['solid', 'dashed']).optional(),
        sourceSide: z
          .enum(['top', 'right', 'bottom', 'left', 'auto'])
          .optional()
          .describe('Which face it leaves the source card from. "auto" follows the cards.'),
        targetSide: z
          .enum(['top', 'right', 'bottom', 'left', 'auto'])
          .optional()
          .describe('Which face it arrives at on the target card.'),
        shape: z
          .enum(['curved', 'angled'])
          .optional()
          .describe(
            'How it travels. "angled" runs orthogonally with square corners — one corner when ' +
              'the two faces are on different axes, two when they are on the same one.',
          ),
        bends: z
          .array(z.number())
          .max(4)
          .optional()
          .describe(
            'Where an angled connector bends, one offset per bend in the order it meets them, ' +
              'in canvas units from the source end along the axis that bend slides on. An empty ' +
              'list puts them back where the plain route wants them.',
          ),
      },
    },
    tool(
      context,
      'write',
      async (
        ws,
        args: {
          boardId: string;
          edgeId: string;
          label?: string;
          style?: 'solid' | 'dashed';
          sourceSide?: 'top' | 'right' | 'bottom' | 'left' | 'auto';
          targetSide?: 'top' | 'right' | 'bottom' | 'left' | 'auto';
          shape?: 'curved' | 'angled';
          bends?: number[];
        },
      ) => {
        const board = safeId(args.boardId);
        if (
          args.label === undefined &&
          args.style === undefined &&
          args.sourceSide === undefined &&
          args.targetSide === undefined &&
          args.shape === undefined &&
          args.bends === undefined
        ) {
          throw badRequest('Nothing to change — pass a label, a style, a side or a shape.');
        }
        // "auto" is the word for releasing a pin; null is how the service says it.
        const side = (v?: 'top' | 'right' | 'bottom' | 'left' | 'auto'): EdgeSide | null | undefined =>
          v === undefined ? undefined : v === 'auto' ? null : v;
        await context.snapshotOnce(ws, board);

        const edge = await updateEdge(ws, board, args.edgeId, {
          label: capped(args.label, MAX_TITLE_LENGTH, 'An edge label'),
          style: args.style,
          sourceSide: side(args.sourceSide),
          targetSide: side(args.targetSide),
          shape: args.shape,
          bends: args.bends && args.bends.length === 0 ? null : args.bends,
        });
        audit(context, 'update_edge', `${board}/${edge.id}`);
        return json(edge);
      },
    ),
  );

  server.registerTool(
    'create_frame',
    {
      title: 'Create a frame',
      description:
        'A titled section on the canvas, sized to enclose the nodes you name. Frames are how a map says "these belong together"; they can later be promoted into a sub-board from the app. Give each one a different colour and the bands read apart at a glance — an uncoloured frame falls back to a neutral tint, so a board of them all looks the same.',
      inputSchema: {
        boardId: boardIdArg,
        title: z.string(),
        memberNodeIds: z.array(z.string()).optional().describe('Nodes to enclose. May be empty.'),
        color: z.string().optional().describe(COLOR_HINT),
      },
    },
    tool(
      context,
      'write',
      async (ws, args: { boardId: string; title: string; memberNodeIds?: string[]; color?: string }) => {
        const board = safeId(args.boardId);
        const members = cappedList(args.memberNodeIds ?? [], MAX_NODE_IDS_PER_CALL, 'Frame members');
        await context.snapshotOnce(ws, board);

        const frame = await createFrame(
          ws,
          board,
          capped(args.title, MAX_TITLE_LENGTH, 'A frame title')!,
          members,
          args.color,
        );
        audit(context, 'create_frame', `${board}/${frame.id}`);
        return json({ frameId: frame.id, title: frame.title, members: members.length });
      },
    ),
  );

  server.registerTool(
    'arrange_nodes',
    {
      title: 'Arrange nodes',
      description:
        'Lay nodes out by naming a shape, instead of working out a position for each one. Prefer this over move_nodes: it is one call, it cannot put two cards in the same place, and you do not have to do the arithmetic. Omit nodeIds to arrange the whole board.\n\n' +
        '“flow” is the one to reach for on a process or an architecture: it reads the edges between the nodes you named and puts each one in a layer after everything that feeds it, with a clear lane between layers. That is also what stops arrows running underneath unrelated cards — an edge with nothing in its way needs no dodging. Draw the edges first, then arrange; a flow layout with no edges to read is just a row.\n\n' +
        '“grid” for things that are not connected, “row” and “column” for a handful, “circle” for a cycle or a set of peers. “align” and “distribute” are the tidy-ups: they keep the layout you have and only straighten it.\n\n' +
        'Frames are not positioned — each refits around what it contains, so arranging the members moves the box. On graph boards the force simulation will move everything again, so this is for map boards.',
      inputSchema: {
        boardId: boardIdArg,
        layout: z
          .enum(['flow', 'grid', 'row', 'column', 'circle', 'align', 'distribute'])
          .describe('The shape to lay them out in.'),
        nodeIds: z
          .array(z.string())
          .optional()
          .describe(`The nodes to move. Omit for every node on the board. Up to ${MAX_NODE_IDS_PER_CALL}.`),
        direction: z
          .enum(['right', 'down'])
          .optional()
          .describe('flow only: which way the process runs. Defaults to right.'),
        columns: z.number().optional().describe('grid only. Defaults to roughly square.'),
        gap: z
          .object({ x: z.number().optional(), y: z.number().optional() })
          .optional()
          .describe('Space between boxes in canvas units. Defaults to 72 by 64.'),
        align: z
          .enum(['left', 'right', 'top', 'bottom', 'centerX', 'centerY'])
          .optional()
          .describe('align only: the edge to line them up on.'),
        axis: z.enum(['x', 'y']).optional().describe('distribute only: the axis to even the gaps along.'),
      },
    },
    tool(
      context,
      'write',
      async (
        ws,
        args: {
          boardId: string;
          layout: 'flow' | 'grid' | 'row' | 'column' | 'circle' | 'align' | 'distribute';
          nodeIds?: string[];
          direction?: 'right' | 'down';
          columns?: number;
          gap?: { x?: number; y?: number };
          align?: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';
          axis?: 'x' | 'y';
        },
      ) => {
        const board = safeId(args.boardId);
        const ids = args.nodeIds
          ? cappedList(args.nodeIds, MAX_NODE_IDS_PER_CALL, 'Nodes').map((id) => safeId(id))
          : undefined;
        await context.snapshotOnce(ws, board);

        const result = await arrangeNodes(ws, board, ids, {
          layout: args.layout,
          direction: args.direction,
          columns: args.columns,
          gap: args.gap,
          align: args.align,
          axis: args.axis,
        });
        audit(context, 'arrange_nodes', `${board} ${result.layout} (${result.arranged})`);
        return json(result);
      },
    ),
  );

  server.registerTool(
    'move_nodes',
    {
      title: 'Reposition nodes',
      description:
        'Move nodes on a map. Coordinates are canvas units: +x is right, +y is down, and a card is 184 wide by 76 tall, so 248 apart horizontally and 110 vertically leaves a comfortable gap. Frames are not positioned — each one refits around whatever it contains, growing or shrinking, so move the members and the box follows. Use this to lay a board out after building it, or to tidy one that reads badly: an arrow drawn straight across an unrelated card is the usual reason. On graph boards the force simulation will move things again, so it is rarely worth calling there.',
      inputSchema: {
        boardId: boardIdArg,
        nodes: z
          .array(
            z.object({
              nodeId: z.string(),
              position: z.object({ x: z.number(), y: z.number() }),
            }),
          )
          .describe('Each node and where it should end up. Anything you leave out does not move.'),
      },
    },
    tool(
      context,
      'write',
      async (
        ws,
        args: { boardId: string; nodes: { nodeId: string; position: { x: number; y: number } }[] },
      ) => {
        const board = safeId(args.boardId);
        const moves = cappedList(args.nodes ?? [], MAX_NODE_IDS_PER_CALL, 'Nodes');
        if (!moves.length) throw badRequest('Give me at least one node to move.');
        await context.snapshotOnce(ws, board);

        const result = await moveNodes(ws, board, moves);
        audit(context, 'move_nodes', `${board} (${result.moved})`);
        return json({ moved: result.moved, framesRefit: result.framesRefit });
      },
    ),
  );

  /*
   * Text annotations: labels that belong to the canvas rather than to a node.
   * A heading over a band, a caption, an aside. They carry no file, no notes and
   * no edges — which is exactly why they are not nodes with the chrome hidden,
   * and why removing one is a `board.json` edit rather than an archive.
   */
  server.registerTool(
    'create_texts',
    {
      title: 'Add text annotations',
      description:
        'Freestanding labels on the canvas — a heading over a band of nodes, a caption, a note to the reader. They are not nodes: no notes, no status, no edges, and nothing links to them. Use them for the words that describe the map rather than the things on it. Positions are optional and auto-placed below existing content if you leave them out.',
      inputSchema: {
        boardId: boardIdArg,
        texts: z
          .array(
            z.object({
              text: z.string(),
              position: z.object({ x: z.number(), y: z.number() }).optional(),
              size: z.enum(['sm', 'md', 'lg']).optional().describe('Default "md". "lg" reads as a heading.'),
              bold: z.boolean().optional(),
              italic: z.boolean().optional(),
              underline: z.boolean().optional(),
            }),
          )
          .describe(`Up to ${MAX_TEXTS_PER_CALL} annotations.`),
      },
    },
    tool(
      context,
      'write',
      async (
        ws,
        args: {
          boardId: string;
          texts: {
            text: string;
            position?: { x: number; y: number };
            size?: 'sm' | 'md' | 'lg';
            bold?: boolean;
            italic?: boolean;
            underline?: boolean;
          }[];
        },
      ) => {
        const board = safeId(args.boardId);
        const inputs = cappedList(args.texts ?? [], MAX_TEXTS_PER_CALL, 'Annotations');
        if (!inputs.length) throw badRequest('Give me at least one annotation to add.');
        for (const input of inputs) capped(input.text, MAX_TEXT_LENGTH, 'An annotation');
        await context.snapshotOnce(ws, board);

        const created = await createTexts(ws, board, inputs);
        audit(context, 'create_texts', `${board} (${created.length})`);
        return json(created.map((t) => ({ id: t.id, text: t.text })));
      },
    ),
  );

  server.registerTool(
    'update_text',
    {
      title: 'Edit a text annotation',
      description:
        'Changes an annotation’s wording, size, emphasis or position. Ids come from get_board’s `texts`. Anything you leave out is unchanged; a false flag clears that emphasis.',
      inputSchema: {
        boardId: boardIdArg,
        textId: z.string().describe('Annotation id, from get_board’s `texts`.'),
        text: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
        size: z.enum(['sm', 'md', 'lg']).optional(),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        underline: z.boolean().optional(),
      },
    },
    tool(
      context,
      'write',
      async (
        ws,
        args: {
          boardId: string;
          textId: string;
          text?: string;
          position?: { x: number; y: number };
          size?: 'sm' | 'md' | 'lg';
          bold?: boolean;
          italic?: boolean;
          underline?: boolean;
        },
      ) => {
        const board = safeId(args.boardId);
        const { boardId: _b, textId, ...patch } = args;
        if (!Object.values(patch).some((v) => v !== undefined)) {
          throw badRequest('Nothing to change — pass text, position, size or an emphasis flag.');
        }
        await context.snapshotOnce(ws, board);

        const updated = await updateText(ws, board, textId, {
          ...patch,
          text: capped(args.text, MAX_TEXT_LENGTH, 'An annotation'),
        });
        audit(context, 'update_text', `${board}/${updated.id}`);
        return json(updated);
      },
    ),
  );

  server.registerTool(
    'remove_texts',
    {
      title: 'Remove text annotations',
      description:
        'Deletes annotations by id. Ids that are not on the board are counted and ignored, so a retry is safe. Nothing but the label goes — an annotation has no file and nothing points at it.',
      inputSchema: {
        boardId: boardIdArg,
        textIds: z.array(z.string()).describe('Annotation ids, from get_board’s `texts`.'),
      },
    },
    tool(context, 'write', async (ws, args: { boardId: string; textIds: string[] }) => {
      const board = safeId(args.boardId);
      const ids = cappedList(args.textIds ?? [], MAX_TEXTS_PER_CALL, 'Annotations');
      if (!ids.length) throw badRequest('Give me at least one annotation id to remove.');
      await context.snapshotOnce(ws, board);

      const result = await removeTexts(ws, board, ids);
      audit(context, 'remove_texts', `${board} (${result.removed})`);
      return json({ removed: result.removed, notOnBoard: result.notFound });
    }),
  );

  server.registerTool(
    'style_nodes',
    {
      title: 'Set how nodes look',
      description:
        'Colour, shape, size and card style, in one call. Colour is the useful one: it is how a map says two things are the same kind of thing without an edge between them. Size is for a card whose text does not fit, or one you want to read as more important. Call get_config for the palette and the shapes this deployment defines — an unknown value is refused rather than written. A frame containing a resized node refits around it. Anything you leave out is unchanged.',
      inputSchema: {
        boardId: boardIdArg,
        nodes: z
          .array(
            z.object({
              nodeId: z.string(),
              color: z.string().nullable().optional().describe(COLOR_HINT),
              shape: shapeArg.optional(),
              size: z
                .object({ width: z.number(), height: z.number() })
                .optional()
                .describe('Card size in canvas units. Default 184×76; minimum 120×56.'),
              variant: z
                .enum(['card', 'chip'])
                .optional()
                .describe('"chip" is a compact pill, same file behind it. Default "card".'),
              showDescription: z
                .boolean()
                .nullable()
                .optional()
                .describe('Force the description on or off on the card; null returns it to automatic.'),
            }),
          )
          .describe('Each node and what to change about it.'),
      },
    },
    tool(
      context,
      'write',
      async (
        ws,
        args: {
          boardId: string;
          nodes: {
            nodeId: string;
            color?: string | null;
            shape?: 'rect' | 'rounded' | 'ellipse' | 'diamond' | 'pill';
            size?: { width: number; height: number };
            variant?: 'card' | 'chip';
            showDescription?: boolean | null;
          }[];
        },
      ) => {
        const board = safeId(args.boardId);
        const styles = cappedList(args.nodes ?? [], MAX_NODE_IDS_PER_CALL, 'Nodes');
        if (!styles.length) throw badRequest('Give me at least one node to style.');
        await context.snapshotOnce(ws, board);

        const result = await styleNodes(ws, board, styles);
        audit(context, 'style_nodes', `${board} (${result.styled})`);
        return json(result);
      },
    ),
  );

  server.registerTool(
    'update_frame',
    {
      title: 'Retitle, recolour or collapse a frame',
      description:
        'Changes a frame’s title, colour or collapsed state. The box itself is not settable — a frame’s geometry follows its members, so move the nodes and it refits. Distinct colours per frame are what make bands of a large map readable at a glance.',
      inputSchema: {
        boardId: boardIdArg,
        frameId: z.string().describe('Frame id, from get_board’s `frames`.'),
        title: z.string().optional(),
        color: z.string().nullable().optional().describe(COLOR_HINT),
        collapsed: z.boolean().optional().describe('Fold the frame down to its title bar.'),
      },
    },
    tool(
      context,
      'write',
      async (
        ws,
        args: {
          boardId: string;
          frameId: string;
          title?: string;
          color?: string | null;
          collapsed?: boolean;
        },
      ) => {
        const board = safeId(args.boardId);
        if (args.title === undefined && args.color === undefined && args.collapsed === undefined) {
          throw badRequest('Nothing to change — pass a title, a colour or collapsed.');
        }
        await context.snapshotOnce(ws, board);

        const frame = await updateFrame(ws, board, args.frameId, {
          title: capped(args.title, MAX_TITLE_LENGTH, 'A frame title'),
          color: args.color,
          collapsed: args.collapsed,
        });
        audit(context, 'update_frame', `${board}/${frame.id}`);
        return json(frame);
      },
    ),
  );

  server.registerTool(
    'move_to_frame',
    {
      title: 'Move nodes into a frame',
      description:
        'Changes which frame nodes belong to. Pass frameId null to take them out of every frame. The frame grows if it has to in order to cover what it has taken in, and never shrinks.',
      inputSchema: {
        boardId: boardIdArg,
        nodeIds: z.array(z.string()),
        frameId: z.string().nullable().describe('Frame id, or null to remove them from any frame.'),
      },
    },
    tool(
      context,
      'write',
      async (ws, args: { boardId: string; nodeIds: string[]; frameId: string | null }) => {
        const board = safeId(args.boardId);
        const nodeIds = cappedList(args.nodeIds ?? [], MAX_NODE_IDS_PER_CALL, 'Nodes');
        if (!nodeIds.length) throw badRequest('Give me at least one node to move.');
        await context.snapshotOnce(ws, board);

        const moved = await setFrameMembership(ws, board, nodeIds, args.frameId);
        audit(context, 'move_to_frame', `${board} (${moved.length})`);
        return json({ moved: moved.length, frameId: args.frameId });
      },
    ),
  );

  /*
   * ---- folders ----
   *
   * Organising was a person's job through v1.8, on the reading that an agent
   * builds boards and a person arranges them. That held while the only thing an
   * agent could do was add to a shelf it could not see; it stopped holding once
   * an agent could make ten boards in a run and leave every one of them loose.
   *
   * The line still exists — it just moved. Nothing here deletes a folder: a
   * folder holds a person's arrangement, and dropping one silently unfiles
   * everything in it. Same rule as the rest of the toolset — agents create and
   * refine, people destroy.
   */
  server.registerTool(
    'create_folder',
    {
      title: 'Create a folder',
      description:
        'Adds a folder to the shelf. A folder is a label rather than a place — filing a board into one moves nothing on disk and hides it from nothing. Creating one changes no board; use file_boards afterwards. A name already in use is refused rather than duplicated, so re-running a step you are unsure you finished is safe.',
      inputSchema: {
        name: z.string().describe('What the folder is called — this is also how you file into it.'),
        color: z
          .string()
          .nullable()
          .optional()
          .describe(COLOR_HINT),
      },
    },
    tool(context, 'write', async (ws, args: { name: string; color?: string | null }) => {
      const folder = await createFolder(ws, { name: args.name, color: args.color ?? null });
      audit(context, 'create_folder', folder.name);
      return json({ id: folder.id, name: folder.name, color: folder.color ?? null });
    }),
  );

  server.registerTool(
    'update_folder',
    {
      title: 'Rename or recolour a folder',
      description:
        'Changes a folder’s name or colour. Anything you leave out is unchanged. The boards inside are untouched — renaming a folder is not moving anything.',
      inputSchema: {
        folder: z.string().describe('The folder’s name, or its id.'),
        name: z.string().optional().describe('A new name.'),
        color: z.string().nullable().optional().describe(`${COLOR_HINT} null clears it.`),
      },
    },
    tool(
      context,
      'write',
      async (ws, args: { folder: string; name?: string; color?: string | null }) => {
        const patch: { name?: string; color?: string | null } = {};
        if (args.name !== undefined) patch.name = args.name;
        if (args.color !== undefined) patch.color = args.color;
        if (Object.keys(patch).length === 0) {
          throw badRequest('Give me a name or a colour to change.');
        }
        const folder = await updateFolder(ws, args.folder, patch);
        audit(context, 'update_folder', folder.name);
        return json({ id: folder.id, name: folder.name, color: folder.color ?? null });
      },
    ),
  );

  server.registerTool(
    'file_boards',
    {
      title: 'File boards into a folder',
      description:
        'Moves boards into a folder, or out of every folder when `folder` is null. Nothing moves on disk and no board is hidden — a filed board still appears in Recent and All. A board sits in at most one folder, so filing it into a second takes it out of the first. Sub-boards are filed with their parent and should not be filed on their own.',
      inputSchema: {
        boardIds: z.array(z.string()).describe('Board ids, from list_boards.'),
        folder: z
          .string()
          .nullable()
          .describe('The folder’s name (or id), or null to unfile them.'),
      },
    },
    tool(context, 'write', async (ws, args: { boardIds: string[]; folder: string | null }) => {
      const ids = cappedList(args.boardIds ?? [], MAX_BOARDS_PER_CALL, 'Boards');
      if (!ids.length) throw badRequest('Give me at least one board to file.');
      const result = await fileBoards(ws, ids, args.folder ?? null);
      audit(context, 'file_boards', `${result.folder ?? 'unfiled'} (${result.filed.length})`);
      return json({ filed: result.filed.length, folder: result.folder });
    }),
  );
}
