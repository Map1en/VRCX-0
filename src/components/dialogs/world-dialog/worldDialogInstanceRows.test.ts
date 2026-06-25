import { describe, expect, it } from 'vitest';

import { buildWorldDialogDisplayInstanceRows } from './worldDialogInstanceRows';

describe('worldDialogInstanceRows', () => {
    it('injects live current instance details and merges friends in the same instance', () => {
        const result = buildWorldDialogDisplayInstanceRows({
            creatorGroupsById: {
                grp_live: {
                    id: 'grp_live',
                    name: 'Live Group',
                    iconUrl: 'https://images.example/group.png'
                }
            },
            currentInstanceDetails: {
                location:
                    'wrld_test:live~group(grp_live)~groupAccessType(public)',
                instance: {
                    id: 'live~group(grp_live)~groupAccessType(public)',
                    userCount: 2,
                    capacity: 12,
                    groupId: 'grp_live',
                    users: [{ id: 'usr_inside', displayName: 'Inside' }]
                },
                ownerGroup: {
                    id: 'grp_live',
                    name: 'Runtime Group'
                }
            },
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    location:
                        'wrld_test:live~group(grp_live)~groupAccessType(public)'
                },
                usr_elsewhere: {
                    id: 'usr_elsewhere',
                    displayName: 'Elsewhere',
                    location: 'wrld_other:1'
                }
            },
            instanceRows: [
                {
                    id: 'public',
                    location: 'wrld_test:public',
                    occupants: 1,
                    users: []
                }
            ],
            isInstanceLocation: true,
            normalizedWorldId:
                'wrld_test:live~group(grp_live)~groupAccessType(public)',
            world: {
                id: 'wrld_test',
                capacity: 40
            },
            worldDialogShortName: 'live-short'
        });

        expect(result.creatorGroupKey).toBe('grp_live');
        expect(result.displayInstanceRows[0]).toMatchObject({
            id: 'live~group(grp_live)~groupAccessType(public)',
            location: 'wrld_test:live~group(grp_live)~groupAccessType(public)',
            shortName: 'live-short',
            occupants: 2,
            playerCount: 2,
            capacity: 12,
            creatorGroupId: 'grp_live',
            creatorGroup: {
                id: 'grp_live',
                name: 'Live Group'
            }
        });
        expect(
            result.displayInstanceRows[0].users.map((user: any) => user.id)
        ).toEqual(['usr_inside', 'usr_friend']);
        expect(result.displayInstanceRows[1]).toMatchObject({
            id: 'public',
            location: 'wrld_test:public'
        });
    });
});
