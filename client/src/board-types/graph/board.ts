import { Waypoints } from 'lucide-react';
import type { BoardTypeDefinition } from '@/board-types/types';
import { GraphCanvas } from './canvas';
import { graphNodeTypes } from './node-types';

/**
 * The graph world (§3): entities held apart by physics rather than placed by
 * hand. No data flow, no frames, no chips — an entity is already minimal — and
 * links are a first-class surface here rather than plain documentation (§3.3).
 * Nothing here is a path either, so the walkthrough sits this world out (§7.5).
 */
export const graphBoardType: BoardTypeDefinition = {
  id: 'graph',
  label: 'Graph',
  Icon: Waypoints,
  Canvas: GraphCanvas,
  emptyHint: 'or double-click anywhere to name the first entity.',
  ...graphNodeTypes,
  panelFlags: { walkthrough: false },
};
