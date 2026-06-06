import { create } from 'zustand';

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

type GroupInstancesState = Record<string, any> & {
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
    hostCapabilities: Record<string, any> & {
        platform: string;
        arch: string;
        linuxPackageKind: string;
    };
    auth: Record<string, any> & {
        currentUserId: string | null;
        currentUserDisplayName: string;
        currentUserEndpoint: string;
        currentUserWebsocket: string;
        currentUserSnapshot: Record<string, any> | null;
    };
    updateLoop: Record<string, any> & {
        isRunning: boolean;
        tickCount: number;
        hasAvailableUpdate: boolean;
    };
    activity: ActivityState;
    mutualGraph: MutualGraphState;
    transport: TransportState;
    gameState: Record<string, any> & {
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
    };
    nowPlaying: Record<string, any> & {
        url: string;
        name: string;
        thumbnailUrl: string;
        length: number;
        startedAt: string | null;
    };
    instanceQueue: InstanceQueueState;
    vrcStatus: Record<string, any>;
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
    setInstanceQueueState(patch: Partial<InstanceQueueState>): void;
    clearInstanceQueueState(): void;
    setVrcStatusState(patch: Record<string, unknown>): void;
    setGroupInstancesState(patch: Partial<RuntimeStore['groupInstances']>): void;
    setChangelogTargetVersion(version: unknown): void;
    setSystemHostOpen(name: string, value: unknown): void;
    setDatabaseUpgradeState(patch: Partial<RuntimeStore['databaseUpgrade']>): void;
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

function createCapabilityStatus(reason: any = 'Host capabilities have not loaded.') {
    return {
        supported: false,
        enabled: false,
        available: false,
        reason
    };
}

function createHostCapabilities(): RuntimeStore['hostCapabilities'] {
    const capabilities: RuntimeStore['hostCapabilities'] = {
        platform: 'unknown',
        arch: 'unknown',
        linuxPackageKind: 'unknown'
    };

    for (const key of HOST_CAPABILITY_KEYS) {
        capabilities[key] = createCapabilityStatus();
    }

    return capabilities;
}

const initialState = {
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
        latestUpdaterRelease: null
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
    nowPlaying: {
        url: '',
        name: '',
        source: '',
        displayName: '',
        thumbnailUrl: '',
        length: 0,
        position: 0,
        startedAt: null,
        updatedAt: null
    },
    instanceQueue: createInstanceQueueState(),
    vrcStatus: {
        status: '',
        indicator: '',
        summary: '',
        updatedAt: null,
        lastFetchedAt: null,
        pollingIntervalMs: 15 * 60 * 1000,
        refreshing: false,
        error: ''
    },
    groupInstances: createGroupInstancesState(),
    systemHosts: {
        databaseUpgradeOpen: false,
        updaterOpen: false,
        changelogOpen: false,
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
        editInviteMessagesOpen: false
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
} satisfies Omit<
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
    | 'setInstanceQueueState'
    | 'clearInstanceQueueState'
    | 'setVrcStatusState'
    | 'setGroupInstancesState'
    | 'setChangelogTargetVersion'
    | 'setSystemHostOpen'
    | 'setDatabaseUpgradeState'
    | 'resetRuntimeState'
>;

export const useRuntimeStore = create<RuntimeStore>((set: any) => ({
    ...initialState,
    setStartupTask(task: any, status: any, detail: any = '') {
        set((state: any) => ({
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
    setAuthBootstrap(payload: any) {
        set((state: any) => {
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
    setHostCapabilities(payload: any) {
        set({
            hostCapabilities: (payload ||
                createHostCapabilities()) as RuntimeStore['hostCapabilities']
        });
    },
    setUpdateLoopState(patch: any) {
        set((state: any) => ({
            updateLoop: {
                ...state.updateLoop,
                ...patch
            }
        }));
    },
    setActivityState(patch: any) {
        set((state: any) => ({
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
    setMutualGraphState(patch: any) {
        set((state: any) => ({
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
    setTransportState(patch: any) {
        set((state: any) => ({
            transport: {
                ...state.transport,
                ...patch
            }
        }));
    },
    incrementTransportReconnect() {
        set((state: any) => ({
            transport: {
                ...state.transport,
                reconnectCount: state.transport.reconnectCount + 1
            }
        }));
    },
    recordRuntimeEvent(name: any, payload: any) {
        set((state: any) => {
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
    setGameState(patch: any) {
        set((state: any) => ({
            gameState: {
                ...state.gameState,
                ...patch
            }
        }));
    },
    setBackendRuntimeSnapshot(snapshot: any) {
        set({
            backendRuntime:
                snapshot && typeof snapshot === 'object' ? snapshot : {}
        });
    },
    setShellState(patch: any) {
        set((state: any) => ({
            shell: {
                ...state.shell,
                ...patch
            }
        }));
    },
    setNowPlayingState(patch: any) {
        set((state: any) => ({
            nowPlaying: {
                ...state.nowPlaying,
                ...patch
            }
        }));
    },
    setInstanceQueueState(patch: any) {
        set((state: any) => ({
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
    setVrcStatusState(patch: any) {
        set((state: any) => ({
            vrcStatus: {
                ...state.vrcStatus,
                ...patch
            }
        }));
    },
    setGroupInstancesState(patch: any) {
        set((state: any) => ({
            groupInstances: {
                ...state.groupInstances,
                ...patch
            }
        }));
    },
    setChangelogTargetVersion(version: any) {
        set({
            changelogTargetVersion: String(version || '').trim()
        });
    },
    setSystemHostOpen(name: any, value: any) {
        set((state: any) => ({
            systemHosts: {
                ...state.systemHosts,
                [name]: Boolean(value)
            }
        }));
    },
    setDatabaseUpgradeState(patch: any) {
        set((state: any) => ({
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
