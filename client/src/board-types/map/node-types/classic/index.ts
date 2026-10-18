import type { NodeTypeDefinition } from '@/board-types/types';
import { CardContent } from './CardContent';
import { DataTab } from './DataTab';
import { NotesTab } from './NotesTab';
import { OverviewTab } from './OverviewTab';
import { SettingsTab } from './SettingsTab';

/** The map's only node type so far: the v1.3 card, unchanged. */
export const classicNodeType: NodeTypeDefinition = {
  id: 'classic',
  label: 'Classic',
  tabs: [
    { id: 'overview', label: 'Overview', component: OverviewTab },
    { id: 'notes', label: 'Notes', component: NotesTab, dot: (c) => !!c.body.trim() },
    { id: 'data', label: 'Data', component: DataTab, dot: (c) => !!c.data },
    { id: 'settings', label: 'Settings', component: SettingsTab },
  ],
  CardContent,
};
