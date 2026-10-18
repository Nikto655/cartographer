// ---- Board graph ----
export type NodeShape = 'rect' | 'rounded' | 'ellipse' | 'diamond' | 'pill';
export type NodeStatus = string; // 'sketched' | 'documented' | 'built' by default; extendable via config

export type NodeVariant = 'card' | 'chip';

export interface BoardNode {
  id: string;                 // matches nodes/{id}/
  type: string;               // node type within the board's world; hydrated to the world default
  title: string;              // mirrored in frontmatter; board.json is display cache
  position: { x: number; y: number };
  size: { width: number; height: number };
  shape: NodeShape;
  color?: string;             // token name from theme, not raw hex
  status: NodeStatus;         // mirrored in frontmatter
  /** @deprecated single-child form; read for migration, never written again. */
  childBoard?: string;
  childBoards?: string[];     // board ids — a non-empty list makes this a drill-down node
  variant?: NodeVariant;      // default 'card'; chip = compact pill, same file backing
  frameId?: string;           // membership in a frame, set by containment
  showDescription?: boolean;  // presentation only; absent = show when a description exists
  /** Set when an agent created this node over MCP (v1.7 §4). Absent = a person drew it. */
  createdVia?: 'mcp';
  /** Which token made it and when — the glyph's hover text. Only ever set with `createdVia`. */
  createdBy?: { token: string; at: string };
  description?: string;       // server-computed from frontmatter; never stored in board.json
  tags?: string[];            // server-computed from frontmatter; colour groups read them (§3.2)
  hasData?: boolean;          // server-computed: sidecar exists with content
  passesData?: boolean;       // server-computed: sidecar marks an output snippet
  coverage?: 'empty' | 'written';  // server-computed: body has real content
}

export type EdgeStyle = 'solid' | 'dashed';

/**
 * How a connector travels between its two ends (v1.11).
 *
 * `curved` is the bezier every connector has always been. `angled` is an
 * orthogonal run with square corners: how many corners depends entirely on the
 * faces, which is why this is one flag and not a count. Ends on different axes
 * (leaves right, arrives top) need a single corner; ends on the same axis need
 * two, and the segment between them is the shoulder.
 */
export type EdgeShape = 'curved' | 'angled';

/** Which face of a card a connector leaves from or arrives at. */
export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';

export interface BoardEdge {
  id: string;
  source: string;             // node id
  target: string;             // node id
  label?: string;
  style?: EdgeStyle;          // default 'solid'; dashed = tentative/planned
  shape?: EdgeShape;          // default 'curved'
  /**
   * Where an angled connector's bends sit: one offset each, in the order the
   * connector meets them, measured in canvas units from the source end along
   * the axis that bend slides on.
   *
   * Offsets rather than fractions, because a fraction has ends and ends become
   * limits — and a bend should be draggable anywhere. Measuring from the source
   * means the shape travels with the card it hangs off, and nothing has to be
   * re-derived when the other one moves. Absent, or short, means the remaining
   * bends sit wherever the plainest route puts them.
   */
  bends?: number[];
  /**
   * Pin an end to one face instead of letting it follow the nodes (v1.10).
   *
   * Unset — the ordinary case — means the canvas picks the pair of faces from
   * where the two cards currently are, so a connector slides around a node as it
   * moves and always takes the short way across. That is right almost always,
   * and wrong exactly when the author wanted a diagram to read a particular way:
   * a loop that should leave the bottom and come back to the left, a rail of
   * arrows that should all enter one edge of a card.
   *
   * Set on one end and only that end is pinned; the other keeps following.
   */
  sourceSide?: EdgeSide;
  targetSide?: EdgeSide;
}

/** Sections on the canvas. No file behind them — board.json only. */
export interface BoardFrame {
  id: string;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  color?: string;             // palette token; rendered as 30% tint
  collapsed?: boolean;
}

/** Freestanding canvas annotation. No file, no editor panel. */
export interface BoardText {
  id: string;
  text: string;
  position: { x: number; y: number };
  size: 'sm' | 'md' | 'lg';
  /**
   * How wide the box was dragged, in canvas units. Absent means "as wide as the
   * words need", which is how every text behaved before this existed and still
   * how one behaves until someone drags it. Height is never stored: the text
   * decides that, and a stored height could only ever disagree with it.
   */
  width?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** The world a board lives in: which canvas, which node types. */
export type BoardType = 'map' | 'graph';

/**
 * One `[[…]]` occurrence in a note (v1.5 §4.1). `targetId` is null when nothing
 * matched, when two nodes share the title, or for reserved `[[board/node]]`
 * syntax. Never stored — files are truth, so these are recomputed on every read.
 */
export interface BoardLink {
  sourceId: string;           // node whose notes contain the link
  targetTitle: string;        // exactly what was written between the brackets
  targetId: string | null;
}

/** Something the board can tell you about itself that is not an error. */
export interface BoardWarning {
  code: string;               // 'ambiguous-link' today
  message: string;
}

/** Where a duplicated tree came from (v1.6 §5). Informational badge only. */
export interface DuplicatedFrom {
  ownerName: string;
  boardName: string;
  date: string;               // YYYY-MM-DD
}

export interface Board {
  id: string;
  name: string;
  boardType: BoardType;       // hydrated to 'map' when absent in stored JSON
  parentBoard?: string;       // set on sub-boards; enables breadcrumbs + dashboard nesting
  parentNode?: string;        // node in the parent board that owns this board
  duplicatedFrom?: DuplicatedFrom;  // set once, on a copy taken from a shared board
  viewport?: { x: number; y: number; zoom: number };
  nodes: BoardNode[];
  edges: BoardEdge[];
  frames: BoardFrame[];       // hydrated to [] when absent in stored JSON
  texts: BoardText[];         // hydrated to [] when absent in stored JSON
  links?: BoardLink[];        // server-computed from the notes; never stored
  warnings?: BoardWarning[];  // server-computed; absent when there is nothing to say
  createdAt: string;
  updatedAt: string;
}

// ---- Dashboard ----
export interface BoardSummary {
  id: string;
  name: string;
  boardType: BoardType;       // hydrated to 'map' when absent, as on the board itself
  parentBoard?: string;
  nodeCount: number;
  statusCounts: Record<NodeStatus, number>;
  updatedAt: string;
  // Both merged by the server from the owner's `folders.json` during the scan
  // (v1.8 §7). They are organisation, not board content, so they are never
  // written back into `board.json` — same rule as `hasData` and `coverage`.
  folderId?: string;
  favorite?: boolean;
}

// ---- Node content ----
export interface NodeFrontmatter extends Record<string, unknown> {
  id: string;
  title: string;
  created: string;
  status: NodeStatus;
  tags: string[];
  description?: string;       // one/two-sentence summary, optional
  type?: string;              // node type; absent = the board world's default
}

export interface NodeContent {
  frontmatter: NodeFrontmatter;
  body: string;               // markdown after frontmatter
  data: NodeData | null;
  incoming: IncomingData[];   // computed from the graph, never stored
}

/** Sidecar schema v2: labeled snippets, at most one marked as the output. */
export interface DataSnippet {
  id: string;
  label: string;
  lang: string;
  code: string;
}

export interface NodeData {
  version: 2;
  snippets: DataSnippet[];
  outSnippetId?: string | null;
}

/** What flows in, derived from upstream nodes' marked output snippets. */
export interface IncomingData {
  edgeId: string;
  sourceId: string;
  sourceTitle: string;
  snippet: DataSnippet;
}

// ---- v1 sidecar, read for migration only (§7.1) ----
export interface LegacyNodeSnippet {
  lang: string;
  title?: string;
  code: string;
}

export interface LegacyNodeData {
  version?: undefined;
  out?: Record<string, unknown>;
  in?: Record<string, unknown>;
  snippets?: LegacyNodeSnippet[];
}

// ---- Config (from /data/config.json, server provides defaults) ----
export interface StatusDef {
  id: string;
  label: string;
  colorToken: string;
}

export interface NodeColorDef {
  id: string;
  label: string;
  token: string;
}

export interface AppConfig {
  statuses: StatusDef[];
  shapes: NodeShape[];
  colors: NodeColorDef[];
  theme: 'dark' | 'light';
}

// ---- API payloads ----
/** A node as the canvas sends it back: `type` is server-owned, so it may be omitted. */
export type GraphNodeInput = Omit<BoardNode, 'type'> & { type?: string };

export interface GraphPayload {
  /**
   * The `updatedAt` this graph was built from. When present the server refuses
   * the write if the board has moved on since — the canvas holds a whole copy of
   * the board and sends it back entire, so a save built on a stale read does not
   * merge, it replaces. Absent means "no opinion", which is what every non-canvas
   * caller wants: an agent adding one node has no base to speak of.
   */
  baseUpdatedAt?: string;
  nodes: GraphNodeInput[];
  edges: BoardEdge[];
  frames?: BoardFrame[];      // absent = treated as [] (mid-migration clients)
  texts?: BoardText[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface PromoteFrameResult {
  board: Board;               // updated parent
  childBoardId: string;
}

// ---- Clipboard (v1.6 §6) ----

/**
 * What a duplicate or a paste acts on: ids exactly as the canvas knows them.
 * Texts are not in it — they carry no file and no edge, so nothing about them
 * needs the server.
 */
export interface ClipboardSelection {
  nodeIds: string[];
  frameIds: string[];
}

/**
 * The client-held clipboard reference (§6.2), sent back on paste. `sourceOwnerId`
 * is absent for your own board and set for one shared with you — the server has
 * to know whose workspace to read before it can check whether you may.
 */
export interface PastePayload extends ClipboardSelection {
  sourceBoardId: string;
  sourceOwnerId?: string;
  /** Flow coordinates the pasted group is centred on — the client's viewport. */
  position: { x: number; y: number };
}

/**
 * The board as it now stands plus what the canvas should select. The whole board
 * comes back rather than a patch: a copy touches nodes, frames and edges at once,
 * and re-deriving them client-side is how the two halves drift apart.
 */
export interface CopyResult {
  board: Board;
  nodeIds: string[];
  frameIds: string[];
}

export interface CreateBoardPayload {
  name: string;
  boardType?: BoardType;      // absent = 'map'
  parentBoard?: string;
  parentNode?: string;
}

export interface CreateNodePayload {
  title: string;
  position: { x: number; y: number };
  shape?: NodeShape;
  size?: { width: number; height: number };
}

export interface PatchNodePayload {
  title?: string;
  status?: NodeStatus;
  tags?: string[];
  description?: string;
}

export interface ExportPayload {
  nodeIds: string[];
  descend?: boolean;
  title?: string;
}

export interface ExportResult {
  filename: string;
  markdown: string;
}

export interface SnapshotInfo {
  timestamp: string;
  createdAt: string;
}

export interface ApiError {
  error: { code: string; message: string };
}

// ---- Accounts (v1.6 §2) ----

/** The signed-in user as the client sees them. Never carries the password hash. */
export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  isSuperAdmin: boolean;
  /** Set on a bootstrap or admin-issued password; the client forces a change first. */
  mustChangePassword: boolean;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface SessionResponse {
  user: SessionUser;
}

// ---- Admin View (v1.6 §3) ----

/** A user as the Admin View lists them. Never carries the password hash. */
export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  isSuperAdmin: boolean;
  isDisabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  /** Most recent session activity, or null for an account that never signed in. */
  lastSeenAt: string | null;
}

/**
 * The one and only time a temp password is returned (§3). It is never stored in
 * plain text, never logged, and no route hands it out again — a lost one is
 * reset, not recovered.
 */
export interface TempPasswordResponse {
  user: AdminUser;
  tempPassword: string;
}

export interface CreateUserPayload {
  username: string;
  displayName: string;
}

// ---- Sharing (v1.6 §5) ----

/** One person a board is shared with, as its owner sees them. */
export interface ShareRecipient {
  userId: string;
  username: string;
  displayName: string;
  canDuplicate: boolean;
  includeChildren: boolean;
  /** May they download the board as markdown (§5). Off unless the owner says so. */
  canExport: boolean;
  sharedAt: string;
  /** When they last opened it. Absent means they never have. */
  lastAccessedAt?: string;
}

/** Somebody who could be shared with — the picker's vocabulary, nothing more. */
export interface ShareCandidate {
  id: string;
  username: string;
  displayName: string;
  /**
   * Present only for Super Admins. The dialog keeps them out of the standing
   * list and surfaces them only once you type their name — an admin account is
   * a role rather than a colleague, and offering it first in a list of people to
   * share with invites a share nobody meant. Absent (rather than `false`) for
   * everyone else, so the wire stays quiet about the ordinary case.
   */
  isSuperAdmin?: boolean;
}

/**
 * Everything the share dialog needs in one read: who it is shared with now, and
 * who else there is to share it with.
 */
export interface BoardShares {
  shares: ShareRecipient[];
  candidates: ShareCandidate[];
}

export interface CreateSharePayload {
  userId: string;
  canDuplicate?: boolean;
  /** Absent = include them, which is how sharing behaved before it was a choice. */
  includeChildren?: boolean;
  /**
   * Absent = withhold it. The opposite default to `includeChildren`, and
   * deliberately: reading a board on screen and walking away with every node as
   * files are different permissions, and the one that leaves the workspace is
   * the one that has to be asked for.
   */
  canExport?: boolean;
}

/**
 * A board shared *to* you. The summary fields describe the shared board itself;
 * `boardIds` is its whole sub-board tree, which is what the share covers (§5) —
 * the viewer uses it to tell "a board I am allowed to be on" from a stray URL.
 */
export interface SharedBoardSummary extends BoardSummary {
  ownerId: string;
  ownerName: string;
  sharedAt: string;
  canDuplicate: boolean;
  includeChildren: boolean;
  canExport: boolean;
  boardIds: string[];
  // Direct children only, so a shared card counts sub-boards the same way an
  // owned one does — the recipient has no board list of their own to derive it.
  subBoardCount: number;
}

// ---- Personal access tokens (v1.7 §2) ----

/** Read-only or read-write; a write tool on a read token is refused (§2.3). */
export type TokenScope = 'read' | 'write';

/** A token as its owner sees it. The secret is never in here — see CreatedToken. */
export interface ApiToken {
  id: string;
  name: string;
  scope: TokenScope;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreateTokenPayload {
  name: string;
  scope: TokenScope;
}

/** The one and only time the secret is returned (§2.2), like TempPasswordResponse. */
export interface CreatedToken {
  token: ApiToken;
  secret: string;
}

// ---- Folders (v1.8 §1) ----

/**
 * Organisation metadata, not a storage location: board directories never move,
 * membership is a mapping. Flat in v1.8 — no folder holds another.
 */
export interface Folder {
  id: string;
  name: string;
  /** Palette token, as everywhere else — not a raw colour. */
  color?: string;
  order: number;
}

/** The whole of one user's organisation metadata. One small file, read and written whole. */
export interface FoldersFile {
  folders: Folder[];
  /** boardId → folderId. One folder per board (§1). */
  assignments: Record<string, string>;
  favorites: string[];
}

/**
 * A board that is no longer on the shelf (v1.9). One shape for both resting
 * places, because the difference is *where it is*, not what it looks like.
 *
 * `entry` is the directory name under `archive/boards/` or `deleted/boards/` —
 * it carries a timestamp suffix when a slug was reused, so it is the only
 * unambiguous handle. `id` is the board's own slug and is what it would be
 * restored as, which is not the same thing and may already be taken again.
 */
export interface ShelvedBoard {
  entry: string;
  id: string;
  name: string;
  boardType: BoardType;
  nodeCount: number;
  /** When the board itself was last written, not when it was shelved. */
  updatedAt: string;
  /**
   * When it landed where it is now — archived, or deleted. This is what the
   * Archive tab sorts and shows: on that page "newest" means most recently
   * archived, and a board edited last year but archived this morning belongs at
   * the top. Stamped on the move; for anything shelved before that existed it
   * falls back to the directory's ctime, and finally to `updatedAt`.
   */
  shelvedAt: string;
  /** Only on a board a Super Admin is looking at — whose it was. */
  ownerId?: string;
  ownerName?: string;
}
