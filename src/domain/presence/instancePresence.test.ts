import { describe, expect, it } from 'vitest';

import {
    buildInstanceRosterModel,
    buildInstancePresenceFact,
    instancePresenceKey,
    type RosterUserRow
} from './instancePresence';

describe('instancePresence domain model', () => {
    it('keys only real instances by endpoint and normalized location', () => {
        expect(
            instancePresenceKey('api', 'wrld_test:12345~hidden(usr_owner)')
        ).toBe('api::wrld_test:12345~hidden(usr_owner)');
        expect(
            instancePresenceKey('api', 'wrld_test:12345~group(grp_owner)')
        ).toBe('api::wrld_test:12345~group(grp_owner)');
        expect(instancePresenceKey('api', 'private')).toBe('');
    });

    it('builds current instance presence from runtime players', () => {
        const presence = buildInstancePresenceFact({
            endpoint: 'api',
            location: 'wrld_test:12345~hidden(usr_owner)',
            source: 'gameRuntime',
            players: [
                {
                    userId: 'usr_friend',
                    displayName: 'Friend',
                    joinedAt: '2026-01-01T00:00:00.000Z'
                }
            ]
        });

        expect(presence?.locationKey).toBe('wrld_test:12345~hidden(usr_owner)');
        expect(presence?.userIds).toEqual(['usr_friend']);
        expect(presence?.playersById.usr_friend).toMatchObject({
            userId: 'usr_friend',
            displayName: 'Friend',
            joinedAt: '2026-01-01T00:00:00.000Z'
        });
    });

    it('merges roster rows from explicit same-instance evidence only', () => {
        const roster = buildInstanceRosterModel({
            location: 'wrld_test:12345~hidden(usr_owner)',
            ownerUser: {
                id: 'usr_owner',
                displayName: 'Owner'
            },
            currentUser: {
                id: 'usr_self',
                displayName: 'Self',
                location: 'wrld_test:12345~hidden(usr_owner)'
            },
            friends: [
                {
                    id: 'usr_ask',
                    displayName: 'Ask',
                    status: 'ask me',
                    location: 'wrld_test:12345~hidden(usr_owner)'
                },
                {
                    id: 'usr_busy_private',
                    displayName: 'Busy Private',
                    status: 'busy',
                    location: 'private'
                }
            ],
            instanceUsers: [
                {
                    id: 'usr_owner',
                    displayName: 'Owner duplicate'
                },
                {
                    id: 'usr_api',
                    displayName: 'API User'
                }
            ],
            playerSnapshot: {
                players: [
                    {
                        userId: 'usr_ask',
                        displayName: 'Ask snapshot',
                        joinedAt: '2026-01-01T00:00:00.000Z'
                    }
                ]
            },
            instanceCreatorLabel: 'Creator'
        });

        expect(roster.rows.map((row: RosterUserRow) => row.id)).toEqual([
            'usr_owner',
            'usr_self',
            'usr_ask',
            'usr_api'
        ]);
        expect(roster.rows[0].$subtitle).toBe('Creator');
        expect(
            roster.rows.some(
                (row: RosterUserRow) => row.id === 'usr_busy_private'
            )
        ).toBe(false);
        expect(roster.friendCount).toBe(1);
        expect(roster.playerCount).toBe(4);
    });

    it('keeps group owner metadata out of user rows', () => {
        const roster = buildInstanceRosterModel({
            location: 'wrld_test:12345~group(grp_owner)',
            ownerGroup: {
                id: 'grp_owner',
                name: 'Group Owner'
            },
            instanceUsers: [
                {
                    id: 'usr_friend',
                    displayName: 'Friend'
                }
            ]
        });

        expect(roster.ownerId).toBe('grp_owner');
        expect(roster.ownerIsGroup).toBe(true);
        expect(roster.rows.map((row: RosterUserRow) => row.id)).toEqual([
            'usr_friend'
        ]);
    });
});
