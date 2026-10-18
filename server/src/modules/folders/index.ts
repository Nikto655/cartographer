/** Public surface of the folders module (v1.8 §1). Siblings import from here only. */
export { foldersRoutes } from './routes.js';
/** What `boards.listBoards` and the MCP `list_boards` reply merge from (§7). */
export { readFolders, writeFolders } from './service.js';
/**
 * Per-folder operations, for callers that hold no arrangement of their own —
 * the MCP tools. The browser keeps using `writeFolders`, which is the shape it
 * already has on screen.
 */
export { createFolder, fileBoards, updateFolder } from './service.js';
/** Subscribed at the composition root — folders key on ids, and ids move. */
export { followBoardRename } from './service.js';
export type { FiledBoards, FolderPatch, NewFolderInput } from './service.js';
