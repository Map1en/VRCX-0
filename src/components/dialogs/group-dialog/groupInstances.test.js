import { describe, expect, it } from 'vitest';

import {
    instanceLocation,
    mergeGroupInstances,
    normalizeEntityId,
    normalizeLocation,
    userGroupLocation
} from './groupInstances.js';

describe('groupInstances', () => {
    it('normalizes ids and locations for group instance rows', () => {
        expect(normalizeEntityId('  grp_test  ')).toBe('grp_test');
        expect(normalizeEntityId(null)).toBe('');
        expect(normalizeLocation(' offline ')).toBe('');
        expect(normalizeLocation('private')).toBe('');
        expect(normalizeLocation('wrld_1:2')).toBe('wrld_1:2');
        expect(
            userGroupLocation({
                location: 'traveling',
                travelingToLocation: 'wrld_2:1~group(grp_target)'
            })
        ).toBe('wrld_2:1~group(grp_target)');
        expect(
            instanceLocation({
                worldId: 'wrld_fallback',
                instanceId: 'fallback~group(grp_target)'
            })
        ).toBe('wrld_fallback:fallback~group(grp_target)');
    });

    it('merges base instances with friends and the current user for the target group only', () => {
        const currentLocation = 'wrld_current:current~group(grp_target)';
        const rows = mergeGroupInstances(
            [
                {
                    id: 'base',
                    location: 'wrld_base:base~group(grp_target)',
                    userCount: 3,
                    users: [{ id: 'usr_existing', displayName: 'Existing' }]
                }
            ],
            {
                groupId: 'grp_target',
                currentLocation,
                currentUserSnapshot: {
                    id: 'usr_self',
                    displayName: 'Self',
                    location: currentLocation
                },
                friendsById: {
                    usr_existing: {
                        id: 'usr_existing',
                        displayName: 'Existing Duplicate',
                        location: 'wrld_base:base~group(grp_target)'
                    },
                    usr_friend: {
                        id: 'usr_friend',
                        displayName: 'Friend',
                        location: 'wrld_base:base~group(grp_target)'
                    },
                    usr_traveling: {
                        id: 'usr_traveling',
                        displayName: 'Traveling',
                        location: 'traveling',
                        travelingToLocation: currentLocation
                    },
                    usr_wrong_group: {
                        id: 'usr_wrong_group',
                        displayName: 'Wrong Group',
                        location: 'wrld_wrong:1~group(grp_other)'
                    }
                }
            }
        );

        expect(rows.map((row) => row.location)).toEqual([
            currentLocation,
            'wrld_base:base~group(grp_target)'
        ]);
        expect(rows[0]).toMatchObject({
            worldId: 'wrld_current',
            instanceId: 'current~group(grp_target)',
            friendCount: 1
        });
        expect(rows[0].users.map((user) => user.id)).toEqual([
            'usr_self',
            'usr_traveling'
        ]);
        expect(rows[1].users.map((user) => user.id)).toEqual([
            'usr_existing',
            'usr_friend'
        ]);
        expect(rows[1].friendCount).toBe(3);
        expect(
            rows.some((row) =>
                row.users.some((user) => user.id === 'usr_wrong_group')
            )
        ).toBe(false);
    });

    it('sorts non-current rows by user count and keeps users display-name sorted', () => {
        const rows = mergeGroupInstances(
            [
                {
                    location: 'wrld_small:1~group(grp_target)',
                    users: [{ id: 'usr_z', displayName: 'Zed' }]
                },
                {
                    location: 'wrld_big:1~group(grp_target)',
                    users: [
                        { id: 'usr_b', displayName: 'Beta' },
                        { id: 'usr_a', displayName: 'Alpha' }
                    ]
                }
            ],
            {
                groupId: 'grp_target',
                currentLocation: '',
                currentUserSnapshot: null,
                friendsById: {}
            }
        );

        expect(rows.map((row) => row.location)).toEqual([
            'wrld_big:1~group(grp_target)',
            'wrld_small:1~group(grp_target)'
        ]);
        expect(rows[0].users.map((user) => user.displayName)).toEqual([
            'Alpha',
            'Beta'
        ]);
    });

    it('keeps existing users and counts when duplicate base instances merge', () => {
        const location = 'wrld_dup:1~group(grp_target)';
        const explicitRef = { source: 'repository' };
        const rows = mergeGroupInstances(
            [
                {
                    id: 'first',
                    location,
                    userCount: 4,
                    users: [{ id: 'usr_first', displayName: 'First' }]
                },
                {
                    id: 'second',
                    tag: location,
                    worldId: 'wrld_dup_override',
                    ref: explicitRef,
                    users: [{ id: 'usr_second', displayName: 'Second' }]
                }
            ],
            {
                groupId: 'grp_target',
                currentLocation: '',
                currentUserSnapshot: null,
                friendsById: {
                    bad: null
                }
            }
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            id: 'second',
            location,
            tag: location,
            worldId: 'wrld_dup_override',
            friendCount: 4,
            ref: explicitRef
        });
        expect(rows[0].users.map((user) => user.id)).toEqual(['usr_first']);
    });
});
