import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    AuthenticatedRuntimePhaseSnapshot,
    BackendRuntimeSnapshot,
    HostSessionProjection,
    MutualGraphFetchStatus
} from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    subscribe:
        vi.fn<
            (
                name: string,
                handler: (payload: unknown) => void
            ) => Promise<() => void>
        >(),
    applyRuntimeGameLogProjection: vi.fn(),
    applyBackgroundImageProjectionEvent: vi.fn(),
    initializeBackgroundImage: vi.fn(),
    applyCommunityThemeProjectionEvent: vi.fn(),
    initializeCommunityThemes: vi.fn(),
    applyVrcStatusSnapshot: vi.fn(),
    handleFavoriteImportStatusEvent: vi.fn(),
    hydrateFavoriteImportRuntimeStatus: vi.fn(),
    handleMutualGraphFetchStatusEvent: vi.fn(),
    handleScreenshotLibraryScanStatusEvent: vi.fn(),
    handleGameRunningUpdate: vi.fn<() => Promise<void>>(),
    isHostCapabilityAvailable: vi.fn<(name: string) => boolean>(),
    refreshHostCapabilities: vi.fn(),
    pushSharedFeedNotification: vi.fn<() => Promise<void>>(),
    showSQLiteErrorDialog: vi.fn<() => Promise<void>>(),
    handleBrowserFocus: vi.fn<() => Promise<void>>(),
    getBackendRuntimeCombinedSnapshot: vi.fn(),
    getAncillaryRuntimeSnapshot: vi.fn(),
    runtimeGroupInstancesRefresh: vi.fn<() => Promise<null>>(),
    bindDeepLinkEvents: vi.fn<() => Promise<() => void>>(),
    drainPendingDeepLinks: vi.fn<() => Promise<void>>(),
    deepLinkUnsubscribe: vi.fn(),
    bindDesktopNotificationActivationEvents: vi.fn<() => Promise<() => void>>(),
    takePendingDesktopNotificationActivation: vi.fn<() => Promise<void>>(),
    desktopNotificationActivationUnsubscribe: vi.fn(),
    handleRuntimeAuthFailure: vi.fn(),
    applyAuthenticatedSessionProjection:
        vi.fn<(projection: unknown) => Promise<boolean>>(),
    loadVrcNotifications: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appBackendRuntimeCombinedSnapshotGet:
            mocks.getBackendRuntimeCombinedSnapshot,
        appAncillaryRuntimeSnapshotGet: mocks.getAncillaryRuntimeSnapshot,
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

vi.mock('./background-image/backgroundImageService', () => ({
    applyBackgroundImageProjectionEvent:
        mocks.applyBackgroundImageProjectionEvent,
    initializeBackgroundImage: mocks.initializeBackgroundImage
}));

vi.mock('./community-theme/installedThemes', () => ({
    applyCommunityThemeProjectionEvent:
        mocks.applyCommunityThemeProjectionEvent,
    initializeCommunityThemes: mocks.initializeCommunityThemes
}));

vi.mock('./favoriteImportService', () => ({
    handleFavoriteImportStatusEvent: mocks.handleFavoriteImportStatusEvent,
    hydrateFavoriteImportRuntimeStatus: mocks.hydrateFavoriteImportRuntimeStatus
}));

vi.mock('./mutualGraphFetchService', () => ({
    handleMutualGraphFetchStatusEvent: mocks.handleMutualGraphFetchStatusEvent
}));

vi.mock('./screenshotLibraryScanService', () => ({
    handleScreenshotLibraryScanStatusEvent:
        mocks.handleScreenshotLibraryScanStatusEvent
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
    applyVrcStatusSnapshot: mocks.applyVrcStatusSnapshot,
    handleBrowserFocus: mocks.handleBrowserFocus
}));

vi.mock('./backendRuntimeSessionResumeService', () => ({
    applyAuthenticatedSessionProjection:
        mocks.applyAuthenticatedSessionProjection
}));

vi.mock('./deepLinkService', () => ({
    bindDeepLinkEvents: mocks.bindDeepLinkEvents,
    drainPendingDeepLinks: mocks.drainPendingDeepLinks
}));

vi.mock('./desktopNotificationActivationService', () => ({
    bindDesktopNotificationActivationEvents:
        mocks.bindDesktopNotificationActivationEvents,
    takePendingDesktopNotificationActivation:
        mocks.takePendingDesktopNotificationActivation
}));

vi.mock('./authSessionRecoveryService', () => ({
    handleRuntimeAuthFailure: mocks.handleRuntimeAuthFailure
}));

vi.mock('@/state/vrcNotificationStore', () => ({
    useVrcNotificationStore: {
        getState: () => ({
            loadForCurrentUser: mocks.loadVrcNotifications
        })
    }
}));

import { useDataDirMigrationStore } from '@/state/dataDirMigrationStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useNotificationStore } from '@/state/notificationStore';
import { useProfileBackupStore } from '@/state/profileBackupStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useUserFactsStore } from '@/state/userFactsStore';

import {
    flushRealtimeRosterUpdates,
    resetRealtimeRosterUpdates
} from './realtimeRosterUpdateQueue';
import { bindRuntimeEvents } from './runtimeEventBridgeService';

function createBackendRuntimeSnapshot(): BackendRuntimeSnapshot {
    return {
        mode: 'foreground',
        phase: 'idle',
        authStatus: 'unknown',
        authUserId: '',
        authDisplayName: '',
        wsStatus: 'idle',
        gameLogStatus: 'idle',
        processStatus: 'unknown',
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
            finishedAt: null
        }
    };
}

function createGameProcessProjection(
    patch: Partial<HostSessionProjection> = {}
): HostSessionProjection {
    return {
        isGameRunning: false,
        isSteamVRRunning: false,
        lastGameStartedAt: null,
        lastGameStateChangedAt: null,
        generation: 0,
        gameChanged: false,
        steamvrChanged: false,
        changedAt: '',
        ...patch
    };
}

function createAuthenticatedRuntimePhaseSnapshot(
    patch: Partial<AuthenticatedRuntimePhaseSnapshot> = {}
): AuthenticatedRuntimePhaseSnapshot {
    return {
        runId: 9,
        authScopeGeneration: 7,
        userId: 'usr_owner',
        endpoint: 'https://api.vrchat.cloud/api/1',
        websocket: 'wss://pipeline.vrchat.cloud',
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
        friendBaseline: null,
        favoritesBaseline: null,
        realtimeTransport: {
            clientRunId: 9,
            generation: 12,
            sessionGeneration: 14
        },
        updatedAt: '2026-07-20T00:00:00.000Z',
        ...patch
    };
}

function createAncillaryRuntimeSnapshot(
    patch: Partial<
        import('@/platform/tauri/bindings').AncillaryRuntimeSnapshot
    > = {}
) {
    return {
        communityThemeState: {
            revision: 0,
            catalogUrl: '',
            enabled: false,
            installedTheme: null,
            installedThemes: [],
            installedCssSnapshot: '',
            overrideCss: '',
            overrideCssEnabled: false
        },
        profileBackupCurrentStatus: {
            revision: 0,
            state: 'idle',
            kind: null,
            phase: null,
            percent: null,
            error: null,
            lastOutcome: null
        },
        dataDirMigrationCurrentStatus: {
            revision: 0,
            state: 'idle'
        },
        mutualGraphFetchStatus: {
            runId: 0,
            revision: 0,
            status: 'idle',
            ownerUserId: '',
            totalFriends: 0,
            processedFriends: 0,
            currentFriendId: '',
            fetchedFriends: 0,
            optedOutFriends: 0,
            failedFriends: 0,
            cancelRequested: false,
            startedAt: '',
            updatedAt: '',
            finishedAt: null,
            lastError: null
        },
        appUpdateStatus: {
            hasAvailableUpdate: false,
            checkedAt: '',
            detail: '',
            error: null,
            release: null,
            shouldNotify: false
        },
        appUpdateDownloadStatus: {
            phase: 'idle',
            version: null,
            startedAt: null,
            downloadedBytes: 0,
            totalBytes: 0,
            percent: 0,
            error: null
        },
        gameClientDebugLoggingStatus: null,
        gameProcessSnapshot: createGameProcessProjection(),
        nowPlaying: {
            url: '',
            name: '',
            source: '',
            displayName: '',
            userId: null,
            location: null,
            thumbnailUrl: '',
            length: 0,
            position: 0,
            startedAt: null,
            created_at: null,
            type: null,
            videoUrl: null,
            videoName: null,
            videoId: null,
            updatedAt: null
        },
        backgroundImageState: {
            revision: 0,
            enabled: false,
            mode: 'off',
            providerId: 'nasa-epic',
            customSource: null,
            snapshot: null,
            error: null
        },
        ...patch
    };
}

function createBackendRuntimeCombinedSnapshot(
    patch: Partial<
        import('@/platform/tauri/bindings').BackendRuntimeCombinedSnapshot
    > = {}
) {
    return {
        backendRuntime: createBackendRuntimeSnapshot(),
        authenticatedSession: {
            revision: 0,
            session: null
        },
        authenticatedRuntimePhase: createAuthenticatedRuntimePhaseSnapshot({
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
            friendBaselineRevision: 0,
            realtimeTransport: null,
            updatedAt: ''
        }),
        ...patch
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
    useRuntimeStore.getState().setAuthenticatedSessionProjection({
        revision: 1,
        session: {
            authScopeGeneration: 7,
            userId,
            displayName: userId,
            endpoint: 'https://api.vrchat.cloud/api/1',
            websocket: 'wss://pipeline.vrchat.cloud',
            currentUserSnapshot: {
                id: userId,
                displayName: userId
            }
        }
    });
    if (authReady) {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: userId,
            currentUserEndpoint: 'https://api.vrchat.cloud/api/1',
            currentUserWebsocket: 'wss://pipeline.vrchat.cloud'
        });
    }
    if (friendProfileLoadStatus) {
        useRuntimeStore.getState().setFriendProfileLoadState({
            runId: friendProfileLoadRunId,
            status: friendProfileLoadStatus
        });
    }
    if (sessionReady) {
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            sessionPhase: 'ready'
        });
    }
    return snapshot;
}

describe('runtimeEventBridgeService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useFriendRosterStore.getState().resetRoster();
        useNotificationStore.getState().resetNotificationState();
        useSessionStore.getState().resetSessionState();
        useUserFactsStore.getState().resetUserFacts();
        useProfileBackupStore.getState().resetProfileBackupState();
        resetRealtimeRosterUpdates();
        vi.useRealTimers();
        mocks.isHostCapabilityAvailable.mockReturnValue(false);
        mocks.subscribe.mockResolvedValue(() => {});
        mocks.getBackendRuntimeCombinedSnapshot.mockResolvedValue(
            createBackendRuntimeCombinedSnapshot()
        );
        mocks.getAncillaryRuntimeSnapshot.mockResolvedValue(
            createAncillaryRuntimeSnapshot()
        );
        mocks.runtimeGroupInstancesRefresh.mockResolvedValue(null);
        mocks.handleGameRunningUpdate.mockResolvedValue(undefined);
        mocks.loadVrcNotifications.mockResolvedValue([]);
        mocks.hydrateFavoriteImportRuntimeStatus.mockResolvedValue(undefined);
        mocks.pushSharedFeedNotification.mockResolvedValue(undefined);
        mocks.bindDeepLinkEvents.mockResolvedValue(mocks.deepLinkUnsubscribe);
        mocks.drainPendingDeepLinks.mockResolvedValue(undefined);
        mocks.bindDesktopNotificationActivationEvents.mockResolvedValue(
            mocks.desktopNotificationActivationUnsubscribe
        );
        mocks.takePendingDesktopNotificationActivation.mockResolvedValue(
            undefined
        );
        mocks.applyAuthenticatedSessionProjection.mockResolvedValue(false);
        mocks.initializeBackgroundImage.mockResolvedValue(undefined);
        mocks.initializeCommunityThemes.mockResolvedValue(undefined);
    });

    it('hydrates the backend session before deferred appearance projections', async () => {
        let finishAppearanceHydration: () => void = () => {
            throw new Error('Appearance hydration was not initialized.');
        };
        const appearanceHydration = new Promise<void>((resolve) => {
            finishAppearanceHydration = resolve;
        });
        mocks.initializeCommunityThemes.mockReturnValue(appearanceHydration);
        mocks.initializeBackgroundImage.mockReturnValue(appearanceHydration);

        const binding = bindRuntimeEvents();
        try {
            await vi.waitFor(() => {
                expect(
                    mocks.getBackendRuntimeCombinedSnapshot
                ).toHaveBeenCalledTimes(1);
            });
        } finally {
            finishAppearanceHydration();
            await binding;
        }
    });

    it('refreshes browser status without a manual process query', async () => {
        mocks.isHostCapabilityAvailable.mockReturnValue(true);
        mocks.handleBrowserFocus.mockResolvedValue(undefined);
        const { handlers } = await bindCapturedRuntimeEvents();

        handlers.get('browserFocus')?.(null);

        expect(mocks.handleBrowserFocus).toHaveBeenCalledTimes(1);
    });

    it('routes the typed authenticated session projection without querying peer state', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        const projection = {
            revision: 4,
            session: {
                authScopeGeneration: 7,
                userId: 'usr_owner',
                displayName: 'Projected User',
                endpoint: 'https://api.vrchat.cloud/api/1',
                websocket: 'wss://pipeline.vrchat.cloud',
                currentUserSnapshot: {
                    id: 'usr_owner',
                    displayName: 'Projected User'
                }
            }
        };

        handlers.get('authenticatedSessionProjection')?.(projection);

        expect(
            mocks.applyAuthenticatedSessionProjection
        ).toHaveBeenLastCalledWith(projection);
    });

    it('routes only current-scope structured VRChat 401 events to auth recovery', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        setBackendRealtimeOwner();
        handlers.get('authenticatedRuntimePhase')?.(
            createAuthenticatedRuntimePhaseSnapshot()
        );
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
                reason: 'Missing Credentials (401)',
                statusCode: 401,
                path: 'user/usr_target/friendRequest',
                authScopeGeneration: 7
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

    it('ignores raw backend realtime auth failure telemetry', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        const snapshot = setBackendRealtimeOwner();

        handlers.get('backendRuntimeTelemetry')?.({
            snapshot: {
                ...snapshot,
                wsStatus: 'authFailure'
            }
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(mocks.handleRuntimeAuthFailure).not.toHaveBeenCalled();
    });

    it('routes a current typed realtime auth failure without waiting for WS status', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        setBackendRealtimeOwner();
        handlers.get('authenticatedRuntimePhase')?.(
            createAuthenticatedRuntimePhaseSnapshot()
        );

        handlers.get('runtimeVrchatAuthFailure')?.({
            ownerUserId: 'usr_owner',
            endpoint: 'https://api.vrchat.cloud/api/1',
            path: 'auth',
            reason: 'Forbidden',
            statusCode: 403,
            authScopeGeneration: 7,
            realtimeTransport: {
                clientRunId: 9,
                generation: 12,
                sessionGeneration: 14
            }
        });

        await vi.waitFor(() => {
            expect(mocks.handleRuntimeAuthFailure).toHaveBeenCalledTimes(1);
        });
        expect(mocks.handleRuntimeAuthFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                reason: 'Forbidden',
                statusCode: 403,
                path: 'auth',
                authScopeGeneration: 7
            })
        );

        handlers.get('runtimeVrchatAuthFailure')?.({
            ownerUserId: 'usr_owner',
            endpoint: 'https://api.vrchat.cloud/api/1',
            path: 'auth',
            reason: 'stale',
            statusCode: 401,
            authScopeGeneration: 7,
            realtimeTransport: {
                clientRunId: 9,
                generation: 11,
                sessionGeneration: 14
            }
        });
        await Promise.resolve();
        expect(mocks.handleRuntimeAuthFailure).toHaveBeenCalledTimes(1);
    });

    it('ignores auth failures until their current runtime authority arrives', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        setBackendRealtimeOwner();
        const failure = {
            ownerUserId: 'usr_owner',
            endpoint: 'https://api.vrchat.cloud/api/1',
            path: 'auth',
            reason: 'Forbidden',
            statusCode: 403,
            authScopeGeneration: 7,
            realtimeTransport: {
                clientRunId: 9,
                generation: 12,
                sessionGeneration: 14
            }
        } as const;

        handlers.get('runtimeVrchatAuthFailure')?.(failure);
        await Promise.resolve();
        expect(mocks.handleRuntimeAuthFailure).not.toHaveBeenCalled();

        handlers.get('authenticatedRuntimePhase')?.(
            createAuthenticatedRuntimePhaseSnapshot()
        );
        handlers.get('runtimeVrchatAuthFailure')?.(failure);

        await vi.waitFor(() => {
            expect(mocks.handleRuntimeAuthFailure).toHaveBeenCalledTimes(1);
        });
    });

    it('does not let an out-of-order stale phase authorize an old auth failure', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        setBackendRealtimeOwner();
        handlers.get('authenticatedRuntimePhase')?.(
            createAuthenticatedRuntimePhaseSnapshot()
        );
        handlers.get('authenticatedRuntimePhase')?.(
            createAuthenticatedRuntimePhaseSnapshot({
                runId: 8,
                authScopeGeneration: 6,
                realtimeTransport: {
                    clientRunId: 8,
                    generation: 11,
                    sessionGeneration: 13
                },
                updatedAt: '2026-07-19T23:59:59.000Z'
            })
        );

        handlers.get('runtimeVrchatAuthFailure')?.({
            ownerUserId: 'usr_owner',
            endpoint: 'https://api.vrchat.cloud/api/1',
            path: 'auth',
            reason: 'stale',
            statusCode: 403,
            authScopeGeneration: 6,
            realtimeTransport: {
                clientRunId: 8,
                generation: 11,
                sessionGeneration: 13
            }
        });
        await Promise.resolve();

        expect(mocks.handleRuntimeAuthFailure).not.toHaveBeenCalled();
    });

    it('drains pending shell actions after backend runtime snapshot hydration', async () => {
        const calls: string[] = [];
        mocks.bindDeepLinkEvents.mockImplementation(async () => {
            calls.push('bind-deep-link-events');
            return mocks.deepLinkUnsubscribe;
        });
        mocks.bindDesktopNotificationActivationEvents.mockImplementation(
            async () => {
                calls.push('bind-desktop-notification-events');
                return mocks.desktopNotificationActivationUnsubscribe;
            }
        );
        mocks.getBackendRuntimeCombinedSnapshot.mockImplementation(async () => {
            calls.push('get-backend-snapshot');
            return createBackendRuntimeCombinedSnapshot();
        });
        mocks.applyAuthenticatedSessionProjection.mockImplementation(
            async () => {
                calls.push('hydrate-backend-snapshot');
                return false;
            }
        );
        mocks.drainPendingDeepLinks.mockImplementation(async () => {
            calls.push('drain-deep-links');
        });
        mocks.takePendingDesktopNotificationActivation.mockImplementation(
            async () => {
                calls.push('take-desktop-notification-activation');
            }
        );

        await bindRuntimeEvents();

        expect(calls).toEqual([
            'get-backend-snapshot',
            'hydrate-backend-snapshot',
            'bind-deep-link-events',
            'bind-desktop-notification-events',
            'drain-deep-links',
            'take-desktop-notification-activation'
        ]);
        expect(mocks.drainPendingDeepLinks).toHaveBeenCalledTimes(1);
        expect(
            mocks.takePendingDesktopNotificationActivation
        ).toHaveBeenCalledTimes(1);
    });

    it('hydrates the community theme after runtime events are subscribed', async () => {
        await bindRuntimeEvents();

        expect(mocks.subscribe).toHaveBeenCalledWith(
            'communityThemeState',
            expect.any(Function)
        );
        expect(mocks.subscribe.mock.invocationCallOrder.at(-1)).toBeLessThan(
            mocks.initializeCommunityThemes.mock.invocationCallOrder[0]
        );
    });

    it('hydrates an already-running game over a stale mirror after subscribing', async () => {
        mocks.isHostCapabilityAvailable.mockReturnValue(true);
        useRuntimeStore.getState().setGameState({
            isGameRunning: false,
            isSteamVRRunning: false
        });
        mocks.getAncillaryRuntimeSnapshot.mockResolvedValue(
            createAncillaryRuntimeSnapshot({
                gameProcessSnapshot: createGameProcessProjection({
                    isGameRunning: true,
                    isSteamVRRunning: true,
                    lastGameStartedAt: '2026-08-05T00:00:00.000Z',
                    lastGameStateChangedAt: '2026-08-05T00:00:00.000Z',
                    generation: 1,
                    changedAt: '2026-08-05T00:00:00.000Z'
                })
            })
        );

        await bindRuntimeEvents();

        expect(mocks.subscribe).toHaveBeenCalledWith(
            'updateIsGameRunning',
            expect.any(Function)
        );
        expect(mocks.subscribe.mock.invocationCallOrder.at(-1)).toBeLessThan(
            mocks.getAncillaryRuntimeSnapshot.mock.invocationCallOrder[0]
        );
        expect(mocks.handleGameRunningUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                isGameRunning: true,
                isSteamVRRunning: true
            })
        );
    });

    it('does not overwrite a game process event received during hydration', async () => {
        mocks.isHostCapabilityAvailable.mockReturnValue(true);
        let updateGameProcess: (payload: unknown) => void = () => {
            throw new Error('Game process event was not subscribed.');
        };
        mocks.subscribe.mockImplementation(async (name, handler) => {
            if (name === 'updateIsGameRunning') {
                updateGameProcess = handler;
            }
            return () => {};
        });
        let finishAncillarySnapshot: (
            snapshot: ReturnType<typeof createAncillaryRuntimeSnapshot>
        ) => void = () => {
            throw new Error('Ancillary runtime snapshot was not requested.');
        };
        mocks.getAncillaryRuntimeSnapshot.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishAncillarySnapshot = resolve;
                })
        );
        const binding = bindRuntimeEvents();
        await vi.waitFor(() => {
            expect(mocks.getAncillaryRuntimeSnapshot).toHaveBeenCalledTimes(1);
        });
        const liveProjection = createGameProcessProjection({
            isGameRunning: true,
            isSteamVRRunning: true,
            lastGameStartedAt: '2026-08-05T00:01:00.000Z',
            lastGameStateChangedAt: '2026-08-05T00:01:00.000Z',
            generation: 1,
            gameChanged: true,
            steamvrChanged: true,
            changedAt: '2026-08-05T00:01:00.000Z'
        });
        updateGameProcess(liveProjection);

        finishAncillarySnapshot(
            createAncillaryRuntimeSnapshot({
                gameProcessSnapshot: createGameProcessProjection()
            })
        );
        await binding;

        expect(mocks.handleGameRunningUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.handleGameRunningUpdate).toHaveBeenCalledWith(
            liveProjection
        );
    });

    it('hydrates now playing from the ancillary runtime snapshot', async () => {
        mocks.getAncillaryRuntimeSnapshot.mockResolvedValue(
            createAncillaryRuntimeSnapshot({
                nowPlaying: {
                    ...createAncillaryRuntimeSnapshot().nowPlaying,
                    url: 'https://example.test/current',
                    name: 'Current Track',
                    position: 42
                }
            })
        );

        await bindRuntimeEvents();

        expect(useRuntimeStore.getState().nowPlaying).toMatchObject({
            url: 'https://example.test/current',
            name: 'Current Track',
            position: 42
        });
    });

    it('does not overwrite a now-playing event received during hydration', async () => {
        mocks.isHostCapabilityAvailable.mockImplementation(
            (name) => name === 'runtimeGameLogSideEffects'
        );
        let sideEffect: (payload: unknown) => void = () => {
            throw new Error('GameLog side-effect event was not subscribed.');
        };
        mocks.subscribe.mockImplementation(async (name, handler) => {
            if (name === 'gameLogSideEffect') {
                sideEffect = handler;
            }
            return () => {};
        });
        let finishAncillarySnapshot: (
            snapshot: ReturnType<typeof createAncillaryRuntimeSnapshot>
        ) => void = () => {
            throw new Error('Ancillary runtime snapshot was not requested.');
        };
        mocks.getAncillaryRuntimeSnapshot.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishAncillarySnapshot = resolve;
                })
        );
        const binding = bindRuntimeEvents();
        await vi.waitFor(() => {
            expect(mocks.getAncillaryRuntimeSnapshot).toHaveBeenCalledTimes(1);
        });
        sideEffect({
            kind: 'nowPlaying',
            payload: {
                url: 'https://example.test/live',
                name: 'Live Track',
                position: 7,
                startedAt: '2026-09-01T00:00:00Z'
            }
        });

        finishAncillarySnapshot(
            createAncillaryRuntimeSnapshot({
                nowPlaying: {
                    ...createAncillaryRuntimeSnapshot().nowPlaying,
                    url: 'https://example.test/stale',
                    name: 'Stale Track'
                }
            })
        );
        await binding;

        expect(useRuntimeStore.getState().nowPlaying).toMatchObject({
            url: 'https://example.test/live',
            name: 'Live Track',
            position: 7
        });
    });

    it('still hydrates now playing after an unrelated GameLog side effect', async () => {
        mocks.isHostCapabilityAvailable.mockImplementation(
            (name) => name === 'runtimeGameLogSideEffects'
        );
        let sideEffect: (payload: unknown) => void = () => {
            throw new Error('GameLog side-effect event was not subscribed.');
        };
        mocks.subscribe.mockImplementation(async (name, handler) => {
            if (name === 'gameLogSideEffect') {
                sideEffect = handler;
            }
            return () => {};
        });
        let finishAncillarySnapshot: (
            snapshot: ReturnType<typeof createAncillaryRuntimeSnapshot>
        ) => void = () => {
            throw new Error('Ancillary runtime snapshot was not requested.');
        };
        mocks.getAncillaryRuntimeSnapshot.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishAncillarySnapshot = resolve;
                })
        );
        const binding = bindRuntimeEvents();
        await vi.waitFor(() => {
            expect(mocks.getAncillaryRuntimeSnapshot).toHaveBeenCalledTimes(1);
        });
        sideEffect({
            kind: 'screenshotProcessed',
            payload: {
                path: 'C:\\Screenshots\\capture.png',
                createdAt: '2026-09-01T00:00:00Z'
            }
        });

        finishAncillarySnapshot(
            createAncillaryRuntimeSnapshot({
                nowPlaying: {
                    ...createAncillaryRuntimeSnapshot().nowPlaying,
                    url: 'https://example.test/current',
                    name: 'Current Track'
                }
            })
        );
        await binding;

        expect(useRuntimeStore.getState().nowPlaying).toMatchObject({
            url: 'https://example.test/current',
            name: 'Current Track'
        });
    });

    it('unsubscribes every successful runtime event when one subscription fails', async () => {
        const failedSubscriptionName = 'gameLogProjection';
        const attemptedSubscriptionNames: string[] = [];
        const successfulSubscriptionNames: string[] = [];
        const successfulUnsubscribes: ReturnType<typeof vi.fn>[] = [];
        mocks.subscribe.mockImplementation(async (name) => {
            attemptedSubscriptionNames.push(name);
            if (name === failedSubscriptionName) {
                throw new Error('subscription failed');
            }
            const unsubscribe = vi.fn();
            successfulSubscriptionNames.push(name);
            successfulUnsubscribes.push(unsubscribe);
            return unsubscribe;
        });

        await expect(bindRuntimeEvents()).rejects.toThrow(
            'subscription failed'
        );

        expect(new Set(attemptedSubscriptionNames).size).toBe(
            attemptedSubscriptionNames.length
        );
        expect(successfulSubscriptionNames).toEqual(
            attemptedSubscriptionNames.filter(
                (name) => name !== failedSubscriptionName
            )
        );
        successfulUnsubscribes.forEach((unsubscribe) => {
            expect(unsubscribe).toHaveBeenCalledOnce();
        });
        expect(useSessionStore.getState().transportStatus).toBe('disconnected');
        expect(mocks.bindDeepLinkEvents).not.toHaveBeenCalled();
    });

    it('cleans subscriptions when deep-link startup fails', async () => {
        vi.useFakeTimers();
        const handlers = new Map<string, (payload: unknown) => void>();
        const successfulRuntimeSubscriptionNames: string[] = [];
        const runtimeUnsubscribes: ReturnType<typeof vi.fn>[] = [];
        mocks.subscribe.mockImplementation((name, handler) => {
            handlers.set(name, handler);
            const unsubscribe = vi.fn();
            successfulRuntimeSubscriptionNames.push(name);
            runtimeUnsubscribes.push(unsubscribe);
            return Promise.resolve(unsubscribe);
        });
        mocks.bindDeepLinkEvents.mockImplementation(async () => {
            setBackendRealtimeOwner();
            return mocks.deepLinkUnsubscribe;
        });
        mocks.drainPendingDeepLinks.mockRejectedValue(
            new Error('deep-link startup failed')
        );

        await expect(bindRuntimeEvents()).rejects.toThrow(
            'deep-link startup failed'
        );
        await vi.advanceTimersByTimeAsync(10_000);

        expect(new Set(successfulRuntimeSubscriptionNames).size).toBe(
            successfulRuntimeSubscriptionNames.length
        );
        runtimeUnsubscribes.forEach((unsubscribe) => {
            expect(unsubscribe).toHaveBeenCalledOnce();
        });
        expect(mocks.deepLinkUnsubscribe).toHaveBeenCalledTimes(1);
        expect(
            mocks.desktopNotificationActivationUnsubscribe
        ).toHaveBeenCalledTimes(1);
        expect(useSessionStore.getState().transportStatus).toBe('disconnected');
        expect(useUserFactsStore.getState().usersByKey).toEqual({});
    });

    it('hydrates backup status after subscribing and applies newer events', async () => {
        const handlers = new Map<string, (payload: unknown) => void>();
        mocks.subscribe.mockImplementation(async (name, handler) => {
            handlers.set(name, handler);
            return () => {};
        });
        mocks.getAncillaryRuntimeSnapshot.mockResolvedValueOnce(
            createAncillaryRuntimeSnapshot({
                profileBackupCurrentStatus: {
                    revision: 3,
                    state: 'running',
                    kind: 'auto',
                    phase: 'snapshot',
                    percent: 15,
                    error: null,
                    lastOutcome: null
                }
            })
        );

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

    it('hydrates mutual status once and routes later typed task events', async () => {
        const handlers = new Map<string, (payload: unknown) => void>();
        mocks.subscribe.mockImplementation(async (name, handler) => {
            handlers.set(name, handler);
            return () => {};
        });
        const hydratedMutualStatus: MutualGraphFetchStatus = {
            runId: 3,
            revision: 1,
            status: 'running',
            ownerUserId: 'usr_hydrated',
            totalFriends: 0,
            processedFriends: 0,
            currentFriendId: '',
            fetchedFriends: 0,
            optedOutFriends: 0,
            failedFriends: 0,
            cancelRequested: false,
            startedAt: '',
            updatedAt: '',
            finishedAt: null,
            lastError: null
        };
        mocks.getAncillaryRuntimeSnapshot.mockResolvedValueOnce(
            createAncillaryRuntimeSnapshot({
                mutualGraphFetchStatus: hydratedMutualStatus
            })
        );

        await bindRuntimeEvents();
        const mutualStatus = {
            runId: 4,
            status: 'running',
            ownerUserId: 'usr_owner'
        };
        const screenshotStatus = {
            running: false,
            scanned: 3,
            indexed: 2
        };
        handlers.get('mutualGraphFetchStatus')?.(mutualStatus);
        handlers.get('screenshotLibraryScanStatus')?.(screenshotStatus);
        const vrcStatus = {
            status: 'operational',
            indicator: 'none',
            summary: 'All systems operational',
            updatedAt: '2026-07-31T00:00:00.000Z',
            lastFetchedAt: '2026-07-31T00:00:00.000Z',
            pollingIntervalMs: 900_000,
            refreshing: false,
            error: ''
        };
        handlers.get('vrcStatus')?.(vrcStatus);

        expect(mocks.handleMutualGraphFetchStatusEvent).toHaveBeenCalledWith(
            hydratedMutualStatus
        );
        expect(mocks.handleMutualGraphFetchStatusEvent).toHaveBeenCalledWith(
            mutualStatus
        );
        expect(
            mocks.handleScreenshotLibraryScanStatusEvent
        ).toHaveBeenCalledWith(screenshotStatus);
        expect(mocks.applyVrcStatusSnapshot).toHaveBeenCalledWith(vrcStatus);
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

    it('hydrates and applies data directory migration progress', async () => {
        const handlers = new Map<string, (payload: unknown) => void>();
        mocks.subscribe.mockImplementation(async (name, handler) => {
            handlers.set(name, handler);
            return () => {};
        });
        mocks.getAncillaryRuntimeSnapshot.mockResolvedValueOnce(
            createAncillaryRuntimeSnapshot({
                dataDirMigrationCurrentStatus: {
                    revision: 2,
                    state: 'running',
                    phase: 'copying',
                    percent: 20
                }
            })
        );

        await bindRuntimeEvents();
        handlers.get('dataDirMigration')?.({
            revision: 3,
            state: 'running',
            phase: 'copying',
            percent: 70
        });

        expect(useDataDirMigrationStore.getState().status).toMatchObject({
            revision: 3,
            phase: 'copying',
            percent: 70
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
            attemptedRowCount: 1
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

    it('routes typed GameLog side-effect variants', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        mocks.isHostCapabilityAvailable.mockImplementation(
            (name) => name === 'runtimeGameLogSideEffects'
        );

        handlers.get('gameLogSideEffect')?.({
            kind: 'gameNoVR',
            payload: { isGameNoVR: true }
        });

        expect(useRuntimeStore.getState().gameState.isGameNoVR).toBe(true);
    });

    it('routes typed game-client variants', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        mocks.isHostCapabilityAvailable.mockImplementation(
            (name) => name === 'runtimeGameClientLifecycle'
        );

        handlers.get('gameClientEvent')?.({
            kind: 'notification',
            payload: {
                level: 'warning',
                title: 'VRChat crash detected',
                message: 'VRChat crashed, attempting to rejoin last instance.'
            }
        });

        expect(useNotificationStore.getState().items[0]).toMatchObject({
            level: 'warning',
            title: 'VRChat crash detected'
        });
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

        handlers.get('realtimeProjectionSync')?.({
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

    it('uses the authenticated session projection instead of diagnostic auth fields', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        const snapshot = setBackendRealtimeOwner();
        useRuntimeStore.getState().setBackendRuntimeSnapshot({
            ...snapshot,
            authStatus: 'signedOut',
            authUserId: 'usr_stale_diagnostic'
        });

        handlers.get('realtimeUserProjection')?.({
            generation: 1,
            users: [
                {
                    id: 'usr_projected',
                    endpoint: 'api.vrchat.cloud',
                    displayName: 'Projected User'
                }
            ]
        });

        expect(
            Object.values(useUserFactsStore.getState().usersByKey).map(
                (user) => user.id
            )
        ).toEqual(['usr_projected']);
    });

    it('flushes queued backend projections from the projection sync event only', async () => {
        const { handlers } = await bindCapturedRuntimeEvents();
        const runningSnapshot = setBackendRealtimeOwner({
            authReady: false,
            sessionReady: false
        });

        handlers.get('realtimeUserProjection')?.({
            generation: 1,
            users: [
                {
                    id: 'usr_queued',
                    endpoint: 'api.vrchat.cloud',
                    displayName: 'Queued User'
                }
            ]
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_owner'
        });
        useSessionStore.getState().setSessionPhase('ready');

        handlers.get('backendRuntimeTelemetry')?.({
            kind: 'gameLogPersisted',
            detail: '1',
            snapshot: runningSnapshot
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(useUserFactsStore.getState().usersByKey).toEqual({});

        handlers.get('realtimeProjectionSync')?.({
            snapshot: runningSnapshot
        });
        await vi.waitFor(() => {
            expect(
                Object.values(useUserFactsStore.getState().usersByKey).map(
                    (user) => user.id
                )
            ).toEqual(['usr_queued']);
        });
    });

    it('prunes queued backend projections when the auth generation changes', async () => {
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

        useRuntimeStore.getState().setAuthenticatedSessionProjection({
            revision: 2,
            session: {
                authScopeGeneration: 4,
                userId: 'usr_owner',
                displayName: 'Owner',
                endpoint: 'https://api.vrchat.cloud/api/1',
                websocket: 'wss://pipeline.vrchat.cloud',
                currentUserSnapshot: {
                    id: 'usr_owner',
                    displayName: 'Owner'
                }
            }
        });
        handlers.get('realtimeProjectionSync')?.({
            snapshot: runningSnapshot
        });
        await Promise.resolve();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_owner'
        });
        useSessionStore.getState().setSessionPhase('ready');
        handlers.get('realtimeProjectionSync')?.({
            snapshot: runningSnapshot
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
        secondBinding.handlers.get('realtimeProjectionSync')?.({
            snapshot: runningSnapshot
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(useUserFactsStore.getState().usersByKey).toEqual({});
        secondBinding.cleanup();
    });

    it.each(['running', 'cancelling'] as const)(
        'coalesces friend profile projections into one roster update while profile loading is %s',
        async (status) => {
            const { handlers, cleanup } = await bindCapturedRuntimeEvents();
            setBackendRealtimeOwner({
                friendProfileLoadStatus: status
            });

            for (const userId of ['usr_a', 'usr_b']) {
                handlers.get('realtimeUserProjection')?.({
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
            flushRealtimeRosterUpdates();

            expect(
                Object.keys(useFriendRosterStore.getState().friendsById)
            ).toEqual(['usr_a', 'usr_b']);
            expect(
                Object.values(useUserFactsStore.getState().usersByKey).map(
                    (user) => user.id
                )
            ).toEqual(['usr_a', 'usr_b']);

            cleanup();
        }
    );

    it('drops realtime projections from a superseded realtime generation', async () => {
        const { handlers, cleanup } = await bindCapturedRuntimeEvents();
        setBackendRealtimeOwner();
        handlers.get('authenticatedRuntimePhase')?.(
            createAuthenticatedRuntimePhaseSnapshot()
        );

        handlers.get('realtimeFriendProjection')?.({
            generation: 11,
            baselineRevision: 1,
            patches: [
                {
                    userId: 'usr_stale',
                    patch: {
                        id: 'usr_stale',
                        displayName: 'usr_stale',
                        state: 'online'
                    },
                    stateBucket: 'online',
                    stateBucketAuthority: 'explicit'
                }
            ],
            removals: [],
            feedEntries: [],
            friendLogChanged: false
        });

        expect(useFriendRosterStore.getState().friendsById).toEqual({});

        handlers.get('realtimeFriendProjection')?.({
            generation: 12,
            baselineRevision: 1,
            patches: [
                {
                    userId: 'usr_live',
                    patch: {
                        id: 'usr_live',
                        displayName: 'usr_live',
                        state: 'online'
                    },
                    stateBucket: 'online',
                    stateBucketAuthority: 'explicit'
                }
            ],
            removals: [],
            feedEntries: [],
            friendLogChanged: false
        });

        expect(
            Object.keys(useFriendRosterStore.getState().friendsById)
        ).toEqual(['usr_live']);

        cleanup();
    });
});
