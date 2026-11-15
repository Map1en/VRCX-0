import { describe, expect, it } from 'vitest';

import { offlinePresence, onlinePresence } from '@/test/presenceFixtures';

import {
    buildWorldDialogDisplayInstanceRows,
    worldDialogInstanceViewer
} from './worldDialogInstanceRows';

const anonymousViewer = { ageVerified: false, languages: [] };

describe('worldDialogInstanceRows', () => {
    it('adds a friend instance that is absent from the searched world profile', () => {
        const result = buildWorldDialogDisplayInstanceRows({
            creatorGroupsById: {},
            currentInstanceDetails: {},
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    $presence: onlinePresence(
                        'wrld_test:friends-room~friends(usr_owner)~region(jp)'
                    )
                },
                usr_roommate: {
                    id: 'usr_roommate',
                    displayName: 'Roommate',
                    $presence: onlinePresence(
                        'wrld_test:friends-room~friends(usr_owner)~region(jp)'
                    )
                },
                usr_other_world: {
                    id: 'usr_other_world',
                    displayName: 'Elsewhere',
                    $presence: onlinePresence(
                        'wrld_other:friends-room~friends(usr_owner)'
                    )
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
            viewer: anonymousViewer,
            isInstanceLocation: false,
            normalizedWorldId: 'wrld_test',
            world: {
                id: 'wrld_test',
                capacity: 40
            }
        });

        expect(result.displayInstanceRows).toHaveLength(2);
        expect(result.displayInstanceRows[0]).toMatchObject({
            id: 'friends-room~friends(usr_owner)~region(jp)',
            location: 'wrld_test:friends-room~friends(usr_owner)~region(jp)',
            creatorUserId: 'usr_owner'
        });
        expect(
            result.displayInstanceRows[0].users.map((user) => user.id)
        ).toEqual(['usr_friend', 'usr_roommate']);
    });

    it('lists the current instance first, then instances with more friends', () => {
        const friendIn = (id: string, location: string) => ({
            id,
            displayName: id,
            $presence: onlinePresence(location)
        });
        const result = buildWorldDialogDisplayInstanceRows({
            creatorGroupsById: {},
            currentInstanceDetails: {},
            currentLocation: 'wrld_test:current',
            friendsById: {
                usr_a: friendIn('usr_a', 'wrld_test:two'),
                usr_b: friendIn('usr_b', 'wrld_test:two'),
                usr_c: friendIn('usr_c', 'wrld_test:one')
            },
            instanceRows: [
                { id: 'empty', location: 'wrld_test:empty', users: [] },
                { id: 'one', location: 'wrld_test:one', users: [] },
                { id: 'current', location: 'wrld_test:current', users: [] },
                { id: 'quiet', location: 'wrld_test:quiet', users: [] },
                { id: 'two', location: 'wrld_test:two', users: [] }
            ],
            viewer: anonymousViewer,
            isInstanceLocation: false,
            normalizedWorldId: 'wrld_test',
            world: { id: 'wrld_test', capacity: 40 }
        });

        expect(
            result.displayInstanceRows.map((instance) => instance.id)
        ).toEqual(['current', 'two', 'one', 'empty', 'quiet']);
    });

    it('does not mark the opened instance as current without a local location', () => {
        const result = buildWorldDialogDisplayInstanceRows({
            creatorGroupsById: {},
            currentInstanceDetails: {},
            currentLocation: '',
            friendsById: {},
            instanceRows: [
                {
                    id: '123',
                    location: 'wrld_test:123',
                    users: []
                }
            ],
            viewer: anonymousViewer,
            isInstanceLocation: true,
            normalizedWorldId: 'wrld_test:123',
            world: { id: 'wrld_test', capacity: 40 }
        });

        expect(result.displayInstanceRows[0]?.isCurrentInstance).toBe(false);
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
                    $presence: onlinePresence(
                        'wrld_test:live~group(grp_live)~groupAccessType(public)'
                    )
                },
                usr_elsewhere: {
                    id: 'usr_elsewhere',
                    displayName: 'Elsewhere',
                    $presence: onlinePresence('wrld_other:1')
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
            viewer: anonymousViewer,
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
                    $presence: onlinePresence(
                        'wrld_test:live~group(grp_live)~groupAccessType(public)'
                    )
                }
            },
            instanceRows: [],
            viewer: anonymousViewer,
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
            joinedAt: '2024-01-01T00:00:00Z'
        });
        expect(users[0].$location_at).toBeUndefined();
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
                    status: 'busy',
                    $presence: onlinePresence('private')
                },
                usr_ask: {
                    id: 'usr_ask',
                    displayName: 'Ask Friend',
                    status: 'ask me',
                    $presence: onlinePresence('private')
                }
            },
            instanceRows: [],
            viewer: anonymousViewer,
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
                    $presence: offlinePresence
                }
            },
            instanceRows: [],
            viewer: anonymousViewer,
            isInstanceLocation: true,
            normalizedWorldId: location,
            world: { id: 'wrld_test', capacity: 40 }
        });

        expect(result.displayInstanceRows[0].users).toEqual([]);
    });

    it('drops a friend from a stale instance row after they move elsewhere', () => {
        const result = buildWorldDialogDisplayInstanceRows({
            creatorGroupsById: {},
            currentInstanceDetails: {},
            currentLocation: 'wrld_current:123',
            friendsById: {
                usr_departed: {
                    id: 'usr_departed',
                    $presence: onlinePresence('wrld_elsewhere:456')
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
            viewer: anonymousViewer,
            isInstanceLocation: true,
            normalizedWorldId: 'wrld_current:123',
            world: { id: 'wrld_current', capacity: 40 }
        });

        expect(result.displayInstanceRows[0].users).toEqual([]);
    });

    it('ranks joinable instances in the viewer language by listed population', () => {
        const result = buildWorldDialogDisplayInstanceRows({
            creatorGroupsById: {},
            currentInstanceDetails: {},
            friendsById: {},
            instanceRows: [
                {
                    id: 'small-en',
                    location: 'wrld_test:small-en',
                    n_users: 3,
                    languageRatio: { en: 1 },
                    users: []
                },
                {
                    id: 'big-en',
                    location: 'wrld_test:big-en',
                    n_users: 20,
                    languageRatio: { en: 0.9, ja: 0.1 },
                    users: []
                },
                {
                    id: 'mixed-ja',
                    location: 'wrld_test:mixed-ja',
                    n_users: 5,
                    languageRatio: { en: 0.6, ja: 0.4 },
                    users: []
                },
                {
                    id: 'zh',
                    location: 'wrld_test:zh',
                    n_users: 4,
                    languageRatio: { 'zh-CN': 0.75, en: 0.25 },
                    users: []
                },
                {
                    id: 'adult',
                    location: 'wrld_test:adult~ageGate',
                    n_users: 30,
                    languageRatio: { 'zh-CN': 1 },
                    users: []
                },
                {
                    id: 'full',
                    location: 'wrld_test:full',
                    n_users: 40,
                    languageRatio: { 'zh-CN': 1 },
                    users: []
                },
                {
                    id: 'unknown',
                    location: 'wrld_test:unknown',
                    n_users: 2,
                    users: []
                }
            ],
            isInstanceLocation: false,
            normalizedWorldId: 'wrld_test',
            viewer: worldDialogInstanceViewer({
                tags: ['system_trust_known', 'language_zho', 'language_jpn']
            }),
            world: { id: 'wrld_test', capacity: 40 }
        });

        expect(
            result.displayInstanceRows.map((instance) => instance.id)
        ).toEqual([
            'zh',
            'big-en',
            'mixed-ja',
            'small-en',
            'unknown',
            'full',
            'adult'
        ]);
    });

    it('keeps age-gated instances in place for an age-verified viewer', () => {
        const result = buildWorldDialogDisplayInstanceRows({
            creatorGroupsById: {},
            currentInstanceDetails: {},
            friendsById: {},
            instanceRows: [
                {
                    id: 'quiet',
                    location: 'wrld_test:quiet',
                    n_users: 2,
                    users: []
                },
                {
                    id: 'adult',
                    location: 'wrld_test:adult~ageGate',
                    n_users: 12,
                    users: []
                }
            ],
            isInstanceLocation: false,
            normalizedWorldId: 'wrld_test',
            viewer: worldDialogInstanceViewer({ ageVerified: true }),
            world: { id: 'wrld_test', capacity: 40 }
        });

        expect(
            result.displayInstanceRows.map((instance) => instance.id)
        ).toEqual(['adult', 'quiet']);
    });
});
