/**
 * Accounts, client side (v1.6 §2, §8.2). The login screen is the only page an
 * unauthenticated visitor can reach; a temp password reaches only the change
 * screen. Everything past that is the app exactly as it was.
 */
import React, { useState } from 'react';
import { create } from 'zustand';
import { Info, KeyRound, LogOut, Plug } from 'lucide-react';
import type { SessionUser } from '@cartograph/shared';
import { api, setUnauthorizedHandler } from '@/shared/api';
import { navigate, routes, useRoute } from '@/shared/router';
import { useStore } from '@/shared/store';
import { AboutModal } from '@/modules/about';
import { ApiAgentsModal } from '@/modules/tokens';
import { Button, Logo, Menu, MenuItem, MenuSeparator, Modal } from '@/shared/ui';
import { toast } from '@/shared/ui/toast';
import './auth.css';

export type AuthStatus = 'unknown' | 'anonymous' | 'must-change' | 'ready';

interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  /** One call at boot decides login screen vs app. */
  load: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const statusOf = (user: SessionUser): AuthStatus =>
  user.mustChangePassword ? 'must-change' : 'ready';

export const useAuth = create<AuthState>((set) => ({
  status: 'unknown',
  user: null,

  load: async () => {
    try {
      const { user } = await api.me();
      set({ user, status: statusOf(user) });
    } catch {
      set({ user: null, status: 'anonymous' });
    }
  },

  // Throws on bad credentials so the form can say so; nothing else handles it.
  signIn: async (username, password) => {
    const { user } = await api.login(username, password);
    set({ user, status: statusOf(user) });
  },

  signOut: async () => {
    try {
      await api.logout();
    } finally {
      // Leave nothing of the last session on screen behind the login card — and
      // nothing of it in memory: the clipboard names somebody's boards (§6.2).
      useStore.setState({
        summaries: [],
        shared: [],
        board: null,
        nodes: [],
        edges: [],
        links: [],
        clipboard: null,
      });
      navigate(routes.dashboard());
      set({ user: null, status: 'anonymous' });
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    const { user } = await api.changePassword(currentPassword, newPassword);
    set({ user, status: statusOf(user) });
  },
}));

// The session can end between requests (expiry, logout elsewhere, an admin
// disabling the account); a 401 anywhere puts the login screen back up.
setUnauthorizedHandler(() => useAuth.setState({ user: null, status: 'anonymous' }));

// ---- screens ----

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="cg-auth">
      <div className="cg-auth__card panel">
        <div className="cg-auth__brand">
          <Logo size={26} />
          <span className="cg-auth__wordmark">Cartographer</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Where the signed-in user's files actually sit on the volume (v1.6 §4). The
 * Settings tab prints paths a person can go and open, so it has to name the
 * workspace root and not just the board.
 */
export function useWorkspaceRoot(): string {
  const user = useAuth((s) => s.user);
  const route = useRoute();
  // On a board you are viewing rather than owning (§5), the file lives under its
  // owner's root — printing your own there would name a path that doesn't exist.
  const ownerId = route.name === 'board' ? route.ownerId : null;
  const id = ownerId ?? user?.id;
  return id ? `users/${id}/` : '';
}

export function LoginScreen() {
  const signIn = useAuth((s) => s.signIn);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(username, password);
    } catch (err) {
      setError((err as Error).message || 'Could not sign in.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      {/* No signup link: accounts are made by a Super Admin (§3). */}
      <h1 className="cg-auth__title">Sign in</h1>
      <form className="cg-auth__form" onSubmit={(e) => void submit(e)}>
        <label className="cg-auth__field">
          <span className="label">Username</span>
          <input
            className="input"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="cg-auth__field">
          <span className="label">Password</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="cg-auth__error" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          className="cg-auth__submit"
          disabled={busy || !username || !password}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Card>
  );
}

/** The three fields both password paths share — self-service and forced alike. */
function PasswordForm({
  currentLabel,
  submitLabel,
  onDone,
}: {
  currentLabel: string;
  submitLabel: string;
  onDone?: () => void;
}) {
  const changePassword = useAuth((s) => s.changePassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      toast('Password changed · other sessions signed out');
      onDone?.();
    } catch (err) {
      setError((err as Error).message || 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="cg-auth__form" onSubmit={(e) => void submit(e)}>
      <label className="cg-auth__field">
        <span className="label">{currentLabel}</span>
        <input
          className="input"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label className="cg-auth__field">
        <span className="label">New password</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label className="cg-auth__field">
        <span className="label">Repeat new password</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      <p className="cg-auth__hint">At least 8 characters.</p>
      {error && (
        <p className="cg-auth__error" role="alert">
          {error}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        className="cg-auth__submit"
        disabled={busy || !current || !next || !confirm}
      >
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}

/** Temp-password flow: nothing else is reachable until this is done (§2). */
export function ForcedPasswordChange() {
  const signOut = useAuth((s) => s.signOut);
  return (
    <Card>
      <h1 className="cg-auth__title">Choose a password</h1>
      <p className="cg-auth__hint">
        This account was created with a temporary password. Pick your own to continue.
      </p>
      <PasswordForm currentLabel="Temporary password" submitLabel="Set password" />
      <button type="button" className="cg-auth__link" onClick={() => void signOut()}>
        Sign out instead
      </button>
    </Card>
  );
}

/** Profile menu — self-service password change, API tokens, About, and logout (§2). */
export function ProfileMenu() {
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [changing, setChanging] = useState(false);
  const [agents, setAgents] = useState(false);
  const [about, setAbout] = useState(false);
  if (!user) return null;

  return (
    <>
      <button
        type="button"
        className="cg-profile"
        aria-label="Profile menu"
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ x: rect.right - 180, y: rect.bottom + 6 });
        }}
      >
        <span className="cg-profile__mark" aria-hidden>
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
        {user.displayName}
      </button>

      {menu && (
        <Menu anchor={menu} onClose={() => setMenu(null)}>
          <div className="label chrome-menu-label">{user.username}</div>
          <MenuItem
            onClick={() => {
              setMenu(null);
              setAgents(true);
            }}
          >
            <span className="cg-profile__item">
              <Plug size={14} /> API & Agents
            </span>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(null);
              setChanging(true);
            }}
          >
            <span className="cg-profile__item">
              <KeyRound size={14} /> Change password
            </span>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(null);
              setAbout(true);
            }}
          >
            <span className="cg-profile__item">
              <Info size={14} /> About
            </span>
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              setMenu(null);
              void signOut();
            }}
          >
            <span className="cg-profile__item">
              <LogOut size={14} /> Sign out
            </span>
          </MenuItem>
        </Menu>
      )}

      {agents && <ApiAgentsModal onClose={() => setAgents(false)} />}
      {about && <AboutModal onClose={() => setAbout(false)} />}

      {changing && (
        <Modal title="Change password" width={340} onClose={() => setChanging(false)}>
          <PasswordForm
            currentLabel="Current password"
            submitLabel="Change password"
            onDone={() => setChanging(false)}
          />
        </Modal>
      )}
    </>
  );
}
