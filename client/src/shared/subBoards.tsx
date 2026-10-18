/**
 * Choosing a child board's world (v1.5 §3.1). Sub-boards work both directions —
 * a map node can hold a graph and a graph entity can hold a map — so every place
 * that makes one asks which, and they all ask with this. Core offers whatever
 * worlds the registry has without ever naming one.
 */
import { useCallback, useState, type ReactNode } from 'react';
import type { BoardType } from '@cartograph/shared';
import { listBoardTypes, type BoardTypeDefinition } from '@/board-types';
import { isCard, useStore } from './store';
import { boardHref, navigate } from './router';
import { Menu, MenuItem } from './ui';

interface Anchor {
  x: number;
  y: number;
}

export function NewSubBoardMenu({
  anchor,
  onClose,
  onPick,
}: {
  anchor: Anchor;
  onClose: () => void;
  onPick: (world: BoardTypeDefinition) => void;
}) {
  return (
    <Menu anchor={anchor} onClose={onClose}>
      {listBoardTypes().map((world) => (
        <MenuItem
          key={world.id}
          onClick={() => {
            onClose();
            onPick(world);
          }}
        >
          New {world.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** Where a keyboard-triggered menu goes when there is no pointer to put it under. */
const screenCentre = (): Anchor => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

export async function createSubBoard(
  nodeId: string,
  world: BoardTypeDefinition,
  name?: string,
): Promise<string | null> {
  return useStore.getState().expandIntoBoard(nodeId, {
    name,
    boardType: world.id as BoardType,
    label: world.label,
  });
}

/**
 * The drill-down gesture, shared by both canvases: a node that already has a
 * board inside opens it, and one that doesn't asks which kind to make first.
 * Render `picker` somewhere in the canvas; it is null until asked for.
 */
export function useDrillDown(): {
  drill: (nodeId: string, anchor?: Anchor) => void;
  picker: ReactNode;
} {
  const [pending, setPending] = useState<{ nodeId: string; anchor: Anchor } | null>(null);

  // No save first: leaving a board flushes it (`openBoard` in the store).
  const open = useCallback((boardId: string) => {
    // Drilling down stays inside the workspace you are already in (§5).
    navigate(boardHref(boardId));
  }, []);

  const drill = useCallback(
    (nodeId: string, anchor?: Anchor) => {
      const node = useStore.getState().nodes.find((n) => n.id === nodeId);
      const existing = node && isCard(node) ? node.data.childBoards?.[0] : undefined;
      if (existing) {
        void open(existing);
        return;
      }
      // Drilling into a node that has nothing inside it offers to *make* the
      // sub-board; on a board you are only viewing there is nothing to offer.
      if (useStore.getState().readonly) return;
      setPending({ nodeId, anchor: anchor ?? screenCentre() });
    },
    [open],
  );

  const picker = pending ? (
    <NewSubBoardMenu
      anchor={pending.anchor}
      onClose={() => setPending(null)}
      onPick={(world) => {
        setPending(null);
        void createSubBoard(pending.nodeId, world).then((childId) => {
          if (childId) void open(childId);
        });
      }}
    />
  ) : null;

  return { drill, picker };
}
