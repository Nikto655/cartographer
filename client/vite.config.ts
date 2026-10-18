import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

/*
 * The About dialog's version and links come from the root package.json, read
 * once at build time, so there is one place to bump a release and one place a
 * fork points at its own source — which the AGPL asks of anyone hosting a
 * modified copy.
 */
const root = JSON.parse(fs.readFileSync(path.resolve(dir, '../package.json'), 'utf8')) as {
  version: string;
  repository?: string | { url?: string };
};
const repository =
  (typeof root.repository === 'string' ? root.repository : root.repository?.url ?? '')
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');

/*
 * The same `.env` the server reads, so `PORT` there moves the proxy with the
 * API instead of leaving it pointed at :3000 — where, on a machine with
 * something else on that port, the sign-in form would post the password to a
 * stranger. A real environment variable still wins, as it does for the server.
 */
const preset = { ...process.env };
try {
  process.loadEnvFile(path.resolve(dir, '../.env'));
  Object.assign(process.env, preset);
} catch {
  /* no .env — run on the real environment */
}
const apiTarget = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(root.version),
    __APP_REPOSITORY__: JSON.stringify(repository),
  },
  resolve: {
    alias: {
      // Use shared sources directly so types + HMR work without a prebuild step.
      '@cartograph/shared': path.resolve(dir, '../packages/shared/src/index.ts'),
      '@': path.resolve(dir, 'src'),
    },
  },
  server: {
    port: 5173,
    /*
     * `/mcp` is proxied as well as `/api`, and that is not a convenience.
     *
     * The API & Agents dialog tells you the endpoint is this page's origin plus
     * `/mcp`, which is exactly true in production, where one server hands out
     * the client bundle and answers the agent. In dev the two halves live on
     * different ports, so without this the dialog states an address that 404s —
     * and it states it to somebody who is about to paste it into a connector.
     * Proxying makes the sentence true in both places instead of making the dev
     * setup an exception a person has to know about.
     */
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/mcp': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
