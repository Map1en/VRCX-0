import { describe, expect, it } from 'vitest';

import {
    buildInstanceRosterRows,
    mergeInstanceUser,
    mergeInstanceUsers,
    type InstanceRosterRow,
    userHasExplicitSameInstance
} from './instanceRoster';

describe('instanceRoster', () => {
    it('keeps a user owner first and does not duplicate the owner row', () => {
        const roster = buildInstanceRosterRows({
            instanceCreatorLabel: 'Creator',
            ownerUser: {
                id: 'usr_owner',
                displayName: 'Owner'
            },
            parsedLocation: {
                isRealInstance: true,
                userId: 'usr_owner'
            },
            users: [
                {
                    id: 'usr_friend',
                    displayName: 'Friend'
                },
                {
                    id: 'usr_owner',
                    displayName: 'Owner duplicate'
                }
            ]
        });

        expect(roster.ownerId).toBe('usr_owner');
        expect(roster.ownerIsGroup).toBe(false);
        expect(roster.rows.map((row) => row.id)).toEqual([
            'usr_owner',
            'usr_friend'
        ]);
        expect(roster.rows[0].$subtitle).toBe('Creator');
    });

    it('tracks group owners without inserting them into the user list', () => {
        const roster = buildInstanceRosterRows({
            ownerFallbackId: 'grp_owner',
            ownerGroup: {
                id: 'grp_owner',
                name: 'Group Owner'
            },
            parsedLocation: {
                isRealInstance: true,
                groupId: 'grp_owner'
            },
            users: [
                {
                    id: 'usr_friend',
                    displayName: 'Friend'
                }
            ]
        });

        expect(roster.ownerId).toBe('grp_owner');
        expect(roster.ownerIsGroup).toBe(true);
        expect(roster.rows.map((row) => row.id)).toEqual(['usr_friend']);
    });

    it('merges duplicate user rows while preserving richer existing data', () => {
        const users = mergeInstanceUsers(
            [
                {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    profilePicOverrideThumbnail: 'avatar.webp',
                    status: 'ask me'
                }
            ],
            [
                {
                    id: 'usr_friend',
                    displayName: 'Friend latest',
                    locationAt: '2026-01-01T00:00:00.000Z'
                }
            ]
        );

        expect(users).toHaveLength(1);
        expect(users[0].displayName).toBe('Friend');
        expect(users[0].profilePicOverrideThumbnail).toBe('avatar.webp');
        expect(users[0].status).toBe('ask me');
        expect(users[0].$location_at).toBe('2026-01-01T00:00:00.000Z');
    });

    it('allows a realtime snapshot to replace only existing presence fields', () => {
        const rows = new Map<string, InstanceRosterRow>();
        mergeInstanceUser(rows, {
            id: 'usr_self',
            displayName: 'Full profile name',
            profilePicOverrideThumbnail: 'profile.webp',
            location: 'wrld_old:11111',
            state: 'offline',
            stateBucket: 'offline',
            status: 'busy',
            statusDescription: 'Old description'
        });
        mergeInstanceUser(
            rows,
            {
                id: 'usr_self',
                displayName: 'Snapshot name',
                location: 'wrld_live:22222',
                state: 'online',
                stateBucket: 'online',
                status: 'join me',
                statusDescription: ''
            },
            {},
            { incomingPresenceWins: true }
        );

        expect(rows.get('usr_self')).toMatchObject({
            displayName: 'Full profile name',
            profilePicOverrideThumbnail: 'profile.webp',
            location: 'wrld_live:22222',
            state: 'online',
            stateBucket: 'online',
            status: 'join me',
            statusDescription: ''
        });
    });

    it('recognizes ask me and busy users only when their real instance is explicit', () => {
        const location = 'wrld_test:12345~hidden(usr_owner)';

        expect(
            userHasExplicitSameInstance(
                {
                    id: 'usr_ask',
                    status: 'ask me',
                    location
                },
                location
            )
        ).toBe(true);
        expect(
            userHasExplicitSameInstance(
                {
                    id: 'usr_busy',
                    status: 'busy',
                    location
                },
                location
            )
        ).toBe(true);
        expect(
            userHasExplicitSameInstance(
                {
                    id: 'usr_private',
                    status: 'busy',
                    location: 'private'
                },
                location
            )
        ).toBe(false);
    });
});
