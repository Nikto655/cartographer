/** Public surface of the sharing module (v1.6 §5). Siblings import from here only. */
export { recordShareAccess, sharesRoutes, workspaceAccess } from './routes.js';
/** Who may copy what out of whose workspace — read by the clipboard module (§6.2). */
export { copyableBoardIds } from './service.js';
export { exportableBoardIds } from './service.js';
/** Wired to board renames/archives by the composition root — keeps share rows off freed slugs. */
export { followBoardIdentity } from './service.js';
