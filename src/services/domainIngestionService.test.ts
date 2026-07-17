import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMock = vi.hoisted(() => ({
    commands: {
        appIngestUserFacts: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: tauriMock.commands }));

import { useInstancePresenceStore } from '@/state/instancePresenceStore';
import { useLocationHintStore } from '@/state/locationHintStore';

import {
    recordCurrentUserSnapshot,
    recordFriendPatch,
    recordGameRuntimePresence,
    recordLocationHintsFromInstances,
    recordKnownUser,
    resetDomainFacts
} from './domainIngestionService';

function ingestedEntryFor(userId: string, source?: string) {
    return tauriMock.commands.appIngestUserFacts.mock.calls
        .flatMap((call) => (Array.isArray(call[0]) ? call[0] : []))
        .filter(
            (entry: { user?: { id?: unknown }; source?: unknown }) =>
                entry?.user?.id === userId &&
                (source === undefined || entry?.source === source)
        )
        .at(-1);
}

describe('domainIngestionService', () => {
    beforeEach(() => {
        tauriMock.commands.appIngestUserFacts.mockReset();
        tauriMock.commands.appIngestUserFacts.mockResolvedValue(undefined);
        resetDomainFacts();
    });

    it('forwards current user and friend patch users to the Rust ingest IPC', () => {
        recordCurrentUserSnapshot(
            {
                id: 'usr_self',
                displayName: 'Self',
                isBoopingEnabled: false,
                location: 'private'
            },
            { endpoint: 'api' }
        );
        recordFriendPatch({
            endpoint: 'api',
            userId: 'usr_friend',
            stateBucket: 'online',
            patch: {
                displayName: 'Friend',
                location: 'wrld_live:123'
            }
        });

        expect(tauriMock.commands.appIngestUserFacts).toHaveBeenCalled();

        expect(ingestedEntryFor('usr_self')).toMatchObject({
            user: {
                id: 'usr_self',
                displayName: 'Self'
            },
            isCurrentUser: true
        });
        expect(ingestedEntryFor('usr_friend')).toMatchObject({
            user: {
                id: 'usr_friend',
                displayName: 'Friend',
                stateBucket: 'online',
                location: 'wrld_live:123'
            },
            source: 'realtime',
            isFriend: true,
            stateBucket: 'online'
        });
    });

    it('records game runtime presence without trusting API private location over it', () => {
        recordCurrentUserSnapshot(
            {
                id: 'usr_self',
                displayName: 'Self',
                location: 'private'
            },
            { endpoint: 'api' }
        );
        recordGameRuntimePresence({
            endpoint: 'api',
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self'
            },
            currentLocation: 'wrld_game:12345',
            currentLocationStartedAt: '2026-01-01T00:00:00.000Z',
            currentLocationPlayers: [
                {
                    userId: 'usr_friend',
                    displayName: 'Friend',
                    joinedAt: '2026-01-01T00:00:00.000Z'
                }
            ]
        });

        expect(ingestedEntryFor('usr_self', 'gameRuntime')).toMatchObject({
            user: {
                id: 'usr_self',
                location: 'wrld_game:12345'
            },
            source: 'gameRuntime',
            isCurrentUser: true
        });
        expect(
            useInstancePresenceStore.getState().presenceByKey[
                'api::wrld_game:12345'
            ].userIds
        ).toEqual(['usr_friend']);
    });

    it('normalizes player snapshot ids to the real user id and drops synthetic ids for anonymous players', () => {
        recordGameRuntimePresence({
            endpoint: 'api',
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self'
            },
            currentLocation: 'wrld_game:12345',
            currentLocationStartedAt: '2026-01-01T00:00:00.000Z',
            currentLocationPlayers: [
                {
                    id: 'id:usr_dup',
                    userId: 'usr_dup',
                    displayName: 'Dup',
                    joinedAt: '2026-01-01T00:00:00.000Z'
                },
                {
                    id: 'row:1',
                    displayName: 'Anon'
                }
            ]
        });

        expect(ingestedEntryFor('usr_dup', 'playerSnapshot')).toMatchObject({
            user: {
                id: 'usr_dup',
                userId: 'usr_dup',
                displayName: 'Dup'
            },
            source: 'playerSnapshot'
        });

        const ingestedIds = tauriMock.commands.appIngestUserFacts.mock.calls
            .flatMap((call) => (Array.isArray(call[0]) ? call[0] : []))
            .map((entry: { user?: { id?: unknown } }) => entry?.user?.id);
        expect(ingestedIds).not.toContain('row:1');
        expect(ingestedIds).not.toContain('id:usr_dup');
    });

    it('keeps traveling as a sentinel and does not record destination as current presence', () => {
        recordGameRuntimePresence({
            endpoint: 'api',
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self'
            },
            currentLocation: 'traveling:traveling',
            currentDestination: 'wrld_destination:12345',
            currentLocationStartedAt: '2026-01-01T00:00:00.000Z',
            currentLocationPlayers: [
                {
                    userId: 'usr_friend',
                    displayName: 'Friend'
                }
            ]
        });

        expect(ingestedEntryFor('usr_self', 'gameRuntime')).toMatchObject({
            user: {
                id: 'usr_self',
                location: 'traveling',
                travelingToLocation: 'wrld_destination:12345'
            },
            source: 'gameRuntime',
            isCurrentUser: true
        });
        expect(useInstancePresenceStore.getState().presenceByKey).toEqual({});
    });

    it('records instance display hints separately from full query data', () => {
        recordLocationHintsFromInstances({
            endpoint: 'api',
            instances: [
                {
                    location: 'wrld_test:12345~group(grp_test)',
                    worldName: 'World',
                    groupName: 'Group',
                    displayName: 'Instance',
                    closedAt: '2026-01-01T00:00:00.000Z',
                    users: [
                        {
                            id: 'usr_api',
                            displayName: 'API User'
                        }
                    ]
                }
            ]
        });

        expect(
            useLocationHintStore.getState().hintsByKey[
                'api::wrld_test:12345~group(grp_test)'
            ]
        ).toMatchObject({
            worldName: 'World',
            groupName: 'Group',
            instanceName: 'Instance',
            isClosed: true
        });
        expect(ingestedEntryFor('usr_api')).toMatchObject({
            user: {
                id: 'usr_api',
                displayName: 'API User'
            },
            source: 'instance'
        });
    });

    it('resets domain stores on auth boundaries', () => {
        recordKnownUser(
            {
                id: 'usr_test',
                displayName: 'User'
            },
            { endpoint: 'api', source: 'profile' }
        );
        recordLocationHintsFromInstances({
            endpoint: 'api',
            instances: [{ location: 'wrld_test:12345', worldName: 'World' }]
        });

        expect(ingestedEntryFor('usr_test')).toMatchObject({
            user: { id: 'usr_test', displayName: 'User' },
            source: 'profile'
        });

        resetDomainFacts();

        expect(useInstancePresenceStore.getState().presenceByKey).toEqual({});
        expect(useLocationHintStore.getState().hintsByKey).toEqual({});
    });
});
