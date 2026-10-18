import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/shared/store';
import { navigate, routes, useRoute } from '@/shared/router';
import { useLocalStorage } from '@/shared/hooks';
import { Button, Kbd } from '@/shared/ui';
import { Toaster, toast } from '@/shared/ui/toast';
import { api } from '@/shared/api';
import { canvasActions, revealNode } from '@/shared/canvasActions';
import { resolveBoardType } from '@/board-types';
import { ForcedPasswordChange, LoginScreen, useAuth } from '@/modules/auth';
import { Dashboard } from '@/modules/dashboard';
import { EditorPanel } from '@/modules/editor';
import { Walkthrough } from '@/modules/walkthrough';
import { ExportDialog } from '@/modules/export';
import { CommandPalette, type Command } from '@/modules/palette';
import { overlayOwnsKeyboard } from '@/shared/overlay';
import { Chrome } from './Chrome';
import './app.css';

export function App() {
  const route = useRoute();
  const authStatus = useAuth((s) => s.status);
  const loadSession = useAuth((s) => s.load);
  const config = useStore((s) => s.config);
  const loadConfig = useStore((s) => s.loadConfig);
  const loadSummaries = useStore((s) => s.loadSummaries);
  const loadShared = useStore((s) => s.loadShared);
  const setWorkspace = useStore((s) => s.setWorkspace);
  const openBoard = useStore((s) => s.openBoard);
  const closeBoard = useStore((s) => s.closeBoard);
  const board = useStore((s) => s.board);
  const nodes = useStore((s) => s.nodes);
  const openNodeId = useStore((s) => s.openNodeId);
  const openEditor = useStore((s) => s.openEditor);
  const saveNow = useStore((s) => s.saveNow);
  const loading = useStore((s) => s.loading);
  const shared = useStore((s) => s.shared);

  const [palette, setPalette] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [walkFrom, setWalkFrom] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useLocalStorage('cartograph.snapToGrid', false);
  const [minimap, setMinimap] = useLocalStorage('cartograph.minimap', true);

  const boardId = route.name === 'board' ? route.boardId : null;
  // Whose board this is comes from the URL and nowhere else (v1.6 §5).
  const ownerId = route.name === 'board' ? route.ownerId : null;
  const readOnly = useStore((s) => s.readonly);
  // The board's type picks the canvas; anything we don't know falls back to a map (§1).
  const world = resolveBoardType(board?.boardType);
  const { Canvas: BoardCanvas } = world;

  /*
   * Downloading a shared board is the owner's to grant (§5). Your own boards
   * are always exportable; a shared one only when the share row says so. The
   * server refuses it either way — this is so the button is not there to press,
   * and so ⌘E says why instead of doing nothing.
   */
  const canExport =
    !readOnly ||
    !!shared.find((s) => s.ownerId === ownerId && board && s.boardIds.includes(board.id))?.canExport;

  const openExport = useCallback(() => {
    if (canExport) setExporting(true);
    else toast('This board was shared to read, not to download.');
  }, [canExport]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // Nothing behind the wall is fetched until there is a session to fetch it with.
  useEffect(() => {
    if (authStatus !== 'ready') return;
    void loadConfig();
    void loadSummaries();
    // Also on a deep link into somebody else's board: the banner has to know
    // whose it is and whether the share allows a copy (§5).
    void loadShared();
  }, [authStatus, loadConfig, loadSummaries, loadShared]);

  /*
   * Ordering matters: the workspace is pointed at the owner *before* anything is
   * fetched, so the board, its summaries and the panel all address one place.
   */
  useEffect(() => {
    if (authStatus !== 'ready') return;
    setWorkspace(ownerId);
    if (boardId) void openBoard(boardId);
    else {
      closeBoard();
      void loadSummaries();
    }
  }, [authStatus, boardId, ownerId, openBoard, closeBoard, setWorkspace, loadSummaries]);

  // The panel mode used to be sticky; it opens docked now, so drop the old key.
  useEffect(() => {
    try {
      window.localStorage.removeItem('cartograph.panelMode');
    } catch {
      /* storage blocked — nothing to clean up */
    }
  }, []);

  // Inside the notes editor Cmd+K makes a link, so Cmd+P reaches the palette
  // from anywhere, including while typing (v1.3 §2).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Not over a dialog or the walkthrough: both would then claim the arrows.
      if (overlayOwnsKeyboard(event)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /*
   * Never lose work when the tab goes away. An ordinary save here was a no-op:
   * the handler cannot await, and the browser aborts the fetch as the page
   * unloads. The store sends it keepalive instead, which the browser finishes.
   * A graph too big for keepalive gets an ordinary save and the browser's
   * "leave site?" prompt — staying is what lets that save land.
   *
   * `pagehide` as well, because mobile browsers and the back-forward cache can
   * drop a page without `beforeunload`; the store sends nothing twice.
   */
  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => {
      if (useStore.getState().saveBeforeUnload()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onHide = () => void useStore.getState().saveBeforeUnload();
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  const selectedIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
  const lastNodeId = useMemo(
    () => selectedIds.find((id) => nodes.some((n) => n.id === id && n.type === 'cartograph')) ?? null,
    [selectedIds, nodes],
  );

  const startWalk = useCallback(() => {
    const start = selectedIds[0] ?? nodes[0]?.id;
    if (start) setWalkFrom(start);
  }, [selectedIds, nodes]);

  const selectNode = useCallback((nodeId: string) => revealNode(nodeId), []);

  const commands = useMemo<Command[]>(() => {
    if (!board) return [];
    return [
      // Reading a board you may not change offers only the reading commands.
      ...(readOnly
        ? []
        : [{ id: 'new-node', label: 'New node', keys: ['N'], run: () => canvasActions.createAtCenter?.() }]),
      ...(canExport
        ? [{ id: 'export', label: 'Export selection', keys: ['⌘E'], run: () => setExporting(true) }]
        : []),
      // A world without paths has nothing to walk (§7.5), so it isn't offered one.
      ...(world.panelFlags.walkthrough
        ? [{ id: 'walk', label: 'Walk from selection', run: startWalk }]
        : []),
      ...(readOnly ? [] : [{
        id: 'snapshot',
        label: `Snapshot ${world.label.toLowerCase()}`,
        run: async () => {
          await saveNow();
          try {
            const snapshot = await api.createSnapshot(board.id);
            toast(`Snapshot saved · ${snapshot.timestamp.slice(11, 16).replace('-', ':')}`);
          } catch (err) {
            toast((err as Error).message);
          }
        },
      }]),
      { id: 'dashboard', label: 'Go to dashboard', run: () => navigate(routes.dashboard()) },
    ];
  }, [board, startWalk, saveNow, world, readOnly, canExport]);

  // Signed out, or holding a temp password: those are the whole app (§8.2).
  if (authStatus !== 'ready') {
    return (
      <div className="app-shell">
        {authStatus === 'unknown' ? (
          <div className="empty-state">Loading…</div>
        ) : authStatus === 'anonymous' ? (
          <LoginScreen />
        ) : (
          <ForcedPasswordChange />
        )}
        <Toaster />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-body">
        {route.name === 'dashboard' && <Dashboard />}

        {route.name === 'board' &&
          (loading && !board ? (
            <div className="empty-state">Loading…</div>
          ) : !board ? (
            <div className="empty-state">
              <p>That board is gone — it may have been archived or renamed.</p>
              <Button onClick={() => navigate(routes.dashboard())}>Back to dashboard</Button>
            </div>
          ) : (
            <>
              <div className="app-canvas-wrap">
                <BoardCanvas
                  onExport={openExport}
                  onPalette={() => setPalette(true)}
                  snapToGrid={snapToGrid}
                  showMinimap={minimap}
                  onToggleMinimap={() => setMinimap(!minimap)}
                  readOnly={readOnly}
                />
                {nodes.length === 0 && (
                  <div className="cg-canvas-empty">
                    <p>
                      {/* What to do next depends on the furniture this world has. */}
                      {readOnly
                        ? `Empty ${world.label.toLowerCase()}.`
                        : <>Empty {world.label.toLowerCase()}. Press <Kbd>N</Kbd>, {world.emptyHint}</>}
                    </p>
                  </div>
                )}
                <Chrome
                  onExport={openExport}
                  canExport={canExport}
                  onPalette={() => setPalette(true)}
                  onWalk={startWalk}
                  canWalk={nodes.length > 0}
                  showWalk={world.panelFlags.walkthrough}
                  minimap={minimap}
                  onToggleMinimap={() => setMinimap(!minimap)}
                  snapToGrid={snapToGrid}
                  onToggleSnap={() => setSnapToGrid(!snapToGrid)}
                  editorOpen={!!openNodeId}
                  onToggleEditor={() => openEditor(openNodeId ? null : lastNodeId)}
                  readOnly={readOnly}
                />
              </div>
              {openNodeId && <EditorPanel boardId={board.id} nodeId={openNodeId} />}
            </>
          ))}

        {route.name === 'unknown' && (
          <div className="empty-state">
            <p>Nothing here.</p>
            <Button onClick={() => navigate(routes.dashboard())}>Back to dashboard</Button>
          </div>
        )}
      </div>

      {palette && config && (
        <CommandPalette commands={commands} onClose={() => setPalette(false)} onSelectNode={selectNode} />
      )}
      {exporting && board && <ExportDialog initialNodeIds={selectedIds} onClose={() => setExporting(false)} />}
      {walkFrom && <Walkthrough startNodeId={walkFrom} onClose={() => setWalkFrom(null)} />}

      <Toaster />
    </div>
  );
}
