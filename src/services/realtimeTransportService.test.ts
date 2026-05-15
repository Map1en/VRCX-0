import { beforeEach, describe, expect, it, vi } from 'vitest';

const backendState = vi.hoisted(() => ({
    capabilities: {
        backendRealtimeTransport: true,
        ipc: false
    },
    app: {
        IPCAnnounceStart: vi.fn(),
        StartRealtimeTransport: vi.fn(),
        SetRealtimeFriendBaseline: vi.fn(),
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
    handleRealtimePresenceEvent: vi.fn()
}));

const authRecoveryState = vi.hoisted(() => ({
    handleRuntimeAuthFailure: vi.fn()
}));

vi.mock('./realtimePresenceService.js', () => ({
    handleRealtimePresenceEvent: presenceState.handleRealtimePresenceEvent
}));

vi.mock('./authSessionRecoveryService.js', () => ({
    handleRuntimeAuthFailure: authRecoveryState.handleRuntimeAuthFailure
}));

vi.mock('./backgroundMaintenanceService.js', () => ({
    refreshFriendAndFavoriteSnapshots: vi.fn(async () => undefined)
}));

function emitBackendEvent(name: string, payload: unknown) {
    const bucket = backendState.eventHandlers.get(name);
    for (const handler of bucket ?? []) {
        handler(payload);
    }
}

describe('realtime transport backend routing', () => {
    beforeEach(() => {
        vi.resetModules();
        backendState.capabilities.backendRealtimeTransport = true;
        backendState.capabilities.ipc = false;
        backendState.app.IPCAnnounceStart.mockReset();
        backendState.app.StartRealtimeTransport.mockReset();
        backendState.app.SetRealtimeFriendBaseline.mockReset();
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
        backendState.app.SetRealtimeFriendBaseline.mockResolvedValue({
            accepted: true,
            generation: 1,
            friendCount: 0
        });
        backendState.app.StopRealtimeTransport.mockResolvedValue(undefined);
        backendState.eventHandlers.clear();
        presenceState.handleRealtimePresenceEvent.mockReset();
        authRecoveryState.handleRuntimeAuthFailure.mockReset();
        authRecoveryState.handleRuntimeAuthFailure.mockReturnValue(
            Promise.resolve()
        );
        globalThis.WebSocket = vi.fn() as unknown as typeof WebSocket;
        globalThis.window = {
            clearTimeout: vi.fn(),
            setTimeout: vi.fn()
        } as unknown as Window & typeof globalThis;
    });

    it('uses backend realtime transport without constructing browser WebSocket', async () => {
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { useSessionStore } = await import('@/state/sessionStore.js');
        const { startRealtimeTransport } =
            await import('./realtimeTransportService.js');

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1',
            currentUserEndpoint: '',
            currentUserWebsocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            isFriendsLoaded: true,
            sessionPhase: 'ready'
        });

        await startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });

        expect(backendState.app.StartRealtimeTransport).toHaveBeenCalledWith(
            'usr_1',
            '',
            '',
            expect.any(Number)
        );
        expect(backendState.app.SetRealtimeFriendBaseline).toHaveBeenCalledWith(
            'usr_1',
            '',
            '',
            expect.any(Number),
            1,
            expect.any(Object)
        );
        expect(globalThis.WebSocket).not.toHaveBeenCalled();

        emitBackendEvent('realtimeWsMessage', {
            json: {
                type: 'friend-online',
                content: { userId: 'usr_2' }
            },
            raw: '{}',
            receivedAt: '2026-05-14T00:00:00Z'
        });
        expect(presenceState.handleRealtimePresenceEvent).toHaveBeenCalledWith({
            type: 'friend-online',
            content: { userId: 'usr_2' }
        });
    });

    it('does not fall back to browser WebSocket when backend start fails', async () => {
        backendState.app.StartRealtimeTransport.mockRejectedValue(
            new Error('backend unavailable')
        );
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { useSessionStore } = await import('@/state/sessionStore.js');
        const { startRealtimeTransport } =
            await import('./realtimeTransportService.js');

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1',
            currentUserEndpoint: '',
            currentUserWebsocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            isFriendsLoaded: true,
            sessionPhase: 'ready'
        });

        await expect(
            startRealtimeTransport({
                userId: 'usr_1',
                endpoint: '',
                websocket: '',
                currentUserSnapshot: { id: 'usr_1' }
            })
        ).rejects.toThrow('backend unavailable');

        expect(backendState.app.StartRealtimeTransport).toHaveBeenCalled();
        expect(
            backendState.app.SetRealtimeFriendBaseline
        ).not.toHaveBeenCalled();
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
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { useSessionStore } = await import('@/state/sessionStore.js');
        const { startRealtimeTransport, stopRealtimeTransport } =
            await import('./realtimeTransportService.js');

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1',
            currentUserEndpoint: '',
            currentUserWebsocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            isFriendsLoaded: true,
            sessionPhase: 'ready'
        });

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
        expect(
            backendState.app.SetRealtimeFriendBaseline
        ).not.toHaveBeenCalled();
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
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { useSessionStore } = await import('@/state/sessionStore.js');
        const { startRealtimeTransport } =
            await import('./realtimeTransportService.js');

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1',
            currentUserEndpoint: '',
            currentUserWebsocket: 'wss://one',
            currentUserSnapshot: { id: 'usr_1' }
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            isFriendsLoaded: true,
            sessionPhase: 'ready'
        });

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
            currentUserId: 'usr_1',
            currentUserEndpoint: '',
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
        expect(backendState.app.SetRealtimeFriendBaseline).toHaveBeenCalledWith(
            'usr_1',
            '',
            'wss://two',
            runTwo,
            2,
            expect.any(Object)
        );

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
        expect(
            backendState.app.SetRealtimeFriendBaseline.mock.calls
        ).not.toEqual(
            expect.arrayContaining([
                ['usr_1', '', 'wss://one', runOne, 1, expect.any(Object)]
            ])
        );

        presenceState.handleRealtimePresenceEvent.mockReset();
        emitBackendEvent('realtimeWsMessage', {
            json: {
                type: 'friend-online',
                content: { userId: 'usr_2' }
            },
            raw: '{}',
            receivedAt: '2026-05-14T00:00:00Z'
        });
        expect(presenceState.handleRealtimePresenceEvent).toHaveBeenCalledTimes(
            1
        );
    });

    it('routes backend auth failure status into runtime auth recovery', async () => {
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { useSessionStore } = await import('@/state/sessionStore.js');
        const { startRealtimeTransport } =
            await import('./realtimeTransportService.js');

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1',
            currentUserEndpoint: '',
            currentUserWebsocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            isFriendsLoaded: true,
            sessionPhase: 'ready'
        });

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
        expect(
            (
                authRecoveryState.handleRuntimeAuthFailure.mock
                    .calls[0][0] as Error
            ).message
        ).toContain('Missing Credentials');
        expect(globalThis.WebSocket).not.toHaveBeenCalled();
    });

    it('does not turn non-401 backend auth status into session recovery', async () => {
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { useSessionStore } = await import('@/state/sessionStore.js');
        const { startRealtimeTransport } =
            await import('./realtimeTransportService.js');

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_1',
            currentUserEndpoint: '',
            currentUserWebsocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            isFriendsLoaded: true,
            sessionPhase: 'ready'
        });

        await startRealtimeTransport({
            userId: 'usr_1',
            endpoint: '',
            websocket: '',
            currentUserSnapshot: { id: 'usr_1' }
        });

        emitBackendEvent('realtimeWsStatus', {
            status: 'authFailure',
            websocketDomain: 'wss://pipeline.vrchat.cloud',
            reason: 'The auth transport bootstrap did not return a websocket token.'
        });

        expect(
            authRecoveryState.handleRuntimeAuthFailure
        ).not.toHaveBeenCalled();
        expect(globalThis.WebSocket).not.toHaveBeenCalled();
    });
});
