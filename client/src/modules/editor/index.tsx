import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Frame, Maximize2, Minimize2 } from 'lucide-react';
import type { NodeContent, NodeData } from '@cartograph/shared';
import { AUTOSAVE_BODY_MS } from '@cartograph/shared';
import { api } from '@/shared/api';
import { isCard, useStore } from '@/shared/store';
import { useDebouncedCallback, useLocalStorage } from '@/shared/hooks';
import { mentionedTitles } from '@/shared/links';
import { Button, Chip, InlineEdit, Tabs } from '@/shared/ui';
import { toast } from '@/shared/ui/toast';
import { isKnownNodeType, resolveBoardType, resolveNodeType } from '@/board-types';
import type { NodeTabProps } from '@/board-types';
import { CodeEditor } from './CodeEditor';
import { SubBoardsTab } from './SubBoardsTab';
import { InlineDescription } from './InlineDescription';
import './editor.css';

type SaveState = 'saved' | 'saving' | 'error';

/** Core tabs, always available whichever node type is showing. */
const SUBBOARDS_TAB = 'subboards';
const RAW_TAB = 'raw';

export function EditorPanel({ boardId, nodeId }: { boardId: string; nodeId: string }) {
  const openEditor = useStore((s) => s.openEditor);
  const config = useStore((s) => s.config);
  const patchNodeData = useStore((s) => s.patchNodeData);
  const renameNode = useStore((s) => s.renameNode);
  const refreshNodeFlags = useStore((s) => s.refreshNodeFlags);
  const setNodeLinks = useStore((s) => s.setNodeLinks);
  const duplicateNode = useStore((s) => s.duplicateNode);
  /** Somebody else's board (v1.6 §5): the panel reads, and offers nothing. */
  const readOnly = useStore((s) => s.readonly);
  const boardType = useStore((s) => s.board?.boardType);
  const node = useStore((s) => {
    const found = s.nodes.find((n) => n.id === nodeId);
    return found && isCard(found) ? found : undefined;
  });
  // The frame this node sits in, if any — named under the title in its colour.
  const frame = useStore((s) => {
    const parentId = s.nodes.find((n) => n.id === nodeId)?.parentId;
    return parentId ? s.nodes.find((n) => n.id === parentId) : undefined;
  });

  // Which tabs exist and what they render is the node type's call (§1).
  const world = resolveBoardType(boardType);
  const nodeType = resolveNodeType(world, node?.data.nodeType);
  const unknownNodeType = !!node?.data.nodeType && !isKnownNodeType(world, node.data.nodeType);

  const [content, setContent] = useState<NodeContent | null>(null);
  const [tab, setTab] = useState<string>(nodeType.tabs[0]?.id ?? 'overview');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [raw, setRaw] = useState('');
  const [rawError, setRawError] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [width, setWidth] = useLocalStorage('cartograph.panelWidth', 460);
  /*
   * 'side' docks to the right edge; 'centre' floats large in the middle.
   * Deliberately not persisted: opening a node always starts docked, and the
   * expanded view lasts until you close the panel. Switching nodes with the
   * panel open keeps whatever you chose, since this component stays mounted.
   */
  const [mode, setMode] = useState<'side' | 'centre'>('side');
  const dragging = useRef(false);

  const firstTab = nodeType.tabs[0]?.id ?? 'overview';

  // ---- load ----
  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setTab(firstTab);
    setRawError(null);
    api
      .getNode(boardId, nodeId)
      .then((loaded) => {
        if (cancelled) return;
        setContent(loaded);
        // The file just spoke: re-file its mentions, in case it changed on disk.
        setNodeLinks(nodeId, mentionedTitles(loaded.body));
        setSaveState('saved');
      })
      .catch((err) => !cancelled && toast((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [boardId, nodeId, firstTab, setNodeLinks]);

  // ---- autosave: body ----
  const [saveBody] = useDebouncedCallback((value: string) => {
    setSaveState('saving');
    api
      .putBody(boardId, nodeId, value)
      .then((updated) => {
        setSaveState('saved');
        refreshNodeFlags(nodeId, { coverage: updated.body.trim() ? 'written' : 'empty' });
      })
      .catch(() => setSaveState('error'));
  }, AUTOSAVE_BODY_MS);

  const onBodyChange = useCallback(
    (value: string) => {
      if (readOnly) return;
      setContent((c) => (c ? { ...c, body: value } : c));
      // Links follow the keystroke, not the save: a world that draws them (§4.2)
      // should react as you type, exactly as the rendered preview does.
      setNodeLinks(nodeId, mentionedTitles(value));
      setSaveState('saving');
      saveBody(value);
    },
    [saveBody, setNodeLinks, nodeId, readOnly],
  );

  // ---- autosave: data ----
  const [saveData] = useDebouncedCallback((next: NodeData) => {
    setSaveState('saving');
    api
      .putData(boardId, nodeId, next)
      .then((updated) => {
        setSaveState('saved');
        setContent((c) => (c ? { ...c, data: updated.data, incoming: updated.incoming } : c));
        refreshNodeFlags(nodeId, {
          hasData: updated.data !== null,
          passesData: !!updated.data?.outSnippetId,
        });
      })
      .catch(() => setSaveState('error'));
  }, AUTOSAVE_BODY_MS);

  const onDataChange = useCallback(
    (next: NodeData) => {
      if (readOnly) return;
      setContent((c) => (c ? { ...c, data: next } : c));
      setSaveState('saving');
      saveData(next);
    },
    [saveData, readOnly],
  );

  // ---- description ----
  const setShowDescription = useStore((s) => s.setShowDescription);

  const onDescription = useCallback(
    async (description: string) => {
      if (readOnly) return;
      const first = description && !node?.data.description;
      setContent((c) => (c ? { ...c, frontmatter: { ...c.frontmatter, description } } : c));
      patchNodeData(nodeId, { description });
      // The first description a node gets grows the card to fit it (§3.2).
      if (first && node?.data.showDescription === undefined) setShowDescription(nodeId, true);
      setSaveState('saving');
      try {
        await api.patchNode(boardId, nodeId, { description });
        setSaveState('saved');
      } catch (err) {
        setSaveState('error');
        toast((err as Error).message);
      }
    },
    [boardId, nodeId, patchNodeData, node, setShowDescription, readOnly],
  );

  // ---- raw mode ----
  const openRaw = async () => {
    try {
      const { raw: text } = await api.getRaw(boardId, nodeId);
      setRaw(text);
      setRawError(null);
      setTab(RAW_TAB);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const saveRaw = async () => {
    // Hiding the button is not the guard — the flag can flip while this tab is open.
    if (readOnly) return;
    setSaveState('saving');
    try {
      const updated = await api.putRaw(boardId, nodeId, raw);
      setContent(updated);
      setNodeLinks(nodeId, mentionedTitles(updated.body));
      setRawError(null);
      setSaveState('saved');
      patchNodeData(nodeId, {
        title: updated.frontmatter.title,
        status: updated.frontmatter.status,
        description: updated.frontmatter.description,
        coverage: updated.body.trim() ? 'written' : 'empty',
      });
      toast('File saved');
      setTab(firstTab);
    } catch (err) {
      setSaveState('error');
      setRawError((err as Error).message);
    }
  };

  // ---- frontmatter actions ----
  const setStatus = async (status: string) => {
    if (readOnly) return;
    patchNodeData(nodeId, { status });
    setContent((c) => (c ? { ...c, frontmatter: { ...c.frontmatter, status } } : c));
    try {
      await api.patchNode(boardId, nodeId, { status });
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const cycleStatus = () => {
    const statuses = config?.statuses ?? [];
    if (!statuses.length || !content) return;
    const index = statuses.findIndex((s) => s.id === content.frontmatter.status);
    void setStatus(statuses[(index + 1) % statuses.length].id);
  };

  const commitTags = async (tags: string[]) => {
    if (readOnly) return;
    setContent((c) => (c ? { ...c, frontmatter: { ...c.frontmatter, tags } } : c));
    try {
      await api.patchNode(boardId, nodeId, { tags });
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const onRename = async (title: string) => {
    if (readOnly) return;
    const newId = await renameNode(nodeId, title);
    setContent((c) => (c ? { ...c, frontmatter: { ...c.frontmatter, title } } : c));
    if (newId && newId !== nodeId) openEditor(newId);
  };

  const focusSource = useCallback(
    (sourceId: string) => {
      useStore.setState({
        nodes: useStore.getState().nodes.map((n) => ({ ...n, selected: n.id === sourceId })),
      });
      openEditor(sourceId);
    },
    [openEditor],
  );

  // ---- drag divider ----
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragging.current) return;
      const next = Math.min(Math.max(window.innerWidth - event.clientX, 340), window.innerWidth - 280);
      setWidth(Math.round(next));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setWidth]);

  // ---- Esc closes ----
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const target = event.target as HTMLElement | null;
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
        openEditor(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openEditor]);

  const status = config?.statuses.find((s) => s.id === (content?.frontmatter.status ?? node?.data.status));
  const tags = (content?.frontmatter.tags ?? []) as string[];
  const description = (content?.frontmatter.description as string | undefined) ?? '';

  const centred = mode === 'centre';

  /*
   * Sub-boards belong to core but read as a node concern, so they sit where the
   * type's own housekeeping tab starts — just before Settings when there is one.
   */
  const tabDefs = useMemo(() => {
    const typed = nodeType.tabs.map((t) => ({
      id: t.id,
      label: t.label,
      dot: content ? t.dot?.(content) : false,
    }));
    const subboards = {
      id: SUBBOARDS_TAB,
      label: 'Sub-boards',
      dot: !!node?.data.childBoards?.length,
    };
    const settingsAt = typed.findIndex((t) => t.id === 'settings');
    const at = settingsAt === -1 ? typed.length : settingsAt;
    return [
      ...typed.slice(0, at),
      subboards,
      ...typed.slice(at),
      ...(tab === RAW_TAB ? [{ id: RAW_TAB, label: 'Raw' }] : []),
    ];
  }, [nodeType, content, node?.data.childBoards?.length, tab]);

  const active = nodeType.tabs.find((t) => t.id === tab);
  const tabProps: NodeTabProps | null = content && {
    nodeId,
    content,
    onBodyChange,
    onDataChange,
    onOpenTab: setTab,
    onOpenNode: focusSource,
    onOpenRaw: () => void openRaw(),
    onDuplicate: () => void duplicateNode(nodeId),
    readOnly,
  };

  return (
    <>
      {centred && <div className="cg-editor__scrim" aria-hidden />}
      <aside
        key={mode}
        className={`cg-editor${centred ? ' cg-editor--centre' : ''}`}
        style={centred ? undefined : { width }}
        aria-label="Node editor"
      >
        {!centred && (
          <div
            className="cg-editor__divider"
            onMouseDown={() => {
              dragging.current = true;
              document.body.style.cursor = 'col-resize';
            }}
            role="separator"
            aria-orientation="vertical"
          />
        )}

      <header className="cg-editor__head">
        <div className="row">
          {readOnly ? (
            <span className="cg-editor__title">
              {content?.frontmatter.title ?? node?.data.title ?? nodeId}
            </span>
          ) : (
            <InlineEdit
              className="cg-editor__title"
              value={content?.frontmatter.title ?? node?.data.title ?? nodeId}
              onCommit={(next) => void onRename(next)}
              ariaLabel="Node title"
            />
          )}
          <div className="spacer" />
          <Button
            icon
            variant="ghost"
            aria-label={centred ? 'Dock panel to the side' : 'Expand panel to the centre'}
            title={centred ? 'Dock to the side' : 'Expand to the centre'}
            onClick={() => setMode(centred ? 'side' : 'centre')}
          >
            {centred ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </Button>
          <Button icon variant="ghost" aria-label="Close editor" onClick={() => openEditor(null)}>
            ✕
          </Button>
        </div>

        {frame?.type === 'frame' && (
          <button
            type="button"
            className="cg-editor__frame"
            style={{ background: `var(${(frame.data as { color?: string }).color ?? '--node-slate'})` }}
            title="Select this frame on the canvas"
            onClick={() => {
              useStore.setState({
                nodes: useStore.getState().nodes.map((n) => ({ ...n, selected: n.id === frame.id })),
              });
            }}
          >
            <Frame size={11} />
            {(frame.data as { title: string }).title}
          </button>
        )}

        {readOnly ? (
          description && <p className="cg-editor__description is-static">{description}</p>
        ) : (
          <InlineDescription value={description} onCommit={(next) => void onDescription(next)} />
        )}

        <div className="row cg-editor__meta">
          <Chip
            color={status?.colorToken}
            onClick={readOnly ? undefined : cycleStatus}
            title={readOnly ? undefined : 'Click to cycle status'}
          >
            {status?.label ?? 'Status'}
          </Chip>
          {unknownNodeType && (
            <Chip title={`This board's world has no “${node?.data.nodeType}” type · shown as ${nodeType.label}`}>
              type: {node?.data.nodeType}
            </Chip>
          )}
          {tags.map((tag) =>
            readOnly ? (
              <Chip key={tag}>{tag}</Chip>
            ) : (
              <Chip
                key={tag}
                onClick={() => void commitTags(tags.filter((t) => t !== tag))}
                title="Remove tag"
              >
                {tag} ✕
              </Chip>
            ),
          )}
          {!readOnly && (
            <input
              className="cg-editor__tag-input mono"
              placeholder="+ tag"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagDraft.trim()) {
                  void commitTags([...new Set([...tags, tagDraft.trim()])]);
                  setTagDraft('');
                }
                e.stopPropagation();
              }}
            />
          )}
          <div className="spacer" />
          <span className="mono cg-editor__created">{content?.frontmatter.created ?? ''}</span>
        </div>
      </header>

      <Tabs tabs={tabDefs} active={tab} onChange={setTab} />

      <div className="cg-editor__body">
        {!content && <div className="empty-state">Loading…</div>}

        {tabProps && active && <active.component key={`${nodeId}-${active.id}`} {...tabProps} />}

        {content && tab === SUBBOARDS_TAB && (
          <SubBoardsTab
            key={`${nodeId}-subboards`}
            nodeId={nodeId}
            title={String(content.frontmatter.title ?? nodeId)}
            readOnly={readOnly}
          />
        )}

        {content && tab === RAW_TAB && (
          <div className="cg-editor__raw">
            <CodeEditor
              key={`${nodeId}-raw`}
              value={raw}
              onChange={setRaw}
              language="markdown"
              mono
              gutter
              readOnly={readOnly}
            />
            {rawError && <p className="cg-data__error">{rawError}</p>}
            <div className="cg-editor__raw-actions">
              {!readOnly && (
                <Button variant="primary" onClick={() => void saveRaw()}>
                  Save file
                </Button>
              )}
              <Button variant="ghost" onClick={() => setTab(firstTab)}>
                {readOnly ? 'Close file' : 'Cancel'}
              </Button>
            </div>
          </div>
        )}
      </div>

      <footer className="cg-editor__foot">
        <span className={`cg-save cg-save--${readOnly ? 'saved' : saveState}`}>
          {readOnly && 'Read-only'}
          {!readOnly && saveState === 'saved' && 'Saved'}
          {!readOnly && saveState === 'saving' && 'Saving…'}
          {!readOnly && saveState === 'error' && 'Offline — retrying'}
        </span>
        <div className="spacer" />
        <span className="mono cg-editor__path">nodes/{nodeId}/node.md</span>
      </footer>

      </aside>
    </>
  );
}
