/**
 * Sharing, client side (v1.6 §5). Two surfaces and no third: the owner's dialog
 * (who may see this board, and may they take a copy) and the recipient's
 * "Shared with me" shelf. Viewing itself is not this module's business — a
 * shared board opens in the ordinary viewer with the read-only flag the Admin
 * View already established (§8.3).
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Users } from 'lucide-react';
import type { ShareCandidate, ShareRecipient } from '@cartograph/shared';
import { api } from '@/shared/api';
import { navigate, routes } from '@/shared/router';
import { relativeTime } from '@/shared/hooks';
import { resolveBoardType } from '@/board-types';
import { useStore } from '@/shared/store';
import { Button, Modal, StatusStrip } from '@/shared/ui';
import { toast } from '@/shared/ui/toast';
import './share.css';

const shareDate = (iso: string) => iso.slice(0, 10);

/**
 * Date and time of day, in the reader's locale and zone — "shared today" is only
 * useful if you can also see whether that was before or after your last look.
 */
const sharedAtLabel = (iso: string) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return shareDate(iso);
  return `${at.toLocaleDateString()} at ${at.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

/**
 * The owner's dialog. Sharing a board shares everything under it, which the
 * dialog says out loud — a person picking a name should not have to infer how
 * far the grant reaches.
 */
export function ShareDialog({
  boardId,
  boardName,
  onClose,
}: {
  boardId: string;
  boardName: string;
  onClose: () => void;
}) {
  const [shares, setShares] = useState<ShareRecipient[]>([]);
  const [candidates, setCandidates] = useState<ShareCandidate[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.boardShares(boardId);
      setShares(data.shares);
      setCandidates(data.candidates);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (run: () => Promise<{ shares: ShareRecipient[] }>, message: string) => {
    try {
      setShares((await run()).shares);
      toast(message);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const sharedWith = new Set(shares.map((s) => s.userId));
  const needle = query.trim().toLowerCase();
  const addable = candidates.filter((c) => !sharedWith.has(c.id));
  /*
   * Super Admins are searchable but not listed. An admin account is a role
   * rather than a colleague, and standing at the top of "who would you like to
   * share this with" invites a share nobody meant — but it is not forbidden, so
   * typing the name still finds it and sharing still works.
   */
  const offers = addable.filter((c) =>
    needle
      ? c.displayName.toLowerCase().includes(needle) || c.username.toLowerCase().includes(needle)
      : !c.isSuperAdmin,
  );
  /*
   * "No one else to add" would be false while an admin sits behind the search,
   * so the empty line says which of the two is true. Only when the list is
   * otherwise empty: with people on it there is nothing to explain.
   */
  const hiddenAdmins = !needle && offers.length === 0 && addable.some((c) => c.isSuperAdmin);

  return (
    <Modal title={`Share “${boardName}”`} width={420} onClose={onClose}>
      <p className="cg-share__note">
        View-only. Changes you make show up when the other person refreshes.
      </p>

      {loading ? (
        <p className="label">Loading…</p>
      ) : (
        <>
          <div className="cg-share__section label">Shared with</div>
          {shares.length === 0 && <p className="cg-share__empty muted">Nobody yet.</p>}
          {shares.map((share) => (
            <div key={share.userId} className="cg-share__row" data-testid="share-row">
              <div className="cg-share__who">
                <span className="cg-share__name">{share.displayName}</span>
                <span className="mono muted">@{share.username}</span>
              </div>
              {/* Whether the share is being used, at a glance — the reason an
                  owner opens this dialog after the sharing is done. */}
              <span
                className="cg-share__seen mono muted"
                data-testid={`last-access-${share.username}`}
                title={
                  share.lastAccessedAt
                    ? `Last opened ${sharedAtLabel(share.lastAccessedAt)}`
                    : 'They have not opened it yet'
                }
              >
                {share.lastAccessedAt
                  ? `opened ${relativeTime(share.lastAccessedAt)}`
                  : 'never opened'}
              </span>
              <Button
                variant="ghost"
                onClick={() =>
                  void act(() => api.unshareBoard(boardId, share.userId), 'Share revoked')
                }
              >
                Revoke
              </Button>
              {/* Every toggle rewrites the whole row, so each one carries the
                  others' current values rather than defaults that would quietly
                  undo them. */}
              <div className="cg-share__opts">
                <label className="cg-share__opt" title="Let them take a copy into their own workspace">
                  <input
                    type="checkbox"
                    checked={share.canDuplicate}
                    data-testid={`allow-duplicate-${share.username}`}
                    onChange={(e) =>
                      void act(
                        () =>
                          api.shareBoard(
                            boardId,
                            share.userId,
                            e.target.checked,
                            share.includeChildren,
                            share.canExport,
                          ),
                        e.target.checked ? 'Duplicate allowed' : 'Duplicate turned off',
                      )
                    }
                  />
                  Allow duplicate
                </label>
                <label
                  className="cg-share__opt"
                  title="Share the sub-boards under this one as well"
                >
                  <input
                    type="checkbox"
                    checked={share.includeChildren}
                    data-testid={`include-children-${share.username}`}
                    onChange={(e) =>
                      void act(
                        () =>
                          api.shareBoard(
                            boardId,
                            share.userId,
                            share.canDuplicate,
                            e.target.checked,
                            share.canExport,
                          ),
                        e.target.checked ? 'Sub-boards included' : 'Sub-boards withheld',
                      )
                    }
                  />
                  Include sub-boards
                </label>
                <label
                  className="cg-share__opt"
                  title="Let them download this board and its notes as markdown files"
                >
                  <input
                    type="checkbox"
                    checked={share.canExport}
                    data-testid={`allow-export-${share.username}`}
                    onChange={(e) =>
                      void act(
                        () =>
                          api.shareBoard(
                            boardId,
                            share.userId,
                            share.canDuplicate,
                            share.includeChildren,
                            e.target.checked,
                          ),
                        e.target.checked ? 'Export allowed' : 'Export turned off',
                      )
                    }
                  />
                  Allow export
                </label>
              </div>
            </div>
          ))}

          <div className="cg-share__section label">Add someone</div>
          <input
            className="input cg-share__search"
            placeholder="Find a person by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a person"
          />
          <div className="cg-share__candidates">
            {offers.length === 0 && (
              <p className="cg-share__empty muted">
                {hiddenAdmins ? 'Search by name to add an administrator.' : 'No one else to add.'}
              </p>
            )}
            {offers.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className="cg-share__candidate"
                data-testid={`share-with-${candidate.username}`}
                onClick={() =>
                  void act(
                    // A new share starts the way sharing always behaved: the tree
                    // comes with it, and copying does not.
                    () => api.shareBoard(boardId, candidate.id, false, true, false),
                    `Shared with ${candidate.displayName}`,
                  )
                }
              >
                <span className="cg-share__name">{candidate.displayName}</span>
                <span className="mono muted">@{candidate.username}</span>
                <span className="spacer" />
                <Check size={14} />
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

/**
 * The recipient's shelf: the same card the dashboard uses, plus whose it is.
 *
 * `bare` hands the section's separation over to whoever is laying it out — the
 * dashboard draws one divider style for all of Recent's sections, and a second
 * built-in border would double it. `filter` is the dashboard's search, applied
 * here because these boards are not in `summaries` and its own filter cannot
 * reach them.
 */
export function SharedWithMe({ bare = false, filter = '' }: { bare?: boolean; filter?: string }) {
  const shared = useStore((s) => s.shared);
  const config = useStore((s) => s.config);
  const needle = filter.trim().toLowerCase();
  const list = needle ? shared.filter((s) => s.name.toLowerCase().includes(needle)) : shared;
  if (!list.length) return null;

  return (
    <section className={`cg-shared${bare ? ' cg-shared--bare' : ''}`} data-testid="shared-with-me">
      <h2 className="cg-shared__title">
        <Users size={15} /> Shared with me
      </h2>
      <div className="cg-board-grid">
        {list.map((summary) => {
          const world = resolveBoardType(summary.boardType);
          const open = () => navigate(routes.userBoard(summary.ownerId, summary.id));
          return (
            <article
              key={`${summary.ownerId}/${summary.id}`}
              className="cg-board-card"
              data-testid="shared-card"
              role="button"
              tabIndex={0}
              onClick={open}
              onKeyDown={(e) => e.key === 'Enter' && open()}
            >
              <div className="cg-board-card__head">
                <span className="cg-board-card__world" title={world.label} aria-label={world.label}>
                  <world.Icon size={15} />
                </span>
                <span className="cg-board-card__name">{summary.name}</span>
                <div className="spacer" />
                {/*
                 * A shared card is an owned card in every other respect, so whose it
                 * is has to live somewhere: the initial takes the slot the owner's
                 * own card gives to its actions menu.
                 */}
                <span
                  className="cg-shared__owner"
                  title={`Shared by ${summary.ownerName} · ${sharedAtLabel(summary.sharedAt)}`}
                  aria-label={`Shared by ${summary.ownerName}`}
                >
                  {summary.ownerName.slice(0, 1).toUpperCase()}
                </span>
              </div>
              <div className="cg-board-card__meta mono">
                <span>
                  {summary.nodeCount} node{summary.nodeCount === 1 ? '' : 's'}
                </span>
                {summary.subBoardCount > 0 && <span className="cg-board-card__dot">·</span>}
                {summary.subBoardCount > 0 && (
                  <span className="cg-board-card__children cg-board-card__children--static">
                    {summary.subBoardCount} sub-board{summary.subBoardCount === 1 ? '' : 's'}
                  </span>
                )}
                <span className="cg-board-card__time">{relativeTime(summary.updatedAt)}</span>
              </div>
              {config && (
                <StatusStrip counts={summary.statusCounts} statuses={config.statuses} height={4} />
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
