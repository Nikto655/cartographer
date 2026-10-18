/**
 * Optional `.env`, loaded before anything reads `process.env`.
 *
 * `DATA_DIR` and the bootstrap admin variables are read at module-import time,
 * so the file has to land first — `storage.ts` imports this module ahead of its
 * own constants for that reason. A real environment variable always wins over
 * the file, so `DATA_DIR=… npm run dev` and docker-compose keep working.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// src/core and dist/core sit at the same depth under the repo root.
const candidates = [
  path.resolve(here, '../../../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
];

const preset = { ...process.env };

for (const file of candidates) {
  try {
    process.loadEnvFile(file);
    Object.assign(process.env, preset);
    break;
  } catch {
    /* nothing there — try the next candidate, and run on the real env if none exist */
  }
}
