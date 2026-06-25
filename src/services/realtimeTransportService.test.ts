import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REALTIME_TRANSPORT_TEST_TIMEOUT_MS = 15_000;

type RealtimeStartResolution = {
    generation: number;
    clientRunId: number;
    sessionGeneration: number;
};

function createDeferredStart(): {
    promise: Promise<RealtimeStartResolution>;
    resolve: (value: RealtimeStartResolution) => void;
} {
    let resolve: (value: RealtimeStartResolution) => void = () => {};
    const promise = new Promise<RealtimeStartResolution>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

const runtimeState = vi.hoisted(() => {
    const capabilities: Record<string, boolean> = {
        runtimeRealtimeTransport: true,
        ipc: false
    };
    return {
        capabilities,
        commands: {
            appIpcAnnounceStart: vi.fn(),
            appStartRealtimeTransport: vi.fn(),
            appSyncRealtimeFriendSnapshot: vi.fn(),
            appStopRealtimeTransport: vi.fn()
        },
        eventHandlers: new Map<string, Set<(payload: unknown) => void>>()
    };
});

vi.mock('@/platform/tauri/bindings', () => ({
    commands: runtimeState.commands
}));

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: {
        events: {
            subscribe: vi.fn(
                async (name: string, handler: (payload: unknown) => void) => {
                    let bucket = runtimeState.eventHandlers.get(name);
                    if (!bucket) {
                        bucket = new Set();
                        runtimeState.eventHandlers.set(name, bucket);
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

vi.mock('./hostCapabilityService', () => ({
    isHostCapabilityAvailable: vi.fn((key: string) =>
        Boolean(runtimeState.capabilities[key])
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

vi.mock('./realtimePresenceService', () => ({
    handleRealtimeFriendProjection:
        presenceState.handleRealtimeFriendProjection,
    handleRealtimeNotificationProjection:
        presenceState.handleRealtimeNotificationProjection,
    handleRealtimeCurrentUserProjection:
        presenceState.handleRealtimeCurrentUserProjection,
    handleRealtimeInstanceClosedProjection:
        presenceState.handleRealtimeInstanceClosedProjection
}));

vi.mock('./authSessionRecoveryService', () => ({
    handleRuntimeAuthFailure: authRecoveryState.handleRuntimeAuthFailure
}));

vi.mock('./backgroundMaintenanceService', () => ({
    refreshFriendAndFavoriteSnapshots:
        backgroundState.refreshFriendAndFavoriteSnapshots
}));

function emitTauriEvent(name: string, payload: unknown) {
    const bucket = runtimeState.eventHandlers.get(name);
    for (const handler of bucket ?? []) {
        handler(payload);
    }
}

async function prepareReadySession(websocket: any = '') {
    const { useFriendRosterStore } = await import('@/state/friendRosterStore');
    const { useRuntimeStore } = await import('@/state/runtimeStore');
    const { useSessionStore } = await import('@/state/sessionStore');

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

describe('realtime transport runtime routing', () => {
    beforeEach(() => {
        vi.resetModules();
        runtimeState.capabilities.runtimeRealtimeTransport = true;
        runtimeState.capabilities.ipc = false;
        runtimeState.commands.appIpcAnnounceStart.mockReset();
        runtimeState.commands.appStartRealtimeTransport.mockReset();
        runtimeState.commands.appSyncRealtimeFriendSnapshot.mockReset();
        runtimeState.commands.appStopRealtimeTransport.mockReset();
        runtimeState.commands.appStartRealtimeTransport.mockImplementation(
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
        runtimeState.commands.appSyncRealtimeFriendSnapshot.mockResolvedValue({
            accepted: true,
            generation: 1,
            baselineRevision: 1,
            friendCount: 1
        });
        runtimeState.commands.appStopRealtimeTransport.mockResolvedValue(
            undefined
        );
        backgroundState.refreshFriendAndFavoriteSnapshots.mockReset();
        backgroundState.refreshFriendAndFavoriteSnapshots.mockResolvedValue(
            undefined
        );
        runtimeState.eventHandlers.clear();
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
        runtimeState.eventHandlers.clear();
        const { stopRealtimeTransport } =
            await import('./realtimeTransportService');
        stopRealtimeTransport({
            preserveTelemetry: false,
            updateStatus: false
        });
    });

    it(
        'starts runtime realtime with current snapshot and friend baseline',
        async () => {
            await prepareReadySession();
            const { startRealtimeTransport } =
                await import('./realtimeTransportService');

            await startRealtimeTransport({
                userId: 'usr_1',
                endpoint: '',
                websocket: '',
                currentUserSnapshot: { id: 'usr_1' }
            });

            expect(
                runtimeState.commands.appStartRealtimeTransport
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
                [...runtimeState.eventHandlers.keys()].some((name: any) =>
                    name.includes('WsMessage')
                )
            ).toBe(false);
        },
        REALTIME_TRANSPORT_TEST_TIMEOUT_MS
    );

    it('does not start runtime realtime from a seeded roster before friends are fully loaded', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        const { startRealtimeTransport } =
            await import('./realtimeTransportService');

        useRuntimeStore.getState().resetRuntimeState();
        useFriendRosterStore.getState().resetRoster();
        useFriendRosterStore.getState().setRosterSeedSnapshot({
            currentUserId: 'usr_1',
            friendsById: {
                usr_2: {
                    id: 'usr_2',
                    displayName: 'Seed Friend',
                    stateBucket: 'online'
                }
            }
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1',
            currentUserEndpoint: '',
            currentUserWebsocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            isFriendsLoaded: false,
            sessionPhase: 'ready'
        });

        await startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });

        expect(
            runtimeState.commands.appStartRealtimeTransport
        ).not.toHaveBeenCalled();
    });

    it('routes only typed runtime projections', async () => {
        await prepareReadySession();
        const { startRealtimeTransport } =
            await import('./realtimeTransportService');

        await startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });

        emitTauriEvent('realtimeFriendProjection', {
            generation: 1,
            baselineRevision: 0,
            patches: [],
            removals: [],
            feedEntries: [],
            friendLogChanged: false
        });
        emitTauriEvent('realtimeNotificationProjection', {
            generation: 1,
            upserts: []
        });
        emitTauriEvent('realtimeCurrentUserProjection', {
            generation: 1,
            snapshot: { id: 'usr_1', status: 'active' }
        });
        emitTauriEvent('realtimeInstanceClosedProjection', {
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

    it('ignores stale typed runtime projection generations', async () => {
        await prepareReadySession();
        const { startRealtimeTransport } =
            await import('./realtimeTransportService');

        await startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });

        emitTauriEvent('realtimeFriendProjection', {
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
        emitTauriEvent('realtimeFriendProjection', {
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

    it('replays typed runtime projections emitted before start returns', async () => {
        const deferredStart = createDeferredStart();
        runtimeState.commands.appStartRealtimeTransport.mockReturnValue(
            deferredStart.promise
        );
        await prepareReadySession();
        const { startRealtimeTransport } =
            await import('./realtimeTransportService');

        const startPromise = startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });
        await vi.waitFor(() => {
            expect(
                runtimeState.commands.appStartRealtimeTransport
            ).toHaveBeenCalled();
        });

        emitTauriEvent('realtimeFriendProjection', {
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
            runtimeState.commands.appStartRealtimeTransport.mock.calls[0][3];
        deferredStart.resolve({
            generation: 1,
            clientRunId,
            sessionGeneration: 1
        });
        await startPromise;

        expect(
            presenceState.handleRealtimeFriendProjection
        ).toHaveBeenCalledTimes(1);
    });

    it('lets Rust own reconnect baseline recovery without frontend refresh or snapshot sync', async () => {
        await prepareReadySession();
        const { startRealtimeTransport } =
            await import('./realtimeTransportService');

        await startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });

        emitTauriEvent('realtimeWsStatus', {
            status: 'connected',
            websocketDomain: 'wss://pipeline.vrchat.cloud'
        });
        emitTauriEvent('realtimeWsStatus', {
            status: 'connected',
            websocketDomain: 'wss://pipeline.vrchat.cloud'
        });

        await vi.waitFor(() => {
            expect(
                backgroundState.refreshFriendAndFavoriteSnapshots
            ).not.toHaveBeenCalled();
            expect(
                runtimeState.commands.appSyncRealtimeFriendSnapshot
            ).not.toHaveBeenCalled();
        });
        emitTauriEvent('realtimeFriendProjection', {
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

    it('does not fall back to browser WebSocket when runtime start fails', async () => {
        runtimeState.commands.appStartRealtimeTransport.mockRejectedValue(
            new Error('runtime unavailable')
        );
        await prepareReadySession();
        const { startRealtimeTransport } =
            await import('./realtimeTransportService');

        await expect(
            startRealtimeTransport({
                userId: 'usr_1',
                endpoint: '',
                websocket: '',
                currentUserSnapshot: { id: 'usr_1' }
            })
        ).rejects.toThrow('runtime unavailable');

        expect(
            runtimeState.commands.appStartRealtimeTransport
        ).toHaveBeenCalled();
        expect(globalThis.WebSocket).not.toHaveBeenCalled();
    });

    it('stops runtime realtime transport while runtime start is still pending', async () => {
        const deferredStart = createDeferredStart();
        runtimeState.commands.appStartRealtimeTransport.mockReturnValue(
            deferredStart.promise
        );
        await prepareReadySession();
        const { startRealtimeTransport, stopRealtimeTransport } =
            await import('./realtimeTransportService');

        const startPromise = startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });
        await vi.waitFor(() => {
            expect(
                runtimeState.commands.appStartRealtimeTransport
            ).toHaveBeenCalled();
        });

        stopRealtimeTransport();
        expect(
            runtimeState.commands.appStopRealtimeTransport
        ).toHaveBeenCalled();

        const clientRunId =
            runtimeState.commands.appStartRealtimeTransport.mock.calls[0][3];
        deferredStart.resolve({
            generation: 1,
            clientRunId,
            sessionGeneration: 1
        });
        await startPromise;
        expect(
            runtimeState.commands.appStopRealtimeTransport
        ).toHaveBeenCalledTimes(2);
        expect(globalThis.WebSocket).not.toHaveBeenCalled();
    });

    it('does not let a stale pending start stop a newer runtime transport', async () => {
        const pendingStarts: Array<{
            clientRunId: number;
            resolve: (value: {
                generation: number;
                clientRunId: number;
                sessionGeneration: number;
            }) => void;
        }> = [];
        runtimeState.commands.appStartRealtimeTransport.mockImplementation(
            async (
                _userId: string,
                _endpoint: string,
                _websocket: string,
                clientRunId: number
            ) =>
                new Promise((resolve: any) => {
                    pendingStarts.push({ clientRunId, resolve });
                })
        );
        await prepareReadySession('wss://one');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { startRealtimeTransport } =
            await import('./realtimeTransportService');

        const startOnePromise = startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: 'wss://one',
            currentUserSnapshot: { id: 'usr_1' }
        });
        await vi.waitFor(() => {
            expect(
                runtimeState.commands.appStartRealtimeTransport
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
                runtimeState.commands.appStartRealtimeTransport
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

        expect(
            runtimeState.commands.appStopRealtimeTransport
        ).toHaveBeenCalledWith('usr_1', '', 'wss://one', runOne, 1);
        expect(
            runtimeState.commands.appStopRealtimeTransport.mock.calls
        ).not.toEqual(
            expect.arrayContaining([['usr_1', '', 'wss://two', runTwo, 2]])
        );
    });

    it('routes runtime auth failure status into runtime auth recovery', async () => {
        await prepareReadySession();
        const { startRealtimeTransport } =
            await import('./realtimeTransportService');

        await startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });

        emitTauriEvent('realtimeWsStatus', {
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
