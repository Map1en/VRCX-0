import { create } from 'zustand';

function createTaskState() {
    return {
        status: 'idle',
        detail: '',
        updatedAt: null
    };
}

function createBackendEventState() {
    return {
        count: 0,
        lastPayload: null,
        lastReceivedAt: null
    };
}

function createTransportState() {
    return {
        websocketConnected: false,
        websocketDomain: '',
        messageCount: 0,
        bytesReceived: 0,
        reconnectCount: 0,
        lastMessageType: '',
        lastMessageAt: null,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        ipcAnnounced: false,
        lastIpcAnnouncedAt: null
    };
}

function createActivityState() {
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

const initialState = {
    startup: {
        config: createTaskState(),
        auth: createTaskState(),
        services: createTaskState(),
        updateLoop: createTaskState()
    },
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
        enableCustomEndpoint: false,
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0
    },
    updateLoop: {
        isRunning: false,
        tickCount: 0,
        lastTickAt: null,
        lastGameLogSyncAt: null,
        lastGameLogSyncDetail: ''
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
        autoChangeStatusOpen: false,
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
};

export const useRuntimeStore = create((set) => ({
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
    recordTransportMessage(messageType, byteLength = 0) {
        set((state) => ({
            transport: {
                ...state.transport,
                messageCount: state.transport.messageCount + 1,
                bytesReceived: state.transport.bytesReceived + Math.max(0, Number(byteLength) || 0),
                lastMessageType: messageType || '',
                lastMessageAt: new Date().toISOString()
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
            const current = state.backendEvents[name] ?? createBackendEventState();
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
