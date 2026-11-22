import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import type { GroupDialogInstanceRow } from '@/domain/entities/group';

import { groupValueLabel } from './groupDialogUtils';
import { isGroupInstanceFull } from './GroupInstanceRows';

function instance(fields: Partial<GroupDialogInstanceRow>) {
    return { ref: {}, ...fields } as GroupDialogInstanceRow;
}

describe('isGroupInstanceFull', () => {
    it('treats rooms at capacity as full', () => {
        expect(
            isGroupInstanceFull(instance({ userCount: 2, capacity: 2 }))
        ).toBe(true);
        expect(
            isGroupInstanceFull(instance({ userCount: 1, capacity: 2 }))
        ).toBe(false);
    });
});

describe('groupValueLabel', () => {
    it('falls back to the raw value when no translation exists', () => {
        const t = ((key: string) => key) as unknown as TFunction;

        expect(groupValueLabel(t, 'privacy', 'default')).toBe('default');
        expect(groupValueLabel(t, 'privacy', '')).toBe('');
    });
});
