import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useStore } from '@/shared/store';
import { isTypingTarget } from '@/shared/hooks';
import { overlayOwnsKeyboard } from '@/shared/overlay';

interface Options {
  onExport: () => void;
  onPalette: () => void;
  onCreate: () => void;
  onDrill: (nodeId: string) => void;
  /** Read-only board: the two reading shortcuts survive, the rest don't (§5). */
  disabled?: boolean;
}

/**
 * The graph's keyboard: the map's map, minus everything that needs furniture the
 * graph doesn't have (shapes, chips, frames, text, nudging — position is the
 * simulation's to decide, not the arrow keys').
 */
export function useGraphKeyboard({ onExport, onPalette, onCreate, onDrill, disabled }: Options): void {
  const flow = useReactFlow();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // An overlay owns the keyboard — same rule and same reason as the map's.
      if (overlayOwnsKeyboard(event)) return;
      const state = useStore.getState();
      const selected = state.nodes.filter((n) => n.selected).map((n) => n.id);
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onPalette();
        return;
      }
      if (mod && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        onExport();
        return;
      }
      // A read, so it survives the read-only gate below — same rule as the map (§6.2).
      if (mod && event.key.toLowerCase() === 'c' && selected.length) {
        event.preventDefault();
        state.copySelection(selected);
        return;
      }
      if (disabled) return;

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        if (selected.length) void state.duplicateSelection(selected);
        return;
      }
      if (mod && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        void state.pasteClipboard(
          flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
        );
        return;
      }
      if (mod) return;

      switch (event.key) {
        case 'n':
        case 'N':
          event.preventDefault();
          onCreate();
          return;
        case 'Enter':
          if (selected.length === 1) {
            event.preventDefault();
            state.openEditor(selected[0]);
          }
          return;
        case 'Delete':
        case 'Backspace': {
          if (selected.length) {
            event.preventDefault();
            void state.archiveNodes(selected);
            return;
          }
          const selectedEdges = state.edges.filter((e) => e.selected).map((e) => e.id);
          if (selectedEdges.length) {
            event.preventDefault();
            state.onEdgesChange(selectedEdges.map((id) => ({ id, type: 'remove' as const })));
          }
          return;
        }
        case 's':
        case 'S':
          if (selected.length) {
            event.preventDefault();
            state.cycleStatus(selected);
          }
          return;
        case 'e':
        case 'E':
          if (selected.length === 1) {
            event.preventDefault();
            onDrill(selected[0]);
          }
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow, onExport, onPalette, onCreate, onDrill, disabled]);
}
