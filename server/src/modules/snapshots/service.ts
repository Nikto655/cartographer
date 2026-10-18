import type { SnapshotInfo } from '@cartograph/shared';
import { notFound } from '../../core/errors.js';
import { migrateBoardNodeDirs } from '../../core/migrations.js';
import {
  type Workspace,
  copyDir,
  exists,
  listDirs,
  removePath,
  safeTimestamp,
  timestampSlug,
} from '../../core/storage.js';
import { boardExists } from '../boards/index.js';

export async function createSnapshot(ws: Workspace, boardId: string): Promise<SnapshotInfo> {
  if (!(await boardExists(ws, boardId))) throw notFound(`Board not found: ${boardId}`);
  const ts = timestampSlug();
  await copyDir(ws.boardDir(boardId), ws.snapshotDir(boardId, ts));
  return { timestamp: ts, createdAt: new Date().toISOString() };
}

export async function listSnapshots(ws: Workspace, boardId: string): Promise<SnapshotInfo[]> {
  const dirs = await listDirs(ws.snapshotsDir(boardId));
  return dirs
    .map((ts) => ({ timestamp: ts, createdAt: readableTimestamp(ts) }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Restore is itself undoable: current state is snapshotted first (§7.8). */
export async function restoreSnapshot(
  ws: Workspace,
  boardId: string,
  ts: string,
): Promise<{ restored: string; backup: string }> {
  const source = ws.snapshotDir(boardId, safeTimestamp(ts));
  if (!(await exists(source))) throw notFound(`Snapshot not found: ${ts}`);

  const backup = await createSnapshot(ws, boardId);
  await removePath(ws.boardDir(boardId));
  await copyDir(source, ws.boardDir(boardId));
  // A snapshot older than v1.5 holds loose node files; restoring must not put the
  // board back into a layout the rest of the server no longer reads. The backup
  // above is this step's safety net, so no second snapshot is taken.
  await migrateBoardNodeDirs(ws, boardId);

  return { restored: ts, backup: backup.timestamp };
}

function readableTimestamp(ts: string): string {
  // 2026-07-26T14-30-00 → 2026-07-26T14:30:00Z
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/.exec(ts);
  if (!match) return ts;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`;
}
