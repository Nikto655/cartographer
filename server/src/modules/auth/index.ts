/** Public surface of the auth module. Sibling modules import from here only. */
export { authRoutes } from './routes.js';
export {
  type AccessGrant,
  type AccessMode,
  assertBoardVisible,
  denyMutations,
  enterReadOnly,
  installAuth,
  isBoardVisible,
  requireAuth,
  requireSession,
  requireSuperAdmin,
  restrictToBoards,
  workspaceOf,
  writableWorkspaceOf,
} from './guard.js';
export { bootstrapAdmin, bootstrapAdminId, userCount } from './service.js';
/** User administration (§3) — the users table is this module's to write. */
export {
  createUser,
  getUser,
  killSessions,
  listUsers,
  renameUser,
  resetPassword,
  setDisabled,
  setSuperAdmin,
} from './service.js';
