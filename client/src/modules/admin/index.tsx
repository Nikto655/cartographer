/**
 * Admin View, client side (v1.6 §3). A Super Admin can see the roster and every
 * other user's boards, but only ever read-only — no other account's canvas is
 * ever editable from here (that guarantee lives on the server; this module just
 * doesn't offer a way to write).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { ShieldCheck, Trash2 } from 'lucide-react';
import type { AdminUser, BoardSummary, ShelvedBoard, TempPasswordResponse } from '@cartograph/shared';
import { api } from '@/shared/api';
import { navigate, routes } from '@/shared/router';
import { useAuth } from '@/modules/auth';
import { relativeTime, readLocal, writeLocal } from '@/shared/hooks';
import { Button, Chip, Menu, MenuItem, MenuSeparator, Modal } from '@/shared/ui';
import { toast } from '@/shared/ui/toast';
import './admin.css';

const STORAGE_KEY = 'cartograph.adminView';

interface AdminViewState {
  on: boolean;
  toggle: () => void;
}

/** Whether the panel is showing — a preference, not a permission (the server owns that). */
export const useAdminView = create<AdminViewState>((set, get) => ({
  on: readLocal(STORAGE_KEY, false),
  toggle: () => {
    const next = !get().on;
    writeLocal(STORAGE_KEY, next);
    set({ on: next });
  },
}));

/** Header switch. Nothing renders here unless the session is a Super Admin's. */
export function AdminToggle() {
  const user = useAuth((s) => s.user);
  const on = useAdminView((s) => s.on);
  const toggle = useAdminView((s) => s.toggle);
  if (!user?.isSuperAdmin) return null;

  return (
    <Button
      variant="ghost"
      active={on}
      onClick={toggle}
      aria-pressed={on}
      data-testid="admin-view-toggle"
    >
      <ShieldCheck size={14} /> Admin View
    </Button>
  );
}

function statusLabel(u: AdminUser): string {
  if (u.isDisabled) return 'Disabled';
  if (u.mustChangePassword) return 'Temp password';
  return 'Active';
}

function statusKind(u: AdminUser): 'active' | 'disabled' | 'temp' {
  if (u.isDisabled) return 'disabled';
  if (u.mustChangePassword) return 'temp';
  return 'active';
}

/** Add-user form → on success, the same dialog turns into the temp-password panel. */
function AddUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (data: TempPasswordResponse) => void;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const data = await api.adminCreateUser(username.trim(), displayName.trim());
      onCreated(data);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add user" width={340} onClose={onClose}>
      <form className="cg-admin__form" onSubmit={(e) => void submit(e)}>
        <label className="cg-admin__field">
          <span className="label">Username</span>
          <input
            className="input"
            autoFocus
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="cg-admin__field">
          <span className="label">Display name</span>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <Button
          type="submit"
          variant="primary"
          className="cg-admin__submit"
          disabled={busy || !username.trim() || !displayName.trim()}
        >
          {busy ? 'Creating…' : 'Create user'}
        </Button>
      </form>
    </Modal>
  );
}

/**
 * Rename an account. A modal rather than inline editing, because the row itself
 * is a click target that expands the person's board list.
 */
function RenameUser({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [busy, setBusy] = useState(false);

  const dirty = username.trim() !== user.username || displayName.trim() !== user.displayName;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    try {
      await api.adminRenameUser(user.id, username.trim(), displayName.trim());
      toast('User renamed');
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Rename “${user.displayName}”`} width={340} onClose={onClose}>
      <form className="cg-admin__form" onSubmit={(e) => void submit(e)}>
        <label className="cg-admin__field">
          <span className="label">Username</span>
          <input
            className="input"
            autoFocus
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="cg-admin__field">
          <span className="label">Display name</span>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <p className="cg-admin__hint">
          They sign in with the new username. Their maps and current sessions are unaffected.
        </p>
        <Button
          type="submit"
          variant="primary"
          className="cg-admin__submit"
          disabled={busy || !dirty || !username.trim()}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Modal>
  );
}

/** Shown exactly once, for a new account or a reset alike — there is no second look. */
function TempPasswordModal({ data, onClose }: { data: TempPasswordResponse; onClose: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.tempPassword);
      toast('Copied to clipboard');
    } catch {
      toast('Clipboard blocked — copy it by hand');
    }
  };

  return (
    <Modal
      title="Temporary password"
      width={340}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="cg-admin__temp-intro">
        For <strong>{data.user.displayName}</strong> <span className="mono muted">@{data.user.username}</span>
      </p>
      <div className="cg-admin__temp-password mono" data-testid="temp-password">
        {data.tempPassword}
      </div>
      <Button className="cg-admin__copy" onClick={() => void copy()}>
        Copy to clipboard
      </Button>
      <p className="cg-admin__temp-warning">
        Shown once — it cannot be retrieved again. Share it with the user now, or reset the password later.
      </p>
    </Modal>
  );
}

type PanelModal =
  | { kind: 'add' }
  | { kind: 'temp'; data: TempPasswordResponse }
  | { kind: 'rename'; user: AdminUser };

/** The panel itself — roster, per-user actions, and a peek at someone else's boards. */
export function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [boardsByUser, setBoardsByUser] = useState<Record<string, BoardSummary[]>>({});
  const [boardsLoading, setBoardsLoading] = useState<string | null>(null);
  /**
   * Boards their owner deleted from the Archive (v1.9). Only this panel can see
   * them — nothing in the owner's own API surface reads `deleted/`.
   */
  const [deletedByUser, setDeletedByUser] = useState<Record<string, ShelvedBoard[]>>({});
  const [purging, setPurging] = useState<{ userId: string; board: ShelvedBoard } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [modal, setModal] = useState<PanelModal | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await api.adminUsers());
    } catch (err) {
      toast((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleExpand = (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (boardsByUser[id]) return;
    setBoardsLoading(id);
    api
      .adminUserBoards(id)
      .then((boards) => setBoardsByUser((prev) => ({ ...prev, [id]: boards })))
      .catch((err) => toast((err as Error).message))
      .finally(() => setBoardsLoading(null));
    // Fetched alongside, not on demand: an admin opening a person's row is
    // usually answering "where did their board go", and a section that only
    // appears after a second click is one nobody finds.
    api
      .adminDeletedBoards(id)
      .then((deleted) => setDeletedByUser((prev) => ({ ...prev, [id]: deleted })))
      .catch(() => setDeletedByUser((prev) => ({ ...prev, [id]: [] })));
  };

  /** The only call in the app that destroys anything. */
  const purge = async (userId: string, board: ShelvedBoard) => {
    setPurging(null);
    try {
      await api.adminPurgeBoard(userId, board.entry);
      setDeletedByUser((prev) => ({
        ...prev,
        [userId]: (prev[userId] ?? []).filter((b) => b.entry !== board.entry),
      }));
      toast(`“${board.name}” permanently deleted`);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  // Every mutating action follows the same shape: call, reload the roster, say what happened.
  const act = async (run: () => Promise<unknown>, successMsg: string) => {
    try {
      await run();
      toast(successMsg);
      await load();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const resetPassword = async (target: AdminUser) => {
    try {
      const data = await api.adminResetPassword(target.id);
      setModal({ kind: 'temp', data });
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const menuTarget = rowMenu ? users.find((u) => u.id === rowMenu.id) : undefined;

  return (
    <section className="cg-admin" data-testid="admin-panel">
      <div className="cg-admin__head">
        <h2 className="cg-admin__title">Users</h2>
        <div className="spacer" />
        <Button variant="primary" onClick={() => setModal({ kind: 'add' })}>
          Add user
        </Button>
      </div>

      {users.length === 0 ? (
        <p className="cg-admin__empty muted">No users yet.</p>
      ) : (
        <div className="cg-admin__list">
          {users.map((u) => {
            const boards = boardsByUser[u.id];
            const isOpen = expanded === u.id;
            return (
              <div key={u.id} className="cg-admin__row-group">
                <div
                  className={`cg-admin__row${isOpen ? ' cg-admin__row--open' : ''}`}
                  data-testid="admin-user-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpand(u.id)}
                  onKeyDown={(e) => e.key === 'Enter' && toggleExpand(u.id)}
                >
                  <div className="cg-admin__identity">
                    <span className="cg-admin__name">{u.displayName}</span>
                    <span className="cg-admin__username mono muted">@{u.username}</span>
                  </div>
                  <span className={`cg-admin__status cg-admin__status--${statusKind(u)}`}>
                    {statusLabel(u)}
                  </span>
                  {u.isSuperAdmin && <Chip>Super Admin</Chip>}
                  {/*
                   * Last seen is the newest live session's touch, so it says
                   * "signed out" rather than "never" once the last session ends
                   * — sessions are the only place the fact is recorded (§1).
                   */}
                  <span
                    className="cg-admin__seen label"
                    title={u.lastSeenAt ? 'Last activity on a current session' : 'No current session'}
                  >
                    {u.lastSeenAt ? relativeTime(u.lastSeenAt) : 'signed out'}
                  </span>
                  <button
                    type="button"
                    className="cg-admin__more"
                    aria-label="User actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = (e.target as HTMLElement).getBoundingClientRect();
                      setRowMenu({ id: u.id, x: rect.left - 160, y: rect.bottom + 6 });
                    }}
                  >
                    ⋯
                  </button>
                </div>

                {isOpen && (
                  <div className="cg-admin__boards">
                    {boardsLoading === u.id && <p className="label">Loading…</p>}
                    {boards && boards.length === 0 && <p className="cg-admin__empty muted">No boards yet.</p>}
                    {boards && boards.length > 0 && (
                      <>
                        <p className="cg-admin__boards-hint label">Read-only — opens in the viewer</p>
                        {boards.map((b) => (
                          <div
                            key={b.id}
                            className="cg-admin__board"
                            role="button"
                            tabIndex={0}
                            onClick={() => navigate(routes.userBoard(u.id, b.id))}
                            onKeyDown={(e) => e.key === 'Enter' && navigate(routes.userBoard(u.id, b.id))}
                          >
                            <span className="cg-admin__board-name">{b.name}</span>
                            <span className="cg-admin__board-meta mono label">
                              {b.nodeCount} node{b.nodeCount === 1 ? '' : 's'} · {relativeTime(b.updatedAt)}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                    {(deletedByUser[u.id]?.length ?? 0) > 0 && (
                      <div className="cg-admin__deleted">
                        {/* Named for what it is from the owner's side. They
                            deleted it; this is the only place it still exists. */}
                        <p className="cg-admin__boards-hint label">
                          Deleted by {u.displayName} — kept, and only removable here
                        </p>
                        {deletedByUser[u.id]!.map((b) => (
                          <div key={b.entry} className="cg-admin__board cg-admin__board--deleted">
                            <span className="cg-admin__board-name">{b.name}</span>
                            <span className="cg-admin__board-meta mono label">
                              {b.nodeCount} node{b.nodeCount === 1 ? '' : 's'} · deleted{' '}
                              {relativeTime(b.shelvedAt)}
                            </span>
                            <div className="spacer" />
                            <Button
                              variant="ghost"
                              className="cg-admin__purge"
                              aria-label={`Permanently delete ${b.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPurging({ userId: u.id, board: b });
                              }}
                            >
                              <Trash2 size={13} /> Delete for good
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rowMenu && menuTarget && (
        <Menu anchor={{ x: rowMenu.x, y: rowMenu.y }} onClose={() => setRowMenu(null)}>
          <MenuItem
            onClick={() => {
              setRowMenu(null);
              setModal({ kind: 'rename', user: menuTarget });
            }}
          >
            Rename…
          </MenuItem>
          <MenuItem
            onClick={() => {
              setRowMenu(null);
              void resetPassword(menuTarget);
            }}
          >
            Reset password
          </MenuItem>
          <MenuItem
            onClick={() => {
              setRowMenu(null);
              void act(
                () => api.adminSetDisabled(menuTarget.id, !menuTarget.isDisabled),
                menuTarget.isDisabled ? 'User enabled' : 'User disabled',
              );
            }}
          >
            {menuTarget.isDisabled ? 'Enable' : 'Disable'}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              setRowMenu(null);
              void act(
                () => api.adminSetSuperAdmin(menuTarget.id, !menuTarget.isSuperAdmin),
                menuTarget.isSuperAdmin ? 'Super Admin revoked' : 'Super Admin granted',
              );
            }}
          >
            {menuTarget.isSuperAdmin ? 'Revoke Super Admin' : 'Grant Super Admin'}
          </MenuItem>
        </Menu>
      )}

      {purging && (
        <Modal
          title="Delete for good"
          width={460}
          onClose={() => setPurging(null)}
          footer={
            <>
              <div className="spacer" />
              <Button onClick={() => setPurging(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => void purge(purging.userId, purging.board)}>
                Delete permanently
              </Button>
            </>
          }
        >
          {/*
            * The one confirmation in this app that is telling the truth when it
            * says forever. Everything else here moves files; this removes them,
            * and there is no archive behind the archive.
            */}
          <p className="cg-admin__confirm">
            <strong>{purging.board.name}</strong> and its {purging.board.nodeCount} node
            {purging.board.nodeCount === 1 ? '' : 's'} will be removed from disk. This cannot be
            undone by you, by its owner, or by restoring a snapshot — the snapshots go with it.
          </p>
        </Modal>
      )}

      {modal?.kind === 'add' && (
        <AddUserModal onClose={() => setModal(null)} onCreated={(data) => setModal({ kind: 'temp', data })} />
      )}
      {modal?.kind === 'rename' && (
        <RenameUser
          user={modal.user}
          onClose={() => setModal(null)}
          onSaved={() => void load()}
        />
      )}
      {modal?.kind === 'temp' && (
        <TempPasswordModal
          data={modal.data}
          onClose={() => {
            setModal(null);
            void load();
          }}
        />
      )}
    </section>
  );
}
