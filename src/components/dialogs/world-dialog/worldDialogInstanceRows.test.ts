import { describe, expect, it } from 'vitest';

import { buildWorldDialogDisplayInstanceRows } from './worldDialogInstanceRows';

describe('worldDialogInstanceRows', () => {
    it('adds a friend instance that is absent from the searched world profile', () => {
        const result = buildWorldDialogDisplayInstanceRows({
            creatorGroupsById: {},
            currentInstanceDetails: {},
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    location:
                        'wrld_test:friends-room~friends(usr_owner)~region(jp)'
                },
                usr_roommate: {
                    id: 'usr_roommate',
                    displayName: 'Roommate',
                    location:
                        'wrld_test:friends-room~friends(usr_owner)~region(jp)'
                },
                usr_other_world: {
                    id: 'usr_other_world',
                    displayName: 'Elsewhere',
                    location: 'wrld_other:friends-room~friends(usr_owner)'
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
            isInstanceLocation: false,
            normalizedWorldId: 'wrld_test',
            world: {
                id: 'wrld_test',
                capacity: 40
            }
        });

        expect(result.displayInstanceRows).toHaveLength(2);
        expect(result.displayInstanceRows[1]).toMatchObject({
            id: 'friends-room~friends(usr_owner)~region(jp)',
            location: 'wrld_test:friends-room~friends(usr_owner)~region(jp)',
            creatorUserId: 'usr_owner'
        });
        expect(
            result.displayInstanceRows[1].users.map((user) => user.id)
        ).toEqual(['usr_friend', 'usr_roommate']);
    });

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
            currentLocation:
                'wrld_test:live~group(grp_live)~groupAccessType(public)&shortName=live-short',
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
            },
            isCurrentInstance: true
        });
        expect(
            result.displayInstanceRows[0].users.map((user) => user.id)
        ).toEqual(['usr_inside', 'usr_friend']);
        expect(result.displayInstanceRows[1]).toMatchObject({
            id: 'public',
            location: 'wrld_test:public',
            isCurrentInstance: false
        });
    });

    it('dedupes a player snapshot row against a friend row for the same user', () => {
        const result = buildWorldDialogDisplayInstanceRows({
            creatorGroupsById: {},
            currentInstanceDetails: {
                location:
                    'wrld_test:live~group(grp_live)~groupAccessType(public)',
                instance: {
                    id: 'live~group(grp_live)~groupAccessType(public)',
                    userCount: 1,
                    capacity: 12,
                    groupId: 'grp_live'
                },
                playerSnapshot: {
                    context: { playerCount: 1 },
                    players: [
                        {
                            id: 'id:usr_dup',
                            userId: 'usr_dup',
                            displayName: 'Dup',
                            joinedAt: '2024-01-01T00:00:00Z'
                        }
                    ]
                }
            },
            friendsById: {
                usr_dup: {
                    id: 'usr_dup',
                    displayName: 'Dup',
                    location:
                        'wrld_test:live~group(grp_live)~groupAccessType(public)'
                }
            },
            instanceRows: [],
            isInstanceLocation: true,
            normalizedWorldId:
                'wrld_test:live~group(grp_live)~groupAccessType(public)',
            world: {
                id: 'wrld_test',
                capacity: 40
            }
        });

        const users = result.displayInstanceRows[0].users;
        expect(users).toHaveLength(1);
        expect(users[0]).toMatchObject({
            id: 'usr_dup',
            userId: 'usr_dup',
            $location_at: '2024-01-01T00:00:00Z'
        });
    });

    it('restores name-only Busy and Ask Me friends in the current instance', () => {
        const location =
            'wrld_test:live~group(grp_live)~groupAccessType(public)';
        const result = buildWorldDialogDisplayInstanceRows({
            creatorGroupsById: {},
            currentInstanceDetails: {
                location,
                instance: {
                    id: 'live~group(grp_live)~groupAccessType(public)',
                    groupId: 'grp_live'
                },
                playerSnapshot: {
                    context: { playerCount: 2 },
                    players: [
                        { userId: '', displayName: 'Busy Friend' },
                        { userId: '', displayName: 'Ask Friend' }
                    ]
                }
            },
            friendsById: {
                usr_busy: {
                    id: 'usr_busy',
                    displayName: 'Busy Friend',
                    state: 'online',
                    status: 'busy',
                    location: 'private'
                },
                usr_ask: {
                    id: 'usr_ask',
                    displayName: 'Ask Friend',
                    state: 'online',
                    status: 'ask me',
                    location: 'private'
                }
            },
            instanceRows: [],
            isInstanceLocation: true,
            normalizedWorldId: location,
            world: {
                id: 'wrld_test',
                capacity: 40
            }
        });

        expect(
            result.displayInstanceRows[0].users.map((user) => user.id)
        ).toEqual(['usr_busy', 'usr_ask']);
    });

    it('removes an offline friend from stale instance and player snapshots', () => {
        const location = 'wrld_test:live';
        const result = buildWorldDialogDisplayInstanceRows({
            creatorGroupsById: {},
            currentInstanceDetails: {
                location,
                instance: {
                    id: 'live',
                    users: [
                        { id: 'usr_departed', displayName: 'Departed Friend' }
                    ]
                },
                playerSnapshot: {
                    context: { playerCount: 1 },
                    players: [
                        { id: 'usr_departed', displayName: 'Departed Friend' }
                    ]
                }
            },
            currentLocation: location,
            friendsById: {
                usr_departed: {
                    id: 'usr_departed',
                    state: 'offline',
                    stateBucket: 'offline',
                    location
                }
            },
            instanceRows: [],
            isInstanceLocation: true,
            normalizedWorldId: location,
            world: { id: 'wrld_test', capacity: 40 }
        });

        expect(result.displayInstanceRows[0].users).toEqual([]);
    });

    it('removes a stale instance row after the friend moves elsewhere', () => {
        const result = buildWorldDialogDisplayInstanceRows({
            creatorGroupsById: {},
            currentInstanceDetails: {},
            currentLocation: 'wrld_current:123',
            friendsById: {
                usr_departed: {
                    id: 'usr_departed',
                    state: 'online',
                    location: 'wrld_elsewhere:456'
                }
            },
            instanceRows: [
                {
                    id: '123',
                    location: 'wrld_current:123',
                    users: [
                        { id: 'usr_departed', displayName: 'Departed Friend' }
                    ]
                }
            ],
            isInstanceLocation: true,
            normalizedWorldId: 'wrld_current:123',
            world: { id: 'wrld_current', capacity: 40 }
        });

        expect(result.displayInstanceRows[0].users).toEqual([]);
    });
});
