/** Public surface of the tokens module (v1.7 §2). Siblings import from here only. */
export { tokensRoutes } from './routes.js';
/** What the MCP mount needs to turn a bearer header into a scoped user (§2.3). */
export { resolveToken, touchToken } from './service.js';
export { checkTokenRate } from './rateLimit.js';
