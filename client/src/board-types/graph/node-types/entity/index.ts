import type { NodeTypeDefinition } from '@/board-types/types';
import { EntityContent } from './EntityContent';
import { NotesTab } from './NotesTab';
import { OverviewTab } from './OverviewTab';
import { SettingsTab } from './SettingsTab';

/** The graph's only node type so far: a thing, its notes, its connections (§3.3). */
export const entityNodeType: NodeTypeDefinition = {
  id: 'entity',
  label: 'Entity',
  tabs: [
    { id: 'overview', label: 'Overview', component: OverviewTab },
    { id: 'notes', label: 'Notes', component: NotesTab, dot: (c) => !!c.body.trim() },
    { id: 'settings', label: 'Settings', component: SettingsTab },
  ],
  CardContent: EntityContent,
};
