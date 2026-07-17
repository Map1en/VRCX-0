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
                remoteFavoritesById: {},
                favoritesSortOrder: [],
                localFriendFavorites: {
                    Favorites: ['usr_friend']
                }
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

    it('hydrates friend, favorite, and transport mirrors from a ready phase', () => {
        applyAuthenticatedRuntimePhaseSnapshot(phaseSnapshot());

        expect(useSessionStore.getState()).toMatchObject({
            isFriendsLoaded: true,
            isFavoritesLoaded: true,
            transportStatus: 'pipeline-connecting'
        });
        expect(
            useFriendRosterStore.getState().friendsById.usr_friend?.displayName
        ).toBe('Friend');
        expect(useFavoriteStore.getState().currentUserId).toBe('usr_self');
    });

    it('ignores a phase snapshot for another authenticated user', () => {
        applyAuthenticatedRuntimePhaseSnapshot(
            phaseSnapshot({ userId: 'usr_other' })
        );

        expect(useSessionStore.getState().isFriendsLoaded).toBe(false);
        expect(useSessionStore.getState().isFavoritesLoaded).toBe(false);
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
            'pipeline-connecting'
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
            'pipeline-connecting'
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
            'pipeline-connecting'
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
});
