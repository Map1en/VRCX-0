import { DatabaseBackupIcon } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';

import { knownToolKeys, toolDefinitionMap, toolNavDefinitions } from './tools';

describe('profile backup tool', () => {
    it('opens the dedicated backup dialog from the system tools catalog', () => {
        const tool = toolDefinitionMap.get('profile-backup');

        expect(tool).toMatchObject({
            category: 'system',
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
