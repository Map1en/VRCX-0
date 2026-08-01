import { beforeEach, describe, expect, it } from 'vitest';

import type { AuthenticatedRuntimePhaseSnapshot } from '@/platform/tauri/bindings';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    applyAuthenticatedRuntimePhaseSnapshot,
    handleAuthenticatedRuntimeRealtimeStatus,
    resetAuthenticatedRuntimeMirror
} from './authenticatedRuntimeService';

function phaseSnapshot(
    patch: Partial<AuthenticatedRuntimePhaseSnapshot> = {}
): AuthenticatedRuntimePhaseSnapshot {
    return {
        runId: 7,
        authScopeGeneration: 3,
        userId: 'usr_self',
        endpoint: 'https://api.example.test/api/1',
        websocket: 'wss://pipeline.example.test',
        phase: 'ready',
        friends: {
            status: 'ready',
            attempt: 1,
            retryDelaySeconds: null,
            detail: 'Friends ready.',
            lastError: null
        },
        favorites: {
            status: 'ready',
            attempt: 1,
            retryDelaySeconds: null,
            detail: 'Favorites ready.',
            lastError: null
        },
        realtime: {
            status: 'ready',
            attempt: 1,
            retryDelaySeconds: null,
            detail: 'Realtime ready.',
            lastError: null
        },
        friendBaselineRevision: 1,
        friendBaseline: {
            userId: 'usr_self',
            stale: false,
            count: 1,
            detail: 'Friends ready.',
            snapshot: {
                friendsById: {
                    usr_friend: {
                        id: 'usr_friend',
                        displayName: 'Friend',
                        state: 'online'
                    }
                },
                orderedFriendIds: ['usr_friend'],
                onlineIds: ['usr_friend'],
                activeIds: [],
                offlineIds: []
            },
            friendLogChanged: false
        },
        favoritesBaseline: {
            userId: 'usr_self',
            stale: false,
            count: 1,
            snapshot: {
                currentUserId: 'usr_self',
                favoriteLimits: {},
                remoteFavoritesById: {},
                remoteFavoritesByObjectId: {},
                favoritesSortOrder: [],
                favoriteFriendIds: ['usr_friend'],
                groupedFavoriteFriendIdsByGroupKey: {},
                favoriteWorldIds: [],
                groupedFavoriteWorldIdsByGroupKey: {},
                favoriteAvatarIds: [],
                cachedFavoriteGroupsById: {},
                favoriteFriendGroups: [],
                favoriteWorldGroups: [],
                favoriteAvatarGroups: [],
                localWorldFavorites: {},
                localAvatarFavorites: {},
                localFriendFavorites: {
                    Favorites: ['usr_friend']
                },
                localWorldFavoriteGroups: [],
                localAvatarFavoriteGroups: [],
                localFriendFavoriteGroups: ['Favorites'],
                localWorldFavoritesList: [],
                localAvatarFavoritesList: [],
                localFriendFavoritesList: ['usr_friend'],
                localWorldDetailsById: {},
                localAvatarDetailsById: {},
                detail: 'Favorites ready.'
            }
        },
        realtimeTransport: {
            generation: 11,
            clientRunId: 7,
            sessionGeneration: 4
        },
        updatedAt: '2026-07-17T00:00:00.000Z',
        ...patch
    };
}

describe('authenticatedRuntimeService', () => {
    beforeEach(() => {
        resetAuthenticatedRuntimeMirror();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        useFriendRosterStore.getState().resetRoster();
        useFavoriteStore.getState().resetFavorites();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test/api/1',
            currentUserWebsocket: 'wss://pipeline.example.test',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self'
            }
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            sessionPhase: 'ready'
        });
    });

    it('hydrates friend, favorite, and connected transport mirrors from a ready phase', () => {
        applyAuthenticatedRuntimePhaseSnapshot(phaseSnapshot());

        expect(useSessionStore.getState()).toMatchObject({
            isFriendsLoaded: true,
            isFavoritesLoaded: true,
            transportStatus: 'pipeline-connected'
        });
        expect(useRuntimeStore.getState().transport.websocketConnected).toBe(
            true
        );
        expect(
            useFriendRosterStore.getState().friendsById.usr_friend?.displayName
        ).toBe('Friend');
        expect(useFavoriteStore.getState().currentUserId).toBe('usr_self');
    });

    it('applies a newer friend baseline revision within the same runtime run', () => {
        applyAuthenticatedRuntimePhaseSnapshot(phaseSnapshot());

        applyAuthenticatedRuntimePhaseSnapshot(
            phaseSnapshot({
                friendBaselineRevision: 2,
                friendBaseline: {
                    userId: 'usr_self',
                    stale: false,
                    count: 1,
                    detail: 'Friends reloaded.',
                    snapshot: {
                        friendsById: {
                            usr_reloaded: {
                                id: 'usr_reloaded',
                                displayName: 'Reloaded Friend',
                                state: 'online'
                            }
                        },
                        orderedFriendIds: ['usr_reloaded'],
                        onlineIds: ['usr_reloaded'],
                        activeIds: [],
                        offlineIds: []
                    },
                    friendLogChanged: false
                }
            })
        );

        expect(
            Object.keys(useFriendRosterStore.getState().friendsById)
        ).toEqual(['usr_reloaded']);
        expect(
            useFriendRosterStore.getState().friendsById.usr_reloaded
                ?.displayName
        ).toBe('Reloaded Friend');

        applyAuthenticatedRuntimePhaseSnapshot(phaseSnapshot());
        expect(
            Object.keys(useFriendRosterStore.getState().friendsById)
        ).toEqual(['usr_reloaded']);
    });

    it('ignores a phase snapshot for another authenticated user', () => {
        applyAuthenticatedRuntimePhaseSnapshot(
            phaseSnapshot({ userId: 'usr_other' })
        );

        expect(useSessionStore.getState().isFriendsLoaded).toBe(false);
        expect(useSessionStore.getState().isFavoritesLoaded).toBe(false);
    });

    it('does not let another user snapshot block the current session', () => {
        applyAuthenticatedRuntimePhaseSnapshot(
            phaseSnapshot({ runId: 8, userId: 'usr_other' })
        );
        applyAuthenticatedRuntimePhaseSnapshot(phaseSnapshot());

        expect(useSessionStore.getState().isFriendsLoaded).toBe(true);
        expect(useSessionStore.getState().isFavoritesLoaded).toBe(true);
    });

    it('ignores a phase snapshot for another websocket owner', () => {
        applyAuthenticatedRuntimePhaseSnapshot(
            phaseSnapshot({ websocket: 'wss://other.example.test' })
        );

        expect(useSessionStore.getState().isFriendsLoaded).toBe(false);
        expect(useSessionStore.getState().isFavoritesLoaded).toBe(false);
    });

    it('replays an early realtime status after the transport phase arrives', () => {
        applyAuthenticatedRuntimePhaseSnapshot(
            phaseSnapshot({
                phase: 'starting',
                realtime: {
                    status: 'running',
                    attempt: 1,
                    retryDelaySeconds: null,
                    detail: 'Realtime is starting.',
                    lastError: null
                },
                realtimeTransport: null
            })
        );
        handleAuthenticatedRuntimeRealtimeStatus({
            status: 'connected',
            websocketDomain: 'wss://pipeline.example.test',
            at: '2026-07-17T00:00:01.000Z',
            clientRunId: 7,
            generation: 11,
            sessionGeneration: 4,
            reason: null,
            statusCode: null
        });

        expect(useSessionStore.getState().transportStatus).toBe(
            'pipeline-connecting'
        );

        applyAuthenticatedRuntimePhaseSnapshot(phaseSnapshot());

        expect(useSessionStore.getState().transportStatus).toBe(
            'pipeline-connected'
        );
        expect(useRuntimeStore.getState().transport.websocketConnected).toBe(
            true
        );
    });

    it('accepts realtime status only for the active transport generation', () => {
        applyAuthenticatedRuntimePhaseSnapshot(phaseSnapshot());

        handleAuthenticatedRuntimeRealtimeStatus({
            status: 'connected',
            websocketDomain: 'wss://pipeline.example.test',
            at: '2026-07-17T00:00:01.000Z',
            clientRunId: 7,
            generation: 10,
            sessionGeneration: 4,
            reason: null,
            statusCode: null
        });
        expect(useSessionStore.getState().transportStatus).toBe(
            'pipeline-connected'
        );

        handleAuthenticatedRuntimeRealtimeStatus({
            status: 'connected',
            websocketDomain: 'wss://pipeline.example.test',
            at: '2026-07-17T00:00:01.500Z',
            clientRunId: 8,
            generation: 11,
            sessionGeneration: 4,
            reason: null,
            statusCode: null
        });
        expect(useSessionStore.getState().transportStatus).toBe(
            'pipeline-connected'
        );

        handleAuthenticatedRuntimeRealtimeStatus({
            status: 'connected',
            websocketDomain: 'wss://pipeline.example.test',
            at: '2026-07-17T00:00:01.750Z',
            clientRunId: 7,
            generation: 11,
            sessionGeneration: 5,
            reason: null,
            statusCode: null
        });
        expect(useSessionStore.getState().transportStatus).toBe(
            'pipeline-connected'
        );

        handleAuthenticatedRuntimeRealtimeStatus({
            status: 'connected',
            websocketDomain: 'wss://pipeline.example.test',
            at: '2026-07-17T00:00:02.000Z',
            clientRunId: 7,
            generation: 11,
            sessionGeneration: 4,
            reason: null,
            statusCode: null
        });
        expect(useSessionStore.getState().transportStatus).toBe(
            'pipeline-connected'
        );
        expect(useRuntimeStore.getState().transport.websocketConnected).toBe(
            true
        );
    });

    it('buffers a future transport generation until its same-run snapshot arrives', () => {
        applyAuthenticatedRuntimePhaseSnapshot(phaseSnapshot());
        handleAuthenticatedRuntimeRealtimeStatus({
            status: 'error',
            websocketDomain: 'wss://pipeline.example.test',
            at: '2026-07-17T00:00:01.000Z',
            clientRunId: 7,
            generation: 11,
            sessionGeneration: 4,
            reason: 'connection lost',
            statusCode: null
        });
        handleAuthenticatedRuntimeRealtimeStatus({
            status: 'connected',
            websocketDomain: 'wss://pipeline.example.test',
            at: '2026-07-17T00:00:02.000Z',
            clientRunId: 7,
            generation: 12,
            sessionGeneration: 5,
            reason: null,
            statusCode: null
        });

        expect(useSessionStore.getState().transportStatus).toBe(
            'pipeline-error'
        );

        applyAuthenticatedRuntimePhaseSnapshot(
            phaseSnapshot({
                realtimeTransport: {
                    generation: 12,
                    clientRunId: 7,
                    sessionGeneration: 5
                },
                updatedAt: '2026-07-17T00:00:03.000Z'
            })
        );

        expect(useSessionStore.getState().transportStatus).toBe(
            'pipeline-connected'
        );
        expect(useRuntimeStore.getState().transport.websocketConnected).toBe(
            true
        );
    });

    it('shows a new same-run transport attempt as connecting', () => {
        applyAuthenticatedRuntimePhaseSnapshot(phaseSnapshot());
        handleAuthenticatedRuntimeRealtimeStatus({
            status: 'error',
            websocketDomain: 'wss://pipeline.example.test',
            at: '2026-07-17T00:00:01.000Z',
            clientRunId: 7,
            generation: 11,
            sessionGeneration: 4,
            reason: 'connection lost',
            statusCode: null
        });

        applyAuthenticatedRuntimePhaseSnapshot(
            phaseSnapshot({
                phase: 'starting',
                realtime: {
                    status: 'running',
                    attempt: 2,
                    retryDelaySeconds: null,
                    detail: 'Realtime is starting.',
                    lastError: null
                },
                realtimeTransport: null,
                updatedAt: '2026-07-17T00:00:02.000Z'
            })
        );

        expect(useSessionStore.getState().transportStatus).toBe(
            'pipeline-connecting'
        );
    });

    it('clears the transport mirror when the runtime stops', () => {
        applyAuthenticatedRuntimePhaseSnapshot(phaseSnapshot());
        handleAuthenticatedRuntimeRealtimeStatus({
            status: 'connected',
            websocketDomain: 'wss://pipeline.example.test',
            at: '2026-07-17T00:00:02.000Z',
            clientRunId: 7,
            generation: 11,
            sessionGeneration: 4,
            reason: null,
            statusCode: null
        });

        applyAuthenticatedRuntimePhaseSnapshot(
            phaseSnapshot({
                runId: 8,
                phase: 'stopped',
                realtimeTransport: null
            })
        );

        expect(useSessionStore.getState().transportStatus).toBe('disconnected');
        expect(useRuntimeStore.getState().transport.websocketConnected).toBe(
            false
        );
    });

    it('keeps a terminal realtime failure visible after the transport is cleared', () => {
        applyAuthenticatedRuntimePhaseSnapshot(phaseSnapshot());
        handleAuthenticatedRuntimeRealtimeStatus({
            status: 'connected',
            websocketDomain: 'wss://pipeline.example.test',
            at: '2026-07-17T00:00:02.000Z',
            clientRunId: 7,
            generation: 11,
            sessionGeneration: 4,
            reason: null,
            statusCode: null
        });

        applyAuthenticatedRuntimePhaseSnapshot(
            phaseSnapshot({
                phase: 'error',
                realtime: {
                    status: 'failed',
                    attempt: 1,
                    retryDelaySeconds: null,
                    detail: 'Realtime transport terminated.',
                    lastError: 'Forbidden (status 403)'
                },
                realtimeTransport: null
            })
        );

        expect(useSessionStore.getState().transportStatus).toBe(
            'pipeline-error'
        );
        expect(useRuntimeStore.getState().transport.websocketConnected).toBe(
            false
        );
    });
});
