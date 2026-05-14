import { create } from 'zustand';

type TaskState = {
    status: string;
    detail: string;
    updatedAt: string | null;
};

type BackendEventState = {
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
    vrcStatus: Record<string, any>;
    groupInstances: Record<string, any> & {
        instances: unknown[];
        groupOrder: unknown[];
    };
    systemHosts: Record<string, boolean>;
    databaseUpgrade: Record<string, unknown> & {
        open: boolean;
        phase: string;
        fromVersion: number;
        toVersion: number;
        detail: string;
        legacyMigrationAvailable: boolean;
    };
    backendEvents: Record<string, BackendEventState>;
    setStartupTask(task: string, status: string, detail?: string): void;
    setAuthBootstrap(payload: Partial<RuntimeStore['auth']>): void;
    setHostCapabilities(payload?: Record<string, unknown> | null): void;
    setUpdateLoopState(patch: Record<string, unknown>): void;
    setActivityState(patch: Partial<ActivityState>): void;
    resetActivityState(): void;
    setTransportState(patch: Partial<TransportState>): void;
    incrementTransportReconnect(): void;
    recordBackendEvent(name: string, payload: unknown): void;
    setGameState(patch: Partial<RuntimeStore['gameState']>): void;
    setNowPlayingState(patch: Record<string, unknown>): void;
    setVrcStatusState(patch: Record<string, unknown>): void;
    setGroupInstancesState(patch: Partial<RuntimeStore['groupInstances']>): void;
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

function createBackendEventState(): BackendEventState {
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

const HOST_CAPABILITY_KEYS = Object.freeze([
    'localDatabase',
    'websocketRuntime',
    'gameLogWatcher',
    'backendGameLogIngest',
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

function createCapabilityStatus(reason = 'Host capabilities have not loaded.') {
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
        lastUpdaterCheckDetail: ''
    },
    activity: createActivityState(),
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
    vrcStatus: {
        status: '',
        indicator: '',
        summary: '',
        updatedAt: null,
        lastFetchedAt: null,
        pollingIntervalMs: 15 * 60 * 1000,
        error: ''
    },
    groupInstances: {
        status: 'idle',
        endpoint: '',
        instances: [],
        groupOrder: [],
        fetchedAt: null,
        lastLoadedAt: null,
        error: ''
    },
    systemHosts: {
        databaseUpgradeOpen: false,
        updaterOpen: false,
        registryBackupOpen: false,
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
    databaseUpgrade: {
        open: false,
        phase: 'idle',
        fromVersion: 0,
        toVersion: 0,
        detail: '',
        legacyMigrationAvailable: false
    },
    backendEvents: {
        addGameLogEvent: createBackendEventState(),
        updateIsGameRunning: createBackendEventState(),
        ipcEvent: createBackendEventState(),
        browserFocus: createBackendEventState()
    }
} satisfies Omit<
    RuntimeStore,
    | 'setStartupTask'
    | 'setAuthBootstrap'
    | 'setHostCapabilities'
    | 'setUpdateLoopState'
    | 'setActivityState'
    | 'resetActivityState'
    | 'setTransportState'
    | 'incrementTransportReconnect'
    | 'recordBackendEvent'
    | 'setGameState'
    | 'setNowPlayingState'
    | 'setVrcStatusState'
    | 'setGroupInstancesState'
    | 'setSystemHostOpen'
    | 'setDatabaseUpgradeState'
    | 'resetRuntimeState'
>;

export const useRuntimeStore = create<RuntimeStore>((set) => ({
    ...initialState,
    setStartupTask(task, status, detail = '') {
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
    setAuthBootstrap(payload) {
        set((state) => ({
            auth: {
                ...state.auth,
                ...payload
            }
        }));
    },
    setHostCapabilities(payload) {
        set({
            hostCapabilities: (payload ||
                createHostCapabilities()) as RuntimeStore['hostCapabilities']
        });
    },
    setUpdateLoopState(patch) {
        set((state) => ({
            updateLoop: {
                ...state.updateLoop,
                ...patch
            }
        }));
    },
    setActivityState(patch) {
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
    setTransportState(patch) {
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
    recordBackendEvent(name, payload) {
        set((state) => {
            const current =
                state.backendEvents[name] ?? createBackendEventState();
            return {
                backendEvents: {
                    ...state.backendEvents,
                    [name]: {
                        count: current.count + 1,
                        lastPayload: payload,
                        lastReceivedAt: new Date().toISOString()
                    }
                }
            };
        });
    },
    setGameState(patch) {
        set((state) => ({
            gameState: {
                ...state.gameState,
                ...patch
            }
        }));
    },
    setNowPlayingState(patch) {
        set((state) => ({
            nowPlaying: {
                ...state.nowPlaying,
                ...patch
            }
        }));
    },
    setVrcStatusState(patch) {
        set((state) => ({
            vrcStatus: {
                ...state.vrcStatus,
                ...patch
            }
        }));
    },
    setGroupInstancesState(patch) {
        set((state) => ({
            groupInstances: {
                ...state.groupInstances,
                ...patch
            }
        }));
    },
    setSystemHostOpen(name, value) {
        set((state) => ({
            systemHosts: {
                ...state.systemHosts,
                [name]: Boolean(value)
            }
        }));
    },
    setDatabaseUpgradeState(patch) {
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
