import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackendRuntimeSnapshot } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    subscribe:
        vi.fn<
            (
                name: string,
                handler: (payload: unknown) => void
            ) => Promise<() => void>
        >(),
    applyRuntimeGameLogProjection: vi.fn(),
    recordRuntimeGameClientEvent: vi.fn(),
    handleGameRunningUpdate: vi.fn<() => Promise<void>>(),
    isHostCapabilityAvailable: vi.fn<(name: string) => boolean>(),
    refreshHostCapabilities: vi.fn(),
    pushSharedFeedNotification: vi.fn<() => Promise<void>>(),
    showSQLiteErrorDialog: vi.fn<() => Promise<void>>(),
    handleBrowserFocus: vi.fn<() => Promise<void>>(),
    getBackendRuntimeSnapshot:
        vi.fn<
            () => Promise<
                import('@/platform/tauri/bindings').BackendRuntimeSnapshot
            >
        >(),
    getAuthenticatedRuntimePhaseSnapshot: vi.fn(),
    getAppUpdateStatus:
        vi.fn<
            () => Promise<
                import('@/platform/tauri/bindings').AppUpdateStatusSnapshot
            >
        >(),
    getAppUpdateDownloadStatus:
        vi.fn<
            () => Promise<
                import('@/platform/tauri/bindings').AppUpdateDownloadStatusSnapshot
            >
        >(),
    runtimeGroupInstancesRefresh: vi.fn<() => Promise<null>>(),
    appCheckGameRunning: vi.fn<() => Promise<null>>(),
    profileBackupCurrentStatus: vi.fn(),
    runtimeAuthScopeGet: vi.fn(),
    bindDeepLinkEvents: vi.fn<() => Promise<() => void>>(),
    drainPendingDeepLinks: vi.fn<() => Promise<void>>(),
    deepLinkUnsubscribe: vi.fn(),
    handleRuntimeAuthFailure: vi.fn(),
    resumeFrontendSessionFromBackendRuntime:
        vi.fn<(snapshot: unknown) => Promise<boolean>>()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appCheckGameRunning: mocks.appCheckGameRunning,
        appProfileBackupCurrentStatus: mocks.profileBackupCurrentStatus,
        appGetBackendRuntimeSnapshot: mocks.getBackendRuntimeSnapshot,
        appAuthenticatedRuntimePhaseSnapshotGet:
            mocks.getAuthenticatedRuntimePhaseSnapshot,
        appRuntimeAuthScopeGet: mocks.runtimeAuthScopeGet,
        appAppUpdateStatusGet: mocks.getAppUpdateStatus,
        appAppUpdateCheckRun: mocks.getAppUpdateStatus,
        appAppUpdateDownloadStatusGet: mocks.getAppUpdateDownloadStatus,
        appRuntimeGroupInstancesRefresh: mocks.runtimeGroupInstancesRefresh
    }
}));

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: {
        events: {
            subscribe: mocks.subscribe
        }
    }
}));

vi.mock('./gameLogIngestService', () => ({
    applyRuntimeGameLogProjection: mocks.applyRuntimeGameLogProjection
}));

vi.mock('./gameClientLifecycle', () => ({
    recordRuntimeGameClientEvent: mocks.recordRuntimeGameClientEvent
}));

vi.mock('./gameStateService', () => ({
    handleGameRunningUpdate: mocks.handleGameRunningUpdate
}));

vi.mock('./hostCapabilityService', () => ({
    isHostCapabilityAvailable: mocks.isHostCapabilityAvailable
}));

vi.mock('./sharedFeedNotificationService', () => ({
    pushSharedFeedNotification: mocks.pushSharedFeedNotification
}));

vi.mock('./sqliteErrorDialogService', () => ({
    showSQLiteErrorDialog: mocks.showSQLiteErrorDialog
}));

vi.mock('./vrcStatusService', () => ({
    handleBrowserFocus: mocks.handleBrowserFocus
}));

vi.mock('./backendRuntimeSessionResumeService', () => ({
    resumeFrontendSessionFromBackendRuntime:
        mocks.resumeFrontendSessionFromBackendRuntime
}));

vi.mock('./deepLinkService', () => ({
    bindDeepLinkEvents: mocks.bindDeepLinkEvents,
    drainPendingDeepLinks: mocks.drainPendingDeepLinks
}));

vi.mock('./authSessionRecoveryService', () => ({
    handleRuntimeAuthFailure: mocks.handleRuntimeAuthFailure
}));

import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useProfileBackupStore } from '@/state/profileBackupStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useUserFactsStore } from '@/state/userFactsStore';

import { bindRuntimeEvents } from './runtimeEventBridgeService';

function createBackendRuntimeSnapshot(): BackendRuntimeSnapshot {
    return {
        mode: 'foreground',
        phase: 'idle',
        authStatus: 'none',
        authUserId: '',
        authDisplayName: '',
        wsStatus: 'idle',
        gameLogStatus: 'idle',
        processStatus: 'idle',
        wsMessageCounts: {},
        wsPersistedCount: 0,
        gameLogPersistedCount: 0,
        lastError: null,
        updatedAt: '2026-07-09T00:00:00.000Z',
        friendProfileLoad: {
            runId: 0,
            status: 'idle',
            total: 0,
            processed: 0,
            loaded: 0,
            failed: 0,
            startedAt: '',
            finishedAt: null,
            lastError: null
        }
    };
}

async function bindCapturedRuntimeEvents(): Promise<{
    handlers: Map<string, (payload: unknown) => void>;
    cleanup: () => void;
}> {
    const handlers = new Map<string, (payload: unknown) => void>();
    mocks.subscribe.mockImplementation((name, handler) => {
        handlers.set(name, handler);
        return Promise.resolve(() => {});
    });
    return {
        handlers,
        cleanup: await bindRuntimeEvents()
    };
}

function setBackendRealtimeOwner({
    userId = 'usr_owner',
    authReady = true,
    sessionReady = true,
    friendProfileLoadStatus,
    friendProfileLoadRunId = 1
}: {
    userId?: string;
    authReady?: boolean;
    sessionReady?: boolean;
    friendProfileLoadStatus?: 'running' | 'cancelling';
    friendProfileLoadRunId?: number;
} = {}): BackendRuntimeSnapshot {
    const snapshot: BackendRuntimeSnapshot = {
        ...createBackendRuntimeSnapshot(),
        phase: 'running',
        authStatus: 'authenticated',
        authUserId: userId,
        wsStatus: 'connected'
    };
    useRuntimeStore.getState().setBackendRuntimeSnapshot(snapshot);
    if (authReady) {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: userId
        });
    }
    if (friendProfileLoadStatus) {
        useRuntimeStore.getState().setFriendProfileLoadState({
            runId: friendProfileLoadRunId,
            status: friendProfileLoadStatus
        });
    }
    if (sessionReady) {
        useSessionStore.getState().setSessionPhase('ready');
    }
    return snapshot;
}

describe('runtimeEventBridgeService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useFriendRosterStore.getState().resetRoster();
        useSessionStore.getState().resetSessionState();
        useUserFactsStore.getState().resetUserFacts();
        useProfileBackupStore.getState().resetProfileBackupState();
        vi.useRealTimers();
        mocks.isHostCapabilityAvailable.mockReturnValue(false);
        mocks.subscribe.mockResolvedValue(() => {});
        mocks.getBackendRuntimeSnapshot.mockResolvedValue(
            createBackendRuntimeSnapshot()
        );
        mocks.getAuthenticatedRuntimePhaseSnapshot.mockResolvedValue({
            runId: 0,
            authScopeGeneration: 0,
            userId: '',
            endpoint: '',
            websocket: '',
            phase: 'idle',
            friends: {
                status: 'pending',
                attempt: 0,
                retryDelaySeconds: null,
                detail: '',
                lastError: null
            },
            favorites: {
                status: 'pending',
                attempt: 0,
                retryDelaySeconds: null,
                detail: '',
                lastError: null
            },
            realtime: {
                status: 'pending',
                attempt: 0,
                retryDelaySeconds: null,
                detail: '',
                lastError: null
            },
            friendBaseline: null,
            favoritesBaseline: null,
            realtimeTransport: null,
            updatedAt: ''
        });
        mocks.getAppUpdateStatus.mockResolvedValue({
            hasAvailableUpdate: false,
            checkedAt: '',
            detail: '',
            error: null,
            release: null,
            shouldNotify: false
        });
        mocks.getAppUpdateDownloadStatus.mockResolvedValue({
            phase: 'idle',
            version: null,
            downloadedBytes: 0,
            totalBytes: 0,
            percent: 0,
            error: null
        });
        mocks.runtimeGroupInstancesRefresh.mockResolvedValue(null);
        mocks.appCheckGameRunning.mockResolvedValue(null);
        mocks.profileBackupCurrentStatus.mockResolvedValue({
            revision: 0,
            state: 'idle',
            kind: null,
            phase: null,
            percent: null,
            error: null,
            lastOutcome: null
        });
        mocks.runtimeAuthScopeGet.mockResolvedValue({
            currentUserId: 'usr_owner',
            endpoint: 'https://api.vrchat.cloud/api/1',
            generation: 7,
            active: true
        });
        mocks.bindDeepLinkEvents.mockResolvedValue(mocks.deepLinkUnsubscribe);
        mocks.drainPendingDeepLinks.mockResolvedValue(undefined);
        mocks.resumeFrontendSessionFromBackendRuntime.mockResolvedValue(false);
    });

    it('routes only current-scope structured VRChat 401 events to auth recovery', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        setBackendRealtimeOwner();
        const handler = handlers.get('runtimeVrchatAuthFailure');
        expect(handler).toBeTypeOf('function');

        handler?.({
            ownerUserId: 'usr_owner',
            endpoint: 'https://api.vrchat.cloud/api/1/',
            path: 'user/usr_target/friendRequest',
            reason: 'Missing Credentials (401)',
            statusCode: 401,
            authScopeGeneration: 7
        });

        await vi.waitFor(() => {
            expect(mocks.handleRuntimeAuthFailure).toHaveBeenCalledTimes(1);
        });
        expect(mocks.handleRuntimeAuthFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Missing Credentials (401)',
                status: 401,
                endpoint: 'user/usr_target/friendRequest'
            })
        );

        handler?.({
            ownerUserId: 'usr_owner',
            endpoint: 'https://api.vrchat.cloud/api/1',
            path: 'user/usr_target/friendRequest',
            reason: 'Missing Credentials (401)',
            statusCode: 401,
            authScopeGeneration: 6
        });
        await Promise.resolve();
        expect(mocks.handleRuntimeAuthFailure).toHaveBeenCalledTimes(1);
    });

    it('drains pending deep links after backend runtime snapshot hydration', async () => {
        const calls: string[] = [];
        mocks.bindDeepLinkEvents.mockImplementation(async () => {
            calls.push('bind-deep-link-events');
            return mocks.deepLinkUnsubscribe;
        });
        mocks.getBackendRuntimeSnapshot.mockImplementation(async () => {
            calls.push('get-backend-snapshot');
            return createBackendRuntimeSnapshot();
        });
        mocks.resumeFrontendSessionFromBackendRuntime.mockImplementation(
            async () => {
                calls.push('hydrate-backend-snapshot');
                return false;
            }
        );
        mocks.drainPendingDeepLinks.mockImplementation(async () => {
            calls.push('drain-deep-links');
        });

        await bindRuntimeEvents();

        expect(calls).toEqual([
            'get-backend-snapshot',
            'hydrate-backend-snapshot',
            'bind-deep-link-events',
            'drain-deep-links'
        ]);
        expect(mocks.drainPendingDeepLinks).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes earlier runtime events when a later subscription fails', async () => {
        const unsubscribe = vi.fn();
        mocks.subscribe.mockImplementation(async (name) => {
            if (name === 'gameLogProjection') {
                throw new Error('subscription failed');
            }
            return unsubscribe;
        });

        await expect(bindRuntimeEvents()).rejects.toThrow(
            'subscription failed'
        );

        expect(unsubscribe).toHaveBeenCalledTimes(6);
        expect(useSessionStore.getState().transportStatus).toBe('disconnected');
        expect(mocks.bindDeepLinkEvents).not.toHaveBeenCalled();
    });

    it('cleans subscriptions and pending batches when deep-link startup fails', async () => {
        vi.useFakeTimers();
        const handlers = new Map<string, (payload: unknown) => void>();
        const runtimeUnsubscribe = vi.fn();
        mocks.subscribe.mockImplementation((name, handler) => {
            handlers.set(name, handler);
            return Promise.resolve(runtimeUnsubscribe);
        });
        mocks.bindDeepLinkEvents.mockImplementation(async () => {
            setBackendRealtimeOwner({
                friendProfileLoadStatus: 'running'
            });
            handlers.get('realtimeUserProjection')?.({
                source: 'friendProfileBulkLoad',
                users: [
                    {
                        id: 'usr_pending',
                        endpoint: 'api.vrchat.cloud',
                        displayName: 'Pending Friend'
                    }
                ]
            });
            return mocks.deepLinkUnsubscribe;
        });
        mocks.drainPendingDeepLinks.mockRejectedValue(
            new Error('deep-link startup failed')
        );

        await expect(bindRuntimeEvents()).rejects.toThrow(
            'deep-link startup failed'
        );
        await vi.advanceTimersByTimeAsync(10_000);

        expect(runtimeUnsubscribe).toHaveBeenCalledTimes(29);
        expect(mocks.deepLinkUnsubscribe).toHaveBeenCalledTimes(1);
        expect(useSessionStore.getState().transportStatus).toBe('disconnected');
        expect(useUserFactsStore.getState().usersByKey).toEqual({});
    });

    it('hydrates backup status after subscribing and applies newer events', async () => {
        const handlers = new Map<string, (payload: unknown) => void>();
        mocks.subscribe.mockImplementation(async (name, handler) => {
            handlers.set(name, handler);
            return () => {};
        });
        mocks.profileBackupCurrentStatus.mockResolvedValueOnce({
            revision: 3,
            state: 'running',
            kind: 'auto',
            phase: 'snapshot',
            percent: 15,
            error: null,
            lastOutcome: null
        });

        await bindRuntimeEvents();
        handlers.get('profileBackupStatus')?.({
            revision: 4,
            state: 'running',
            kind: 'auto',
            phase: 'package',
            percent: 60,
            error: null,
            lastOutcome: null
        });

        expect(useProfileBackupStore.getState().status).toMatchObject({
            revision: 4,
            phase: 'package',
            percent: 60
        });
    });

    it('routes restore progress to the active global restore flow', async () => {
        const handlers = new Map<string, (payload: unknown) => void>();
        mocks.subscribe.mockImplementation(async (name, handler) => {
            handlers.set(name, handler);
            return () => {};
        });
        useProfileBackupStore.getState().beginRestoreValidation();

        await bindRuntimeEvents();
        handlers.get('profileRestoreProgress')?.({
            revision: 9,
            operation: 'validate',
            phase: 'extractDatabase',
            processedBytes: 25,
            totalBytes: 100,
            percent: 25
        });

        expect(useProfileBackupStore.getState().restoreProgress).toMatchObject({
            revision: 9,
            phase: 'extractDatabase',
            percent: 25
        });
    });

    it('records GameLog persistence fallback as telemetry without frontend ingest', async () => {
        const handlers = new Map<string, (payload: unknown) => void>();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mocks.subscribe.mockImplementation((name, handler) => {
            handlers.set(name, handler);
            return Promise.resolve(() => {});
        });

        await bindRuntimeEvents();

        handlers.get('gameLogPersistenceFallback')?.({
            error: 'database is locked',
            batch: {
                video_plays: [
                    {
                        created_at: '2026-05-15T00:00:00.000Z',
                        video_url: 'https://video.example.test'
                    }
                ]
            },
            rawRows: [
                [
                    'runtime-game-log',
                    '2026-05-15T00:00:00.000Z',
                    'video-play',
                    'https://video.example.test',
                    ''
                ]
            ]
        });

        expect(mocks.showSQLiteErrorDialog).not.toHaveBeenCalled();
        expect(
            useRuntimeStore.getState().runtimeEvents.gameLogPersistenceFallback
                .count
        ).toBe(1);
        expect(warn).toHaveBeenCalledWith(
            'Backend GameLog persistence failed:',
            'database is locked'
        );

        warn.mockRestore();
    });

    it('records runtime-persisted GameLog mirrors without frontend ingest', async () => {
        const handlers = new Map<string, (payload: unknown) => void>();
        mocks.subscribe.mockImplementation((name, handler) => {
            handlers.set(name, handler);
            return Promise.resolve(() => {});
        });
        await bindRuntimeEvents();

        const payload = {
            runtimePersisted: true,
            raw: [
                'runtime-game-log',
                '2026-05-15T00:00:00.000Z',
                'location',
                'wrld_test:1',
                'Test World'
            ]
        };
        handlers.get('addGameLogEvent')?.(payload);

        expect(
            useRuntimeStore.getState().runtimeEvents.addGameLogEvent.count
        ).toBe(1);
    });

    it('applies runtime GameLog projection when runtime ingest is active', async () => {
        const handlers = new Map<string, (payload: unknown) => void>();
        mocks.subscribe.mockImplementation((name, handler) => {
            handlers.set(name, handler);
            return Promise.resolve(() => {});
        });
        mocks.isHostCapabilityAvailable.mockImplementation(
            (name) => name === 'runtimeGameLogIngest'
        );

        await bindRuntimeEvents();

        const payload = {
            currentLocation: 'wrld_test:1',
            currentWorldName: 'Test World',
            currentLocationPlayers: []
        };
        handlers.get('gameLogProjection')?.(payload);

        expect(mocks.applyRuntimeGameLogProjection).toHaveBeenCalledWith(
            payload
        );
        expect(
            useRuntimeStore.getState().runtimeEvents.gameLogProjection.count
        ).toBe(1);
    });

    it('keeps only the latest queued backend projection generation before session readiness', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        const runningSnapshot = setBackendRealtimeOwner({
            authReady: false,
            sessionReady: false
        });

        handlers.get('realtimeUserProjection')?.({
            generation: 1,
            users: [
                {
                    id: 'usr_stale',
                    endpoint: 'api.vrchat.cloud',
                    displayName: 'Stale User'
                }
            ]
        });
        handlers.get('realtimeUserProjection')?.({
            generation: 2,
            users: [
                {
                    id: 'usr_latest',
                    endpoint: 'api.vrchat.cloud',
                    displayName: 'Latest User'
                }
            ]
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_owner'
        });
        useSessionStore.getState().setSessionPhase('ready');

        handlers.get('backendRuntimeTelemetry')?.({
            snapshot: runningSnapshot
        });
        await vi.waitFor(() => {
            expect(
                Object.values(useUserFactsStore.getState().usersByKey).map(
                    (user) => user.id
                )
            ).toEqual(['usr_latest']);
        });
    });

    it('prunes queued backend projections when the runtime user changes', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        const oldUserSnapshot = setBackendRealtimeOwner({
            userId: 'usr_old_owner',
            authReady: false,
            sessionReady: false
        });
        handlers.get('realtimeUserProjection')?.({
            generation: 1,
            users: [
                {
                    id: 'usr_stale',
                    endpoint: 'api.vrchat.cloud',
                    displayName: 'Stale User'
                }
            ]
        });

        handlers.get('backendRuntimeTelemetry')?.({
            snapshot: {
                ...oldUserSnapshot,
                authUserId: 'usr_new_owner'
            }
        });
        await Promise.resolve();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_old_owner'
        });
        useSessionStore.getState().setSessionPhase('ready');
        handlers.get('backendRuntimeTelemetry')?.({
            snapshot: oldUserSnapshot
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(useUserFactsStore.getState().usersByKey).toEqual({});
    });

    it('drops queued backend projections during unbind', async () => {
        const firstBinding = await bindCapturedRuntimeEvents();
        setBackendRealtimeOwner({
            authReady: false,
            sessionReady: false
        });
        firstBinding.handlers.get('realtimeUserProjection')?.({
            generation: 1,
            users: [
                {
                    id: 'usr_stale',
                    endpoint: 'api.vrchat.cloud',
                    displayName: 'Stale User'
                }
            ]
        });
        firstBinding.cleanup();

        const secondBinding = await bindCapturedRuntimeEvents();
        const runningSnapshot = setBackendRealtimeOwner();
        secondBinding.handlers.get('backendRuntimeTelemetry')?.({
            snapshot: runningSnapshot
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(useUserFactsStore.getState().usersByKey).toEqual({});
        secondBinding.cleanup();
    });

    it('batches friend profile projections into one store update', async () => {
        vi.useFakeTimers();
        const { handlers, cleanup } = await bindCapturedRuntimeEvents();
        setBackendRealtimeOwner({
            friendProfileLoadStatus: 'running'
        });
        let rosterUpdates = 0;
        let userFactUpdates = 0;
        const unsubscribeRoster = useFriendRosterStore.subscribe(() => {
            rosterUpdates += 1;
        });
        const unsubscribeUserFacts = useUserFactsStore.subscribe(() => {
            userFactUpdates += 1;
        });

        for (const userId of ['usr_a', 'usr_b']) {
            handlers.get('realtimeUserProjection')?.({
                source: 'friendProfileBulkLoad',
                users: [
                    {
                        id: userId,
                        endpoint: 'api.vrchat.cloud',
                        displayName: userId
                    }
                ]
            });
            handlers.get('realtimeFriendProjection')?.({
                generation: 1,
                baselineRevision: 1,
                source: 'friendProfileBulkLoad',
                patches: [
                    {
                        userId,
                        patch: {
                            id: userId,
                            displayName: userId,
                            state: 'offline'
                        },
                        stateBucket: 'offline',
                        stateBucketAuthority: 'preserve'
                    }
                ],
                removals: [],
                feedEntries: [],
                friendLogChanged: false
            });
        }

        expect(rosterUpdates).toBe(0);
        expect(userFactUpdates).toBe(0);
        await vi.advanceTimersByTimeAsync(9_999);
        expect(rosterUpdates).toBe(0);
        expect(userFactUpdates).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(rosterUpdates).toBe(1);
        expect(userFactUpdates).toBe(1);
        expect(
            Object.keys(useFriendRosterStore.getState().friendsById)
        ).toEqual(['usr_a', 'usr_b']);

        unsubscribeRoster();
        unsubscribeUserFacts();
        cleanup();
    });

    it('drops pending friend profile projections during unbind', async () => {
        vi.useFakeTimers();
        const { handlers, cleanup } = await bindCapturedRuntimeEvents();
        setBackendRealtimeOwner({
            friendProfileLoadStatus: 'running'
        });

        handlers.get('realtimeUserProjection')?.({
            source: 'friendProfileBulkLoad',
            users: [
                {
                    id: 'usr_pending',
                    endpoint: 'api.vrchat.cloud',
                    displayName: 'Pending Friend'
                }
            ]
        });
        cleanup();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(useUserFactsStore.getState().usersByKey).toEqual({});
    });

    it.each(['running', 'cancelling'] as const)(
        'applies normal realtime projections immediately while profile loading is %s',
        async (status) => {
            vi.useFakeTimers();
            const { handlers, cleanup } = await bindCapturedRuntimeEvents();
            setBackendRealtimeOwner({
                friendProfileLoadStatus: status
            });

            handlers.get('realtimeUserProjection')?.({
                source: 'friendProfileBulkLoad',
                users: [
                    {
                        id: 'usr_bulk',
                        endpoint: 'api.vrchat.cloud',
                        displayName: 'Bulk Friend'
                    }
                ]
            });
            handlers.get('realtimeFriendProjection')?.({
                generation: 1,
                baselineRevision: 1,
                source: 'friendProfileBulkLoad',
                patches: [
                    {
                        userId: 'usr_bulk',
                        patch: {
                            id: 'usr_bulk',
                            displayName: 'Bulk Friend'
                        },
                        stateBucket: 'offline',
                        stateBucketAuthority: 'preserve'
                    }
                ],
                removals: [],
                feedEntries: [],
                friendLogChanged: false
            });
            expect(useFriendRosterStore.getState().friendsById).toEqual({});
            expect(useUserFactsStore.getState().usersByKey).toEqual({});

            handlers.get('realtimeUserProjection')?.({
                users: [
                    {
                        id: 'usr_live',
                        endpoint: 'api.vrchat.cloud',
                        displayName: 'Live Friend'
                    }
                ]
            });
            handlers.get('realtimeFriendProjection')?.({
                generation: 1,
                baselineRevision: 1,
                patches: [
                    {
                        userId: 'usr_live',
                        patch: {
                            id: 'usr_live',
                            displayName: 'Live Friend',
                            status: 'offline'
                        },
                        stateBucket: 'online',
                        stateBucketAuthority: 'preserve'
                    }
                ],
                removals: [],
                feedEntries: [],
                friendLogChanged: false
            });

            expect(
                Object.keys(useFriendRosterStore.getState().friendsById)
            ).toEqual(['usr_bulk', 'usr_live']);
            expect(
                Object.values(useUserFactsStore.getState().usersByKey).map(
                    (user) => user.id
                )
            ).toEqual(['usr_bulk', 'usr_live']);
            await vi.advanceTimersByTimeAsync(10_000);
            expect(
                Object.keys(useFriendRosterStore.getState().friendsById)
            ).toEqual(['usr_bulk', 'usr_live']);

            cleanup();
        }
    );

    it('flushes pending friend profile projections when the load becomes terminal', async () => {
        vi.useFakeTimers();
        const { handlers, cleanup } = await bindCapturedRuntimeEvents();
        setBackendRealtimeOwner({
            friendProfileLoadStatus: 'running',
            friendProfileLoadRunId: 100
        });

        handlers.get('realtimeUserProjection')?.({
            source: 'friendProfileBulkLoad',
            users: [
                {
                    id: 'usr_terminal',
                    endpoint: 'api.vrchat.cloud',
                    displayName: 'Terminal Friend'
                }
            ]
        });
        handlers.get('realtimeFriendProjection')?.({
            generation: 1,
            baselineRevision: 1,
            source: 'friendProfileBulkLoad',
            patches: [
                {
                    userId: 'usr_terminal',
                    patch: {
                        id: 'usr_terminal',
                        displayName: 'Terminal Friend'
                    },
                    stateBucket: 'offline',
                    stateBucketAuthority: 'preserve'
                }
            ],
            removals: [],
            feedEntries: [],
            friendLogChanged: false
        });
        expect(useFriendRosterStore.getState().friendsById).toEqual({});

        handlers.get('friendProfileLoadStatus')?.({
            runId: 100,
            status: 'cancelled',
            total: 1,
            processed: 0,
            loaded: 0,
            failed: 0,
            startedAt: '2026-07-11T00:00:00.000Z',
            finishedAt: '2026-07-11T00:00:01.000Z',
            lastError: null
        });

        expect(
            Object.keys(useFriendRosterStore.getState().friendsById)
        ).toEqual(['usr_terminal']);
        expect(
            Object.values(useUserFactsStore.getState().usersByKey).map(
                (user) => user.id
            )
        ).toEqual(['usr_terminal']);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(
            Object.keys(useFriendRosterStore.getState().friendsById)
        ).toEqual(['usr_terminal']);

        cleanup();
    });
});
