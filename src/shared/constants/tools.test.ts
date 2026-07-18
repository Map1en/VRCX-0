import { DatabaseBackupIcon } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';

import {
    getToolsByCategory,
    knownToolKeys,
    toolCategories,
    toolDefinitionMap,
    toolNavDefinitions
} from './tools';

describe('tool catalog categories', () => {
    it('uses the intended category order and tool grouping', () => {
        expect(toolCategories.map((category) => category.key)).toEqual([
            'image',
            'shortcuts',
            'social',
            'vrchat',
            'data',
            'debug',
            'other'
        ]);
        expect(
            Object.fromEntries(
                toolCategories.map((category) => [
                    category.key,
                    getToolsByCategory(category.key).map((tool) => tool.key)
                ])
            )
        ).toEqual({
            image: ['screenshot-metadata', 'gallery', 'inventory'],
            shortcuts: [
                'vrc-photos',
                'steam-screenshots',
                'vrcx-data',
                'vrchat-data',
                'crash-dumps'
            ],
            social: [
                'presence-schedule',
                'presence-room-rules',
                'presence-invite-requests',
                'group-calendar',
                'edit-invite-message'
            ],
            vrchat: ['vrchat-config', 'launch-options', 'app-launcher'],
            data: [
                'profile-backup',
                'registry-backup',
                'discord-names',
                'export-notes',
                'export-friend-list',
                'export-own-avatars'
            ],
            debug: ['vrchat-log'],
            other: ['llm-endpoints']
        });
    });
});

describe('profile backup tool', () => {
    it('opens the dedicated backup dialog from the data catalog', () => {
        const tool = toolDefinitionMap.get('profile-backup');

        expect(tool).toMatchObject({
            category: 'data',
            titleKey: 'profile_backup.header',
            descriptionKey: 'profile_backup.tools_description',
            navEligible: true,
            action: {
                type: 'dialog',
                dialogKey: 'profile-backup'
            }
        });
        expect(knownToolKeys.has('profile-backup')).toBe(true);
        expect(
            toolNavDefinitions.some(
                (definition) => definition.key === 'tool-profile-backup'
            )
        ).toBe(true);
        expect(getNavIconComponent(tool?.navIcon)).toBe(DatabaseBackupIcon);
    });
});
