/**
 * API & Agents (v1.7 §2.2) — personal access tokens, and everything needed to
 * point an MCP client at this instance. A token carries no permission of its
 * own: it resolves to its owner, and the workspace scoping from v1.6 decides
 * the rest. That is why this dialog is about the account, never about a board.
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { ApiToken, CreatedToken, TokenScope } from '@cartograph/shared';
import { api } from '@/shared/api';
import { relativeTime } from '@/shared/hooks';
import { Button, Chip, Modal } from '@/shared/ui';
import { toast } from '@/shared/ui/toast';
import './tokens.css';

const SCOPES: { id: TokenScope; label: string; hint: string }[] = [
  { id: 'read', label: 'Read-only', hint: 'List, read and export your boards.' },
  { id: 'write', label: 'Read & write', hint: 'Also create boards, nodes, links and notes.' },
];

/** Same idiom as the admin temp password: a blocked clipboard is a fact, not a failure. */
async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Clipboard blocked — copy it by hand');
  }
}

/**
 * Every snippet carries a stand-in rather than the real secret: this block is on
 * screen long after the one-time panel is gone, so it must never be the thing
 * that shows a token.
 */
const SECRET_PLACEHOLDER = 'cart_…';

/**
 * Two ways in, and which one a client needs is not a preference — it is what the
 * client can express.
 *
 * **Direct** is the real shape: the client speaks HTTP to this instance and
 * sends the token as a header. Fewer moving parts, nothing to install, and the
 * only one that survives a machine with no Node on it.
 *
 * **Bridge** is for clients whose config can only launch a local command —
 * still the majority. `mcp-remote` runs as that command, speaks the protocol to
 * this instance, and attaches the header the client has no field for. It is a
 * relay, not a different server: same endpoint, same token, same workspace.
 */
type Transport = 'direct' | 'bridge';

interface ClientGuide {
  id: string;
  label: string;
  transport: Transport;
  /** Where the configuration lives, or the command that writes it. */
  where: string;
  language: string;
  snippet: (endpoint: string) => string;
  /** What to do after saving. Clients read these files once, at startup. */
  then: string;
}

const bridgeArgs = (endpoint: string) =>
  ['-y', 'mcp-remote', endpoint, '--header', `Authorization:Bearer ${SECRET_PLACEHOLDER}`];

const GUIDES: ClientGuide[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    transport: 'direct',
    where: 'Run this in your project, or put the JSON below in .mcp.json',
    language: 'bash',
    snippet: (endpoint) =>
      [
        'claude mcp add --transport http cartographer \\',
        `  ${endpoint} \\`,
        `  --header "Authorization: Bearer ${SECRET_PLACEHOLDER}"`,
      ].join('\n'),
    then: 'Check it with /mcp inside Claude Code.',
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    transport: 'bridge',
    where: 'Settings → Developer → Edit Config (claude_desktop_config.json)',
    language: 'json',
    snippet: (endpoint) =>
      JSON.stringify(
        { mcpServers: { cartographer: { command: 'npx', args: bridgeArgs(endpoint) } } },
        null,
        2,
      ),
    then: 'Quit Claude Desktop completely and reopen it — closing the window is not enough.',
  },
  {
    id: 'codex',
    label: 'Codex',
    transport: 'bridge',
    language: 'toml',
    where: '~/.codex/config.toml',
    snippet: (endpoint) =>
      [
        '[mcp_servers.cartographer]',
        'command = "npx"',
        `args = [${bridgeArgs(endpoint)
          .map((a) => `"${a}"`)
          .join(', ')}]`,
      ].join('\n'),
    then: 'Start a new Codex session; the file is read at launch.',
  },
  {
    id: 'other',
    label: 'Anything else',
    transport: 'direct',
    where: 'The shape most clients accept for a remote MCP server',
    language: 'json',
    snippet: (endpoint) =>
      JSON.stringify(
        {
          mcpServers: {
            cartographer: {
              type: 'http',
              url: endpoint,
              headers: { Authorization: `Bearer ${SECRET_PLACEHOLDER}` },
            },
          },
        },
        null,
        2,
      ),
    then: 'If it only accepts a command to run, use the bridge form from the Claude Desktop tab.',
  },
];

function ConnectGuide({ endpoint }: { endpoint: string }) {
  const [clientId, setClientId] = useState(GUIDES[0].id);
  const guide = GUIDES.find((g) => g.id === clientId) ?? GUIDES[0];
  const snippet = guide.snippet(endpoint);

  return (
    <div className="cg-tokens__connect">
      <div className="cg-tokens__endpoint-row">
        <span className="label">MCP endpoint</span>
        <span className="cg-tokens__url mono">{endpoint}</span>
        <Button onClick={() => void copy(endpoint)}>Copy</Button>
      </div>

      <div className="cg-tokens__tabs" role="tablist" aria-label="Client">
        {GUIDES.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={g.id === guide.id}
            className={`cg-tokens__tab${g.id === guide.id ? ' is-active' : ''}`}
            onClick={() => setClientId(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <p className="cg-tokens__where">
        <span className={`cg-tokens__badge cg-tokens__badge--${guide.transport}`}>
          {guide.transport === 'direct' ? 'Direct' : 'Local bridge'}
        </span>
        {guide.where}
      </p>

      <pre className="cg-tokens__snippet mono">{snippet}</pre>

      <div className="cg-tokens__snippet-actions">
        <Button onClick={() => void copy(snippet)}>Copy configuration</Button>
        <span className="cg-tokens__hint">
          Replace <span className="mono">{SECRET_PLACEHOLDER}</span> with a token from below.
        </span>
      </div>

      <p className="cg-tokens__then">{guide.then}</p>

      {guide.transport === 'bridge' && (
        <p className="cg-tokens__then muted">
          The bridge needs Node installed (<span className="mono">node -v</span>). Keep{' '}
          <span className="mono">Authorization:Bearer …</span> with no space after the colon —
          mcp-remote splits that argument on the first one.
        </p>
      )}
    </div>
  );
}

/** Shown once, in place of the form — there is no second look (§2.2). */
function SecretPanel({ created, onDone }: { created: CreatedToken; onDone: () => void }) {
  return (
    <div className="cg-tokens__secret-panel">
      <p className="cg-tokens__secret-intro">
        <strong>{created.token.name}</strong> is ready.
      </p>
      <div className="cg-tokens__secret mono" data-testid="token-secret">
        {created.secret}
      </div>
      <Button className="cg-tokens__copy" onClick={() => void copy(created.secret)}>
        Copy to clipboard
      </Button>
      <p className="cg-tokens__warning">
        Shown once — it cannot be retrieved again. Paste it into your agent now; if it is lost,
        revoke this token and generate a new one.
      </p>
      <Button variant="primary" className="cg-tokens__copy" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

export function ApiAgentsModal({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<TokenScope>('read');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);

  // The endpoint is wherever this page is served from — the MCP mount shares the
  // app's origin and proxy, so there is nothing for a person to look up (§1).
  const endpoint = `${window.location.origin}/mcp`;

  const load = useCallback(async () => {
    try {
      setTokens(await api.listTokens());
    } catch (err) {
      toast((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      setCreated(await api.createToken(name.trim(), scope));
      setName('');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: ApiToken) => {
    try {
      await api.revokeToken(token.id);
      toast('Token revoked');
      await load();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <Modal title="API & Agents" width={520} onClose={onClose}>
      <p className="cg-tokens__intro">
        A token lets an agent reach your workspace over MCP; it sees exactly what you see, and
        nothing of anyone else’s.
      </p>

      <ConnectGuide endpoint={endpoint} />

      {created ? (
        <SecretPanel
          created={created}
          onDone={() => {
            setCreated(null);
            void load();
          }}
        />
      ) : (
        <form className="cg-tokens__form" onSubmit={(e) => void submit(e)}>
          <label className="cg-tokens__field">
            <span className="label">Name</span>
            <input
              className="input"
              autoComplete="off"
              placeholder="Claude Desktop"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="cg-tokens__scopes" role="radiogroup" aria-label="Scope">
            {SCOPES.map((option) => (
              <label
                key={option.id}
                className={`cg-tokens__scope${scope === option.id ? ' cg-tokens__scope--on' : ''}`}
              >
                <input
                  type="radio"
                  name="cg-token-scope"
                  value={option.id}
                  checked={scope === option.id}
                  onChange={() => setScope(option.id)}
                />
                <span className="cg-tokens__scope-text">
                  <span className="cg-tokens__scope-label">{option.label}</span>
                  <span className="cg-tokens__hint">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <Button
            type="submit"
            variant="primary"
            className="cg-tokens__submit"
            disabled={busy || !name.trim()}
          >
            {busy ? 'Generating…' : 'Generate token'}
          </Button>
        </form>
      )}

      {tokens.length === 0 ? (
        <p className="cg-tokens__empty muted">No tokens yet.</p>
      ) : (
        <div className="cg-tokens__list">
          {tokens.map((token) => (
            <div key={token.id} className="cg-tokens__row" data-testid="token-row">
              <span className="cg-tokens__name">{token.name}</span>
              <Chip>{token.scope === 'write' ? 'Read & write' : 'Read-only'}</Chip>
              <span className="cg-tokens__meta label">
                created {relativeTime(token.createdAt)} ·{' '}
                {token.lastUsedAt ? `used ${relativeTime(token.lastUsedAt)}` : 'never used'}
              </span>
              <Button variant="ghost" onClick={() => void revoke(token)}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
