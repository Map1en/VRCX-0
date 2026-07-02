import { create } from 'zustand';

import { MINUTE_MS } from '@/shared/constants/time';

type TaskState = {
    status: string;
    detail: string;
    updatedAt: string | null;
};

type RuntimeEventState = {
    count: number;
    lastPayload: unknown;
    lastReceivedAt: string | null;
};

type TransportState = Record<string, unknown> & {
    websocketConnected: boolean;
    websocketDomain: string;
    reconnectCount: number;
    lastConnectedAt: string | null;
    lastDisconnectedAt: string | null;
    ipcAnnounced: boolean;
    lastIpcAnnouncedAt: string | null;
};

type ActivityState = Record<string, unknown> & {
    currentUserId: string | null;
    status: string;
    detail: string;
    cachedRangeDays: number;
    sessionCount: number;
    fullCacheReady: boolean;
    lastUpdatedAt: string | null;
    lastReadyAt: string | null;
};

type MutualGraphState = Record<string, unknown> & {
    runId: number;
    status: string;
    ownerUserId: string;
    totalFriends: number;
    processedFriends: number;
    currentFriendId: string;
    fetchedFriends: number;
    optedOutFriends: number;
    failedFriends: number;
    cancelRequested: boolean;
    startedAt: string | null;
    updatedAt: string | null;
    finishedAt: string | null;
    lastError: string | null;
};

type InstanceQueueState = Record<string, unknown> & {
    active: boolean;
    instanceLocation: string;
    position: number;
    queueSize: number;
    label: string;
    updatedAt: string | null;
};

export type VrcStatusState = Record<string, unknown> & {
    status: string;
    indicator: string;
    summary: string;
    updatedAt: string | null;
    lastFetchedAt: string | null;
    pollingIntervalMs: number;
    refreshing: boolean;
    error: string;
};

type CapabilityStatus = {
    supported: boolean;
    enabled: boolean;
    available: boolean;
    reason?: string;
};

type HostCapabilitiesState = Record<string, unknown> & {
    platform: string;
    arch: string;
    linuxPackageKind: string;
    localDatabase: CapabilityStatus;
    websocketRuntime: CapabilityStatus;
    gameLogWatcher: CapabilityStatus;
    runtimeGameLogIngest: CapabilityStatus;
    runtimeGameLogSideEffects: CapabilityStatus;
    runtimeGameClientLifecycle: CapabilityStatus;
    runtimeRealtimeTransport: CapabilityStatus;
    gameProcessMonitor: CapabilityStatus;
    vrchatPathDiscovery: CapabilityStatus;
    steamLibraryDiscovery: CapabilityStatus;
    steamRuntimeIntegration: CapabilityStatus;
    registryPrefs: CapabilityStatus;
    gameLaunch: CapabilityStatus;
    ipc: CapabilityStatus;
    vrchatLaunchPipe: CapabilityStatus;
    screenshotCache: CapabilityStatus;
};

export type CurrentUserSnapshotState = Record<string, unknown> & {
    id?: string;
    endpoint?: string;
    updatedAt?: string;
    displayName?: string;
    username?: string;
    status?: string;
    developerType?: string;
    currentAvatar?: string;
    currentAvatarImageUrl?: string;
    currentAvatarThumbnailImageUrl?: string;
    currentAvatarName?: string;
    homeLocation?: string | null;
    location?: string;
    $locationTag?: string;
    tags?: string[];
    platform?: string;
    last_platform?: string;
    $isVRCPlus?: boolean;
    $previousAvatarSwapTime?: number | null;
    presence?: Record<string, unknown> & {
        platform?: string;
    };
};

type UpdateLoopRelease = Record<string, unknown> & {
    canonicalVersion?: string;
    currentVersion?: string;
    latestVersion?: string;
    publishedAt?: string;
    title?: string;
};

type GroupInstancesState = Record<string, unknown> & {
    status: string;
    userId: string;
    endpoint: string;
    instances: unknown[];
    groupOrder: unknown[];
    fetchedAt: string | null;
    lastLoadedAt: string | null;
    error: string;
};

type RuntimeStore = {
    startup: Record<string, TaskState>;
    hostCapabilities: HostCapabilitiesState;
    auth: Record<string, unknown> & {
        currentUserId: string | null;
        currentUserDisplayName: string;
        currentUserEndpoint: string;
        currentUserWebsocket: string;
        currentUserSnapshot: CurrentUserSnapshotState | null;
    };
    updateLoop: Record<string, unknown> & {
        isRunning: boolean;
        tickCount: number;
        hasAvailableUpdate: boolean;
        latestUpdaterRelease: UpdateLoopRelease | null;
        autoDownloadState:
            | 'idle'
            | 'downloading'
            | 'downloaded'
            | 'installing'
            | 'error';
        downloadedVersion: string | null;
        downloadProgress: number;
    };
    activity: ActivityState;
    mutualGraph: MutualGraphState;
    transport: TransportState;
    gameState: Record<string, unknown> & {
        isGameRunning: boolean | null;
        isSteamVRRunning: boolean | null;
        isGameNoVR: boolean;
        currentLocation: string;
        currentWorldId: string;
        currentWorldName: string;
        currentDestination: string;
        currentLocationStartedAt: string | null;
        currentLocationPlayerIds: unknown[];
        currentLocationPlayers: unknown[];
        lastGameStateChangedAt: string | null;
        lastGameStartedAt: string | null;
        lastCrashedAt: string | null;
        lastGameLogAt: string | null;
        lastGameLogType: string;
        lastScreenshotPath: string;
        lastBrowserFocusAt: string | null;
        externalNotifierVersion: number;
    };
    nowPlaying: Record<string, unknown> & {
        url: string;
        name: string;
        source: string;
        displayName: string;
        thumbnailUrl: string;
        length: number;
        position: number;
        startedAt: string | null;
        updatedAt: string | null;
    };
    instanceQueue: InstanceQueueState;
    vrcStatus: VrcStatusState;
    groupInstances: GroupInstancesState;
    systemHosts: Record<string, boolean>;
    changelogTargetVersion: string;
    databaseUpgrade: Record<string, unknown> & {
        open: boolean;
        phase: string;
        fromVersion: number;
        toVersion: number;
        detail: string;
        legacyMigrationAvailable: boolean;
    };
    runtimeEvents: Record<string, RuntimeEventState>;
    backendRuntime: Record<string, unknown>;
    shell: Record<string, unknown> & {
        backendRuntimeSnapshotHydrated: boolean;
        backendRuntimeSessionHydrating: boolean;
    };
    setStartupTask(task: string, status: string, detail?: string): void;
    setAuthBootstrap(payload: Partial<RuntimeStore['auth']>): void;
    setHostCapabilities(payload?: Record<string, unknown> | null): void;
    setUpdateLoopState(patch: Record<string, unknown>): void;
    setActivityState(patch: Partial<ActivityState>): void;
    resetActivityState(): void;
    setMutualGraphState(patch: Partial<MutualGraphState>): void;
    resetMutualGraphState(): void;
    setTransportState(patch: Partial<TransportState>): void;
    incrementTransportReconnect(): void;
    recordRuntimeEvent(name: string, payload: unknown): void;
    setBackendRuntimeSnapshot(snapshot: Record<string, unknown> | null): void;
    setShellState(patch: Record<string, unknown>): void;
    setGameState(patch: Partial<RuntimeStore['gameState']>): void;
    setNowPlayingState(patch: Record<string, unknown>): void;
    resetNowPlayingState(): void;
    setInstanceQueueState(patch: Partial<InstanceQueueState>): void;
    clearInstanceQueueState(): void;
    setVrcStatusState(patch: Partial<VrcStatusState>): void;
    setGroupInstancesState(
        patch: Partial<RuntimeStore['groupInstances']>
    ): void;
    setChangelogTargetVersion(version: unknown): void;
    setSystemHostOpen(name: string, value: unknown): void;
    setDatabaseUpgradeState(
        patch: Partial<RuntimeStore['databaseUpgrade']>
    ): void;
    resetRuntimeState(): void;
};

function createTaskState(): TaskState {
    return {
        status: 'idle',
        detail: '',
        updatedAt: null
    };
}

function createRuntimeEventState(): RuntimeEventState {
    return {
        count: 0,
        lastPayload: null,
        lastReceivedAt: null
    };
}

function createTransportState(): TransportState {
    return {
        websocketConnected: false,
        websocketDomain: '',
        reconnectCount: 0,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        ipcAnnounced: false,
        lastIpcAnnouncedAt: null
    };
}

function createActivityState(): ActivityState {
    return {
        currentUserId: null,
        status: 'idle',
        detail: '',
        cachedRangeDays: 0,
        sessionCount: 0,
        fullCacheReady: false,
        lastUpdatedAt: null,
        lastReadyAt: null
    };
}

function createMutualGraphState(): MutualGraphState {
    return {
        runId: 0,
        status: 'idle',
        ownerUserId: '',
        totalFriends: 0,
        processedFriends: 0,
        currentFriendId: '',
        fetchedFriends: 0,
        optedOutFriends: 0,
        failedFriends: 0,
        cancelRequested: false,
        startedAt: null,
        updatedAt: null,
        finishedAt: null,
        lastError: null
    };
}

function createNowPlayingState(): RuntimeStore['nowPlaying'] {
    return {
        url: '',
        name: '',
        source: '',
        displayName: '',
        thumbnailUrl: '',
        length: 0,
        position: 0,
        startedAt: null,
        updatedAt: null
    };
}

function createInstanceQueueState(): InstanceQueueState {
    return {
        active: false,
        instanceLocation: '',
        position: 0,
        queueSize: 0,
        label: '',
        updatedAt: null
    };
}

export function createGroupInstancesState(): GroupInstancesState {
    return {
        status: 'idle',
        userId: '',
        endpoint: '',
        instances: [],
        groupOrder: [],
        fetchedAt: null,
        lastLoadedAt: null,
        error: ''
    };
}

const HOST_CAPABILITY_KEYS = Object.freeze([
    'localDatabase',
    'websocketRuntime',
    'gameLogWatcher',
    'runtimeGameLogIngest',
    'runtimeGameLogSideEffects',
    'runtimeGameClientLifecycle',
    'runtimeRealtimeTransport',
    'gameProcessMonitor',
    'vrchatPathDiscovery',
    'steamLibraryDiscovery',
    'steamRuntimeIntegration',
    'registryPrefs',
    'gameLaunch',
    'ipc',
    'vrchatLaunchPipe',
    'screenshotCache'
]);

function createCapabilityStatus(
    reason: unknown = 'Host capabilities have not loaded.'
) {
    return {
        supported: false,
        enabled: false,
        available: false,
        reason
    };
}

function createHostCapabilities(): RuntimeStore['hostCapabilities'] {
    const capabilities: Partial<RuntimeStore['hostCapabilities']> = {
        platform: 'unknown',
        arch: 'unknown',
        linuxPackageKind: 'unknown'
    };

    for (const key of HOST_CAPABILITY_KEYS) {
        capabilities[key] = createCapabilityStatus();
    }

    return capabilities as RuntimeStore['hostCapabilities'];
}

type RuntimeStoreState = Omit<
    RuntimeStore,
    | 'setStartupTask'
    | 'setAuthBootstrap'
    | 'setHostCapabilities'
    | 'setUpdateLoopState'
    | 'setActivityState'
    | 'resetActivityState'
    | 'setMutualGraphState'
    | 'resetMutualGraphState'
    | 'setTransportState'
    | 'incrementTransportReconnect'
    | 'recordRuntimeEvent'
    | 'setGameState'
    | 'setBackendRuntimeSnapshot'
    | 'setShellState'
    | 'setNowPlayingState'
    | 'resetNowPlayingState'
    | 'setInstanceQueueState'
    | 'clearInstanceQueueState'
    | 'setVrcStatusState'
    | 'setGroupInstancesState'
    | 'setChangelogTargetVersion'
    | 'setSystemHostOpen'
    | 'setDatabaseUpgradeState'
    | 'resetRuntimeState'
>;

const initialState: RuntimeStoreState = {
    startup: {
        capabilities: createTaskState(),
        config: createTaskState(),
        auth: createTaskState(),
        services: createTaskState(),
        updateLoop: createTaskState()
    },
    hostCapabilities: createHostCapabilities(),
    auth: {
        currentUserId: null,
        currentUserDisplayName: '',
        currentUserEndpoint: '',
        currentUserWebsocket: '',
        currentUserSnapshot: null,
        lastUserLoggedIn: null,
        savedCredentialCount: 0,
        autoLoginStatus: 'idle',
        autoLoginReason: '',
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0
    },
    updateLoop: {
        isRunning: false,
        tickCount: 0,
        lastTickAt: null,
        lastGameLogSyncAt: null,
        lastGameLogSyncDetail: '',
        hasAvailableUpdate: false,
        lastUpdaterCheckAt: null,
        lastUpdaterCheckDetail: '',
        latestUpdaterRelease: null,
        autoDownloadState: 'idle',
        downloadedVersion: null,
        downloadProgress: 0
    },
    activity: createActivityState(),
    mutualGraph: createMutualGraphState(),
    transport: createTransportState(),
    gameState: {
        isGameRunning: null,
        isSteamVRRunning: null,
        isGameNoVR: false,
        currentLocation: '',
        currentWorldId: '',
        currentWorldName: '',
        currentDestination: '',
        currentLocationStartedAt: null,
        currentLocationPlayerIds: [],
        currentLocationPlayers: [],
        lastGameStateChangedAt: null,
        lastGameStartedAt: null,
        lastCrashedAt: null,
        lastGameLogAt: null,
        lastGameLogType: '',
        lastScreenshotPath: '',
        lastBrowserFocusAt: null,
        externalNotifierVersion: 0
    },
    nowPlaying: createNowPlayingState(),
    instanceQueue: createInstanceQueueState(),
    vrcStatus: {
        status: '',
        indicator: '',
        summary: '',
        updatedAt: null,
        lastFetchedAt: null,
        pollingIntervalMs: 15 * MINUTE_MS,
        refreshing: false,
        error: ''
    },
    groupInstances: createGroupInstancesState(),
    systemHosts: {
        databaseUpgradeOpen: false,
        updaterOpen: false,
        changelogOpen: false,
        keyboardShortcutsOpen: false,
        registryBackupOpen: false,
        appLauncherOpen: false,
        launchOptionsOpen: false,
        vrchatConfigOpen: false,
        presenceScheduleOpen: false,
        presenceRoomRulesOpen: false,
        presenceInviteRequestsOpen: false,
        groupCalendarOpen: false,
        exportDiscordNamesOpen: false,
        noteExportOpen: false,
        exportFriendsListOpen: false,
        exportAvatarsListOpen: false,
        editInviteMessagesOpen: false,
        llmEndpointsOpen: false
    },
    changelogTargetVersion: '',
    databaseUpgrade: {
        open: false,
        phase: 'idle',
        fromVersion: 0,
        toVersion: 0,
        detail: '',
        legacyMigrationAvailable: false
    },
    backendRuntime: {},
    shell: {
        backendRuntimeSnapshotHydrated: false,
        backendRuntimeSessionHydrating: false
    },
    runtimeEvents: {
        addGameLogEvent: createRuntimeEventState(),
        backendRuntimeTelemetry: createRuntimeEventState(),
        gameLogPersistenceFallback: createRuntimeEventState(),
        gameLogSideEffect: createRuntimeEventState(),
        runtimeGroupInstancesProjection: createRuntimeEventState(),
        realtimeWsStatus: createRuntimeEventState(),
        realtimeFriendProjection: createRuntimeEventState(),
        realtimeNotificationProjection: createRuntimeEventState(),
        realtimeCurrentUserProjection: createRuntimeEventState(),
        realtimeInstanceClosedProjection: createRuntimeEventState(),
        realtimeInstanceQueueProjection: createRuntimeEventState(),
        updateIsGameRunning: createRuntimeEventState(),
        ipcEvent: createRuntimeEventState(),
        browserFocus: createRuntimeEventState()
    }
};

export const useRuntimeStore = create<RuntimeStore>((set) => ({
    ...initialState,
    setStartupTask(task: string, status: string, detail: string = '') {
        set((state) => ({
            startup: {
                ...state.startup,
                [task]: {
                    status,
                    detail,
                    updatedAt: new Date().toISOString()
                }
            }
        }));
    },
    setAuthBootstrap(payload: Partial<RuntimeStore['auth']>) {
        set((state) => {
            const auth = {
                ...state.auth,
                ...payload
            };
            const scopeChanged =
                String(state.auth.currentUserId || '') !==
                    String(auth.currentUserId || '') ||
                String(state.auth.currentUserEndpoint || '') !==
                    String(auth.currentUserEndpoint || '');
            return {
                auth,
                groupInstances: scopeChanged
                    ? createGroupInstancesState()
                    : state.groupInstances
            };
        });
    },
    setHostCapabilities(payload?: Record<string, unknown> | null) {
        set({
            hostCapabilities: (payload ||
                createHostCapabilities()) as RuntimeStore['hostCapabilities']
        });
    },
    setUpdateLoopState(patch: Record<string, unknown>) {
        set((state) => ({
            updateLoop: {
                ...state.updateLoop,
                ...patch
            }
        }));
    },
    setActivityState(patch: Partial<ActivityState>) {
        set((state) => ({
            activity: {
                ...state.activity,
                ...patch,
                lastUpdatedAt: new Date().toISOString(),
                lastReadyAt:
                    patch?.status === 'ready' || patch?.fullCacheReady
                        ? new Date().toISOString()
                        : state.activity.lastReadyAt
            }
        }));
    },
    resetActivityState() {
        set({
            activity: createActivityState()
        });
    },
    setMutualGraphState(patch: Partial<MutualGraphState>) {
        set((state) => ({
            mutualGraph: {
                ...state.mutualGraph,
                ...patch,
                updatedAt: patch?.updatedAt || new Date().toISOString()
            }
        }));
    },
    resetMutualGraphState() {
        set({
            mutualGraph: createMutualGraphState()
        });
    },
    setTransportState(patch: Partial<TransportState>) {
        set((state) => ({
            transport: {
                ...state.transport,
                ...patch
            }
        }));
    },
    incrementTransportReconnect() {
        set((state) => ({
            transport: {
                ...state.transport,
                reconnectCount: state.transport.reconnectCount + 1
            }
        }));
    },
    recordRuntimeEvent(name: string, payload: unknown) {
        set((state) => {
            const current =
                state.runtimeEvents[name] ?? createRuntimeEventState();
            return {
                runtimeEvents: {
                    ...state.runtimeEvents,
                    [name]: {
                        count: current.count + 1,
                        lastPayload: payload,
                        lastReceivedAt: new Date().toISOString()
                    }
                }
            };
        });
    },
    setGameState(patch: Partial<RuntimeStore['gameState']>) {
        set((state) => ({
            gameState: {
                ...state.gameState,
                ...patch
            }
        }));
    },
    setBackendRuntimeSnapshot(snapshot: Record<string, unknown> | null) {
        set({
            backendRuntime:
                snapshot && typeof snapshot === 'object' ? snapshot : {}
        });
    },
    setShellState(patch: Record<string, unknown>) {
        set((state) => ({
            shell: {
                ...state.shell,
                ...patch
            }
        }));
    },
    setNowPlayingState(patch: Record<string, unknown>) {
        set((state) => ({
            nowPlaying: {
                ...state.nowPlaying,
                ...patch
            }
        }));
    },
    resetNowPlayingState() {
        set({
            nowPlaying: {
                ...createNowPlayingState(),
                updatedAt: new Date().toISOString()
            }
        });
    },
    setInstanceQueueState(patch: Partial<InstanceQueueState>) {
        set((state) => ({
            instanceQueue: {
                ...state.instanceQueue,
                ...patch
            }
        }));
    },
    clearInstanceQueueState() {
        set({
            instanceQueue: createInstanceQueueState()
        });
    },
    setVrcStatusState(patch: Partial<VrcStatusState>) {
        set((state) => ({
            vrcStatus: {
                ...state.vrcStatus,
                ...patch
            }
        }));
    },
    setGroupInstancesState(patch: Partial<RuntimeStore['groupInstances']>) {
        set((state) => ({
            groupInstances: {
                ...state.groupInstances,
                ...patch
            }
        }));
    },
    setChangelogTargetVersion(version: unknown) {
        set({
            changelogTargetVersion: String(version || '').trim()
        });
    },
    setSystemHostOpen(name: string, value: unknown) {
        set((state) => ({
            systemHosts: {
                ...state.systemHosts,
                [name]: Boolean(value)
            }
        }));
    },
    setDatabaseUpgradeState(patch: Partial<RuntimeStore['databaseUpgrade']>) {
        set((state) => ({
            databaseUpgrade: {
                ...state.databaseUpgrade,
                ...patch
            },
            systemHosts: {
                ...state.systemHosts,
                databaseUpgradeOpen:
                    typeof patch?.open === 'boolean'
                        ? patch.open
                        : state.systemHosts.databaseUpgradeOpen
            }
        }));
    },
    resetRuntimeState() {
        set(initialState);
    }
}));
