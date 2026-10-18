import { Map as MapIcon } from 'lucide-react';
import type { BoardTypeDefinition } from '@/board-types/types';
import { Canvas } from './canvas';
import { mapNodeTypes } from './node-types';

/** The world every board lived in before board types existed (§1). */
export const mapBoardType: BoardTypeDefinition = {
  id: 'map',
  label: 'Map',
  Icon: MapIcon,
  Canvas,
  emptyHint: 'or drag a tool off the pill.',
  ...mapNodeTypes,
  panelFlags: { walkthrough: true },
};
