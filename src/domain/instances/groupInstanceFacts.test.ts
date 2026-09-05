import { describe, expect, it } from 'vitest';

import type { GroupInstanceRecord } from '@/domain/entities/group';

import {
    groupInstanceGroupId,
    groupInstanceLocation,
    groupInstanceOccupancy,
    isOpenGroupInstance
} from './groupInstanceFacts';

describe('groupInstanceFacts', () => {
    it('reads wrapper-shaped group instance facts', () => {
        const instance = {
            group: { id: 'grp_test' },
            instance: {
                location: 'wrld_test:1~group(grp_test)',
                userCount: 0,
                capacity: 60
            }
        };

        expect(groupInstanceGroupId(instance)).toBe('grp_test');
        expect(groupInstanceLocation(instance)).toBe(
            'wrld_test:1~group(grp_test)'
        );
        expect(groupInstanceOccupancy(instance)).toEqual({
            userCount: 0,
            capacity: 60
        });
    });

    it('keeps unknown counts distinct from a known zero', () => {
        expect(groupInstanceOccupancy({ capacity: 60 })).toEqual({
            userCount: null,
            capacity: 60
        });
        expect(groupInstanceOccupancy({ userCount: 0, capacity: 60 })).toEqual({
            userCount: 0,
            capacity: 60
        });
        expect(
            groupInstanceOccupancy({
                userCount: '21',
                capacity: '70'
            } as unknown as GroupInstanceRecord)
        ).toEqual({
            userCount: 21,
            capacity: 70
        });
    });

    it('rejects explicitly closed or inactive wrapper and nested instances', () => {
        expect(isOpenGroupInstance({})).toBe(true);
        expect(isOpenGroupInstance({ active: false })).toBe(false);
        expect(isOpenGroupInstance({ closedAt: '2026-09-06T00:00:00Z' })).toBe(
            false
        );
        expect(isOpenGroupInstance({ instance: { active: false } })).toBe(
            false
        );
        expect(
            isOpenGroupInstance({
                instance: { closedAt: '2026-09-06T00:00:00Z' }
            })
        ).toBe(false);
    });
});
