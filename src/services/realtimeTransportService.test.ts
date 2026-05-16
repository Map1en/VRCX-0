import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REALTIME_TRANSPORT_TEST_TIMEOUT_MS = 15_000;

const backendState = vi.hoisted(() => ({
    capabilities: {
        backendRealtimeTransport: true,
        ipc: false
    },
    app: {
        IPCAnnounceStart: vi.fn(),
        StartRealtimeTransport: vi.fn(),
        SyncRealtimeFriendSnapshot: vi.fn(),
        StopRealtimeTransport: vi.fn()
    },
    eventHandlers: new Map<string, Set<(payload: unknown) => void>>()
}));

vi.mock('@/platform/index.js', () => ({
    backend: {
        app: backendState.app,
        events: {
            subscribe: vi.fn(
                async (name: string, handler: (payload: unknown) => void) => {
                    let bucket = backendState.eventHandlers.get(name);
                    if (!bucket) {
                        bucket = new Set();
                        backendState.eventHandlers.set(name, bucket);
                    }
                    bucket.add(handler);
                    return () => {
                        bucket?.delete(handler);
                    };
                }
            )
        }
    }
}));

vi.mock('./hostCapabilityService.js', () => ({
    isHostCapabilityAvailable: vi.fn((key: string) =>
        Boolean(backendState.capabilities[key])
    )
}));

const presenceState = vi.hoisted(() => ({
    handleRealtimeFriendProjection: vi.fn(),
    handleRealtimeNotificationProjection: vi.fn(),
    handleRealtimeCurrentUserProjection: vi.fn(),
    handleRealtimeInstanceClosedProjection: vi.fn()
}));

const authRecoveryState = vi.hoisted(() => ({
    handleRuntimeAuthFailure: vi.fn()
}));

const backgroundState = vi.hoisted(() => ({
    refreshFriendAndFavoriteSnapshots: vi.fn(async () => undefined)
}));

vi.mock('./realtimePresenceService.js', () => ({
    handleRealtimeFriendProjection:
        presenceState.handleRealtimeFriendProjection,
    handleRealtimeNotificationProjection:
        presenceState.handleRealtimeNotificationProjection,
    handleRealtimeCurrentUserProjection:
        presenceState.handleRealtimeCurrentUserProjection,
    handleRealtimeInstanceClosedProjection:
        presenceState.handleRealtimeInstanceClosedProjection
}));

vi.mock('./authSessionRecoveryService.js', () => ({
    handleRuntimeAuthFailure: authRecoveryState.handleRuntimeAuthFailure
}));

vi.mock('./backgroundMaintenanceService.js', () => ({
    refreshFriendAndFavoriteSnapshots:
        backgroundState.refreshFriendAndFavoriteSnapshots
}));

function emitBackendEvent(name: string, payload: unknown) {
    const bucket = backendState.eventHandlers.get(name);
    for (const handler of bucket ?? []) {
        handler(payload);
    }
}

async function prepareReadySession(websocket = '') {
    const { useFriendRosterStore } =
        await import('@/state/friendRosterStore.js');
    const { useRuntimeStore } = await import('@/state/runtimeStore.js');
    const { useSessionStore } = await import('@/state/sessionStore.js');

    useRuntimeStore.getState().resetRuntimeState();
    useFriendRosterStore.getState().resetRoster();
    useFriendRosterStore.getState().setRosterSnapshot({
        currentUserId: 'usr_1',
        friendsById: {
            usr_2: {
                id: 'usr_2',
                displayName: 'Friend',
                stateBucket: 'offline'
            }
        },
        orderedFriendIds: ['usr_2'],
        onlineIds: [],
        activeIds: [],
        offlineIds: ['usr_2']
    });
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: 'usr_1',
        currentUserEndpoint: '',
        currentUserWebsocket: websocket,
        currentUserSnapshot: { id: 'usr_1' }
    });
    useSessionStore.getState().setSessionState({
        isLoggedIn: true,
        isFriendsLoaded: true,
        sessionPhase: 'ready'
    });
}

describe('realtime transport backend routing', () => {
    beforeEach(() => {
        vi.resetModules();
        backendState.capabilities.backendRealtimeTransport = true;
        backendState.capabilities.ipc = false;
        backendState.app.IPCAnnounceStart.mockReset();
        backendState.app.StartRealtimeTransport.mockReset();
        backendState.app.SyncRealtimeFriendSnapshot.mockReset();
        backendState.app.StopRealtimeTransport.mockReset();
        backendState.app.StartRealtimeTransport.mockImplementation(
            async (
                _userId: string,
                _endpoint: string,
                _websocket: string,
                clientRunId: number
            ) => ({
                generation: 1,
                clientRunId,
                sessionGeneration: 1
            })
        );
        backendState.app.SyncRealtimeFriendSnapshot.mockResolvedValue({
            accepted: true,
            generation: 1,
            baselineRevision: 1,
            friendCount: 1
        });
        backendState.app.StopRealtimeTransport.mockResolvedValue(undefined);
        backgroundState.refreshFriendAndFavoriteSnapshots.mockReset();
        backgroundState.refreshFriendAndFavoriteSnapshots.mockResolvedValue(
            undefined
        );
        backendState.eventHandlers.clear();
        for (const handler of Object.values(presenceState)) {
            handler.mockReset();
        }
        authRecoveryState.handleRuntimeAuthFailure.mockReset();
        authRecoveryState.handleRuntimeAuthFailure.mockReturnValue(
            Promise.resolve()
        );
        globalThis.WebSocket = vi.fn() as unknown as typeof WebSocket;
    });

    afterEach(async () => {
        backendState.eventHandlers.clear();
        const { stopRealtimeTransport } =
            await import('./realtimeTransportService.js');
        stopRealtimeTransport({
            preserveTelemetry: false,
            updateStatus: false
        });
    });

    it(
        'starts backend realtime with current snapshot and friend baseline',
        async () => {
            await prepareReadySession();
            const { startRealtimeTransport } =
                await import('./realtimeTransportService.js');

            await startRealtimeTransport({
                userId: 'usr_1',
                endpoint: '',
                websocket: '',
                currentUserSnapshot: { id: 'usr_1' }
            });

            expect(
                backendState.app.StartRealtimeTransport
            ).toHaveBeenCalledWith(
                'usr_1',
                '',
                '',
                expect.any(Number),
                { id: 'usr_1' },
                expect.objectContaining({
                    usr_2: expect.objectContaining({ id: 'usr_2' })
                })
            );
            expect(globalThis.WebSocket).not.toHaveBeenCalled();
            expect(
                [...backendState.eventHandlers.keys()].some((name) =>
                    name.includes('WsMessage')
                )
            ).toBe(false);
        },
        REALTIME_TRANSPORT_TEST_TIMEOUT_MS
    );

    it('routes only typed backend projections', async () => {
        await prepareReadySession();
        const { startRealtimeTransport } =
            await import('./realtimeTransportService.js');

        await startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });

        emitBackendEvent('realtimeFriendProjection', {
            generation: 1,
            baselineRevision: 0,
            patches: [],
            removals: [],
            feedEntries: [],
            friendLogChanged: false
        });
        emitBackendEvent('realtimeNotificationProjection', {
            generation: 1,
            upserts: []
        });
        emitBackendEvent('realtimeCurrentUserProjection', {
            generation: 1,
            snapshot: { id: 'usr_1', status: 'active' }
        });
        emitBackendEvent('realtimeInstanceClosedProjection', {
            generation: 1,
            notification: { id: 'instance.closed:test' },
            feedEntry: { id: 'instance.closed:test' }
        });

        expect(
            presenceState.handleRealtimeFriendProjection
        ).toHaveBeenCalledTimes(1);
        expect(
            presenceState.handleRealtimeNotificationProjection
        ).toHaveBeenCalledTimes(1);
        expect(
            presenceState.handleRealtimeCurrentUserProjection
        ).toHaveBeenCalledTimes(1);
        expect(
            presenceState.handleRealtimeInstanceClosedProjection
        ).toHaveBeenCalledTimes(1);
    });

    it('ignores stale typed backend projection generations', async () => {
        await prepareReadySession();
        const { startRealtimeTransport } =
            await import('./realtimeTransportService.js');

        await startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });

        emitBackendEvent('realtimeFriendProjection', {
            generation: 2,
            baselineRevision: 0,
            patches: [
                {
                    userId: 'usr_2',
                    patch: { id: 'usr_2', state: 'online' },
                    stateBucket: 'online'
                }
            ],
            removals: [],
            feedEntries: [],
            friendLogChanged: false
        });
        emitBackendEvent('realtimeFriendProjection', {
            generation: 1,
            baselineRevision: 0,
            patches: [],
            removals: [],
            feedEntries: [],
            friendLogChanged: false
        });

        expect(
            presenceState.handleRealtimeFriendProjection
        ).toHaveBeenCalledTimes(1);
        expect(
            presenceState.handleRealtimeFriendProjection
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                generation: 1
            })
        );
    });

    it('replays typed backend projections emitted before start returns', async () => {
        let resolveStart:
            | ((value: {
                  generation: number;
                  clientRunId: number;
                  sessionGeneration: number;
              }) => void)
            | null = null;
        backendState.app.StartRealtimeTransport.mockReturnValue(
            new Promise((resolve) => {
                resolveStart = resolve;
            })
        );
        await prepareReadySession();
        const { startRealtimeTransport } =
            await import('./realtimeTransportService.js');

        const startPromise = startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });
        await vi.waitFor(() => {
            expect(backendState.app.StartRealtimeTransport).toHaveBeenCalled();
        });

        emitBackendEvent('realtimeFriendProjection', {
            generation: 1,
            baselineRevision: 0,
            patches: [],
            removals: [],
            feedEntries: [],
            friendLogChanged: false
        });
        expect(
            presenceState.handleRealtimeFriendProjection
        ).not.toHaveBeenCalled();

        const clientRunId =
            backendState.app.StartRealtimeTransport.mock.calls[0][3];
        resolveStart?.({
            generation: 1,
            clientRunId,
            sessionGeneration: 1
        });
        await startPromise;

        expect(
            presenceState.handleRealtimeFriendProjection
        ).toHaveBeenCalledTimes(1);
    });

    it('syncs the Rust friend snapshot after a reconnect refresh failure without dropping drained projections', async () => {
        await prepareReadySession();
        backgroundState.refreshFriendAndFavoriteSnapshots.mockImplementationOnce(
            async () => {
                const { useSessionStore } =
                    await import('@/state/sessionStore.js');
                useSessionStore
                    .getState()
                    .setSessionState({ isFriendsLoaded: false });
                throw new Error('refresh failed');
            }
        );
        const { startRealtimeTransport } =
            await import('./realtimeTransportService.js');

        await startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });

        emitBackendEvent('realtimeWsStatus', {
            status: 'connected',
            websocketDomain: 'wss://pipeline.vrchat.cloud'
        });
        emitBackendEvent('realtimeWsStatus', {
            status: 'connected',
            websocketDomain: 'wss://pipeline.vrchat.cloud'
        });

        await vi.waitFor(() => {
            expect(
                backgroundState.refreshFriendAndFavoriteSnapshots
            ).toHaveBeenCalledTimes(1);
            expect(
                backendState.app.SyncRealtimeFriendSnapshot
            ).toHaveBeenCalledWith(
                'usr_1',
                '',
                '',
                1,
                expect.objectContaining({
                    usr_2: expect.objectContaining({ id: 'usr_2' })
                })
            );
        });
        emitBackendEvent('realtimeFriendProjection', {
            generation: 1,
            baselineRevision: 1,
            patches: [],
            removals: [],
            feedEntries: [],
            friendLogChanged: false
        });
        expect(
            presenceState.handleRealtimeFriendProjection
        ).toHaveBeenCalledTimes(1);
    });

    it('does not fall back to browser WebSocket when backend start fails', async () => {
        backendState.app.StartRealtimeTransport.mockRejectedValue(
            new Error('backend unavailable')
        );
        await prepareReadySession();
        const { startRealtimeTransport } =
            await import('./realtimeTransportService.js');

        await expect(
            startRealtimeTransport({
                userId: 'usr_1',
                endpoint: '',
                websocket: '',
                currentUserSnapshot: { id: 'usr_1' }
            })
        ).rejects.toThrow('backend unavailable');

        expect(backendState.app.StartRealtimeTransport).toHaveBeenCalled();
        expect(globalThis.WebSocket).not.toHaveBeenCalled();
    });

    it('stops backend realtime transport while backend start is still pending', async () => {
        let resolveStart:
            | ((value: {
                  generation: number;
                  clientRunId: number;
                  sessionGeneration: number;
              }) => void)
            | null = null;
        backendState.app.StartRealtimeTransport.mockReturnValue(
            new Promise((resolve) => {
                resolveStart = resolve;
            })
        );
        await prepareReadySession();
        const { startRealtimeTransport, stopRealtimeTransport } =
            await import('./realtimeTransportService.js');

        const startPromise = startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });
        await vi.waitFor(() => {
            expect(backendState.app.StartRealtimeTransport).toHaveBeenCalled();
        });

        stopRealtimeTransport();
        expect(backendState.app.StopRealtimeTransport).toHaveBeenCalled();

        const clientRunId =
            backendState.app.StartRealtimeTransport.mock.calls[0][3];
        resolveStart?.({
            generation: 1,
            clientRunId,
            sessionGeneration: 1
        });
        await startPromise;
        expect(backendState.app.StopRealtimeTransport).toHaveBeenCalledTimes(2);
        expect(globalThis.WebSocket).not.toHaveBeenCalled();
    });

    it('does not let a stale pending start stop a newer backend transport', async () => {
        const pendingStarts: Array<{
            clientRunId: number;
            resolve: (value: {
                generation: number;
                clientRunId: number;
                sessionGeneration: number;
            }) => void;
        }> = [];
        backendState.app.StartRealtimeTransport.mockImplementation(
            async (
                _userId: string,
                _endpoint: string,
                _websocket: string,
                clientRunId: number
            ) =>
                new Promise((resolve) => {
                    pendingStarts.push({ clientRunId, resolve });
                })
        );
        await prepareReadySession('wss://one');
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { startRealtimeTransport } =
            await import('./realtimeTransportService.js');

        const startOnePromise = startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: 'wss://one',
            currentUserSnapshot: { id: 'usr_1' }
        });
        await vi.waitFor(() => {
            expect(
                backendState.app.StartRealtimeTransport
            ).toHaveBeenCalledTimes(1);
        });

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserWebsocket: 'wss://two',
            currentUserSnapshot: { id: 'usr_1' }
        });
        const startTwoPromise = startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: 'wss://two',
            currentUserSnapshot: { id: 'usr_1' }
        });
        await vi.waitFor(() => {
            expect(
                backendState.app.StartRealtimeTransport
            ).toHaveBeenCalledTimes(2);
        });

        const runOne = pendingStarts[0].clientRunId;
        const runTwo = pendingStarts[1].clientRunId;
        pendingStarts[1].resolve({
            generation: 2,
            clientRunId: runTwo,
            sessionGeneration: 2
        });
        await startTwoPromise;

        pendingStarts[0].resolve({
            generation: 1,
            clientRunId: runOne,
            sessionGeneration: 1
        });
        await startOnePromise;

        expect(backendState.app.StopRealtimeTransport).toHaveBeenCalledWith(
            'usr_1',
            '',
            'wss://one',
            runOne,
            1
        );
        expect(backendState.app.StopRealtimeTransport.mock.calls).not.toEqual(
            expect.arrayContaining([['usr_1', '', 'wss://two', runTwo, 2]])
        );
    });

    it('routes backend auth failure status into runtime auth recovery', async () => {
        await prepareReadySession();
        const { startRealtimeTransport } =
            await import('./realtimeTransportService.js');

        await startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });

        emitBackendEvent('realtimeWsStatus', {
            status: 'authFailure',
            websocketDomain: 'wss://pipeline.vrchat.cloud',
            reason: 'auth transport bootstrap failed (401): Missing Credentials',
            statusCode: 401
        });

        expect(authRecoveryState.handleRuntimeAuthFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 401,
                endpoint: 'auth'
            })
        );
    });
});
