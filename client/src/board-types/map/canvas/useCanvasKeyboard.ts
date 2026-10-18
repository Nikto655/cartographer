import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { NodeShape } from '@cartograph/shared';
import { useStore } from '@/shared/store';
import { isTypingTarget } from '@/shared/hooks';
import { overlayOwnsKeyboard } from '@/shared/overlay';

type ArmTool = 'select' | 'pan' | 'node' | 'chip' | 'frame' | 'text' | 'connector';

interface Options {
  onExport: () => void;
  onPalette: () => void;
  onExpand: (nodeId: string) => void;
  onArm: (tool: ArmTool) => void;
  disabled?: boolean;
}

/** The keyboard map from §8, live only while the canvas owns focus. */
export function useCanvasKeyboard({ onExport, onPalette, onExpand, onArm, disabled }: Options): void {
  const flow = useReactFlow();
  const store = useStore;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // A dialog, the palette or the walkthrough has the keys, ⌘K and ⌘E included:
      // a dialog does not focus a text field, so the check above never fired and a
      // Backspace meant for the Export dialog archived the selection behind it.
      // `event` matters too — Escape closes the dialog before this listener runs.
      if (overlayOwnsKeyboard(event)) return;
      const state = store.getState();
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
      // Copy takes ids and touches nothing, so it works on a board you may only
      // look at — whether the paste is allowed is decided server-side (§6.2).
      if (mod && event.key.toLowerCase() === 'c' && selected.length) {
        event.preventDefault();
        state.copySelection(selected);
        return;
      }
      // Find, export and copy read; everything past here writes (v1.6 §5).
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
      if (mod && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
        // Only meaningful with text labels selected; otherwise leave the browser alone.
        const textIds = state.nodes.filter((n) => n.selected && n.type === 'text').map((n) => n.id);
        if (textIds.length) {
          event.preventDefault();
          const key = event.key.toLowerCase();
          state.toggleTextStyle(textIds, key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
        }
        return;
      }
      if (mod) return;

      switch (event.key) {
        case 'n':
        case 'N': {
          event.preventDefault();
          const center = flow.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
          void state.createNode({ x: center.x - 92, y: center.y - 38 }, { editing: true });
          return;
        }
        case 'Enter': {
          // Frames and texts have no file, so no editor.
          const card = state.nodes.find((n) => n.id === selected[0] && n.type === 'cartograph');
          if (selected.length === 1 && card) {
            event.preventDefault();
            state.openEditor(selected[0]);
          }
          return;
        }
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
        case 'c':
        case 'C': {
          if (selected.length) {
            event.preventDefault();
            state.toggleVariant(selected);
          }
          return;
        }
        case 'f':
        case 'F': {
          event.preventDefault();
          if (selected.length > 1) state.wrapSelectionInFrame();
          else onArm('frame');
          return;
        }
        case 't':
        case 'T': {
          event.preventDefault();
          onArm('text');
          return;
        }
        case 'v':
        case 'V': {
          event.preventDefault();
          onArm('select');
          return;
        }
        // H for hand, the shortcut every canvas tool uses for this.
        case 'h':
        case 'H': {
          event.preventDefault();
          onArm('pan');
          return;
        }
        case 'Escape': {
          onArm('select');
          return;
        }
        case 's':
        case 'S': {
          if (selected.length) {
            event.preventDefault();
            state.cycleStatus(selected);
          }
          return;
        }
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!selected.length) return;
          event.preventDefault();
          const step = event.shiftKey ? 1 : 8;
          const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
          state.nudge(selected, dx, dy);
          return;
        }
        case '1':
        case '2':
        case '3':
        case '4':
        case '5': {
          if (!selected.length) return;
          const shapes = state.config?.shapes ?? [];
          const shape = shapes[Number(event.key) - 1] as NodeShape | undefined;
          if (shape) {
            event.preventDefault();
            state.setShape(selected, shape);
          }
          return;
        }
        case 'e':
        case 'E': {
          if (selected.length === 1) {
            event.preventDefault();
            onExpand(selected[0]);
          }
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow, onExport, onPalette, onExpand, onArm, disabled, store]);
}
