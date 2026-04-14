import { bindBackendEvents } from './backendEventService.js';
import { bootstrapActivityCache } from './activityCacheService.js';
import { bootstrapFavorites } from './favoriteBootstrapService.js';
import { bootstrapFriendRoster } from './friendBootstrapService.js';
import { refreshPlayerModerations } from './backgroundMaintenanceService.js';
import { startRealtimeTransport, stopRealtimeTransport } from './realtimeTransportService.js';
import { initializeReactRuntime } from './startupService.js';
import { applyThemeMode } from './themeService.js';
import { startRuntimeUpdateLoop } from './updateLoopService.js';
import { startVrcStatusPolling } from './vrcStatusService.js';
import { stopGameStateService } from './gameStateService.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { useShellStore } from '@/state/shellStore.js';

function pushRuntimeNotification({ level, title, error }) {
    useNotificationStore.getState().pushNotification({
        level,
        title,
        message: error instanceof Error ? error.message : String(error)
    });
}

function isSameAuthenticatedContext(left, right) {
    return (
        left?.userId === right?.userId &&
        left?.endpoint === right?.endpoint &&
        left?.websocket === right?.websocket &&
        left?.currentUserSnapshot === right?.currentUserSnapshot
    );
}

function isSameAuthenticatedIdentity(left, right) {
    return (
        left?.userId === right?.userId &&
        left?.endpoint === right?.endpoint
    );
}

function getAuthenticatedRuntimeContext() {
    const sessionState = useSessionStore.getState();
    const runtimeState = useRuntimeStore.getState();

    if (
        sessionState.sessionPhase !== 'ready' ||
        !runtimeState.auth.currentUserId ||
        !runtimeState.auth.currentUserSnapshot
    ) {
        return null;
    }

    return {
        userId: runtimeState.auth.currentUserId,
        endpoint: runtimeState.auth.currentUserEndpoint,
        websocket: runtimeState.auth.currentUserWebsocket,
        currentUserSnapshot: runtimeState.auth.currentUserSnapshot
    };
}

function isCurrentAuthenticatedContext(context) {
    return isSameAuthenticatedContext(context, getAuthenticatedRuntimeContext());
}

let reactRuntimeConsumerCount = 0;
let reactRuntimeStartPromise = null;
let reactRuntimeCleanup = null;

function cleanupReactRuntimeServices() {
    const cleanup = reactRuntimeCleanup;
    reactRuntimeCleanup = null;
    reactRuntimeStartPromise = null;
    cleanup?.();
}

function createReactRuntimeStartPromise() {
    const cleanups = [];

    return initializeReactRuntime()
        .then(() => bindBackendEvents())
        .then((cleanup) => {
            cleanups.push(cleanup ?? null);
            cleanups.push(startRuntimeUpdateLoop());
            cleanups.push(startVrcStatusPolling());
            reactRuntimeCleanup = () => {
                for (const entry of cleanups) {
                    entry?.();
                }
                stopGameStateService();
            };

            if (reactRuntimeConsumerCount === 0) {
                cleanupReactRuntimeServices();
            }
        })
        .catch((error) => {
            reactRuntimeStartPromise = null;
            reactRuntimeCleanup = null;
            if (reactRuntimeConsumerCount > 0) {
                pushRuntimeNotification({
                    level: 'error',
                    title: 'Runtime bootstrap failed',
                    error
                });
            }
        });
}

export function startReactRuntimeServices() {
    let disposed = false;
    reactRuntimeConsumerCount += 1;

    if (!reactRuntimeStartPromise && !reactRuntimeCleanup) {
        reactRuntimeStartPromise = createReactRuntimeStartPromise();
    }

    return () => {
        if (disposed) {
            return;
        }
        disposed = true;
        reactRuntimeConsumerCount = Math.max(0, reactRuntimeConsumerCount - 1);

        if (reactRuntimeConsumerCount > 0) {
            return;
        }

        if (reactRuntimeCleanup) {
            cleanupReactRuntimeServices();
        }
    };
}

export function startThemeModeSync() {
    const syncThemeMode = (themeMode, title) => {
        applyThemeMode(themeMode).catch((error) => {
            pushRuntimeNotification({
                level: 'warning',
                title,
                error
            });
        });
    };

    syncThemeMode(useShellStore.getState().themeMode, 'Theme sync failed');

    const unsubscribeThemeMode = useShellStore.subscribe((state, previousState) => {
        if (state.themeMode !== previousState.themeMode) {
            syncThemeMode(state.themeMode, 'Theme sync failed');
        }
    });

    if (!window.matchMedia) {
        return unsubscribeThemeMode;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
        if (useShellStore.getState().themeMode === 'system') {
            syncThemeMode('system', 'System theme sync failed');
        }
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => {
        unsubscribeThemeMode();
        mediaQuery.removeEventListener('change', handleChange);
    };
}

export function startAuthenticatedRuntimeServices() {
    let disposed = false;
    let activeContext = null;
    let activeRunId = 0;
    let activeModerationTarget = null;
    let activeModerationRunId = 0;
    let friendBootstrapStarted = false;
    let favoritesBootstrapStarted = false;
    let moderationRefreshStarted = false;
    let activityBootstrapStarted = false;
    let realtimeTransportStarted = false;

    const resetContext = (context) => {
        activeContext = context;
        activeRunId += 1;
        friendBootstrapStarted = false;
        favoritesBootstrapStarted = false;
        activityBootstrapStarted = false;
        realtimeTransportStarted = false;
        stopRealtimeTransport({ updateStatus: false });
    };

    const resetModerationTarget = (context) => {
        activeModerationTarget = context
            ? {
                  userId: context.userId,
                  endpoint: context.endpoint
              }
            : null;
        activeModerationRunId += 1;
        moderationRefreshStarted = false;
    };

    const isActiveRun = (runId, context) => (
        !disposed &&
        activeRunId === runId &&
        isCurrentAuthenticatedContext(context)
    );

    const isActiveModerationRun = (runId, target) => (
        !disposed &&
        activeModerationRunId === runId &&
        isSameAuthenticatedIdentity(target, getAuthenticatedRuntimeContext())
    );

    const runFriendBootstrap = (context, runId) => {
        friendBootstrapStarted = true;
        bootstrapFriendRoster({
            userId: context.userId,
            endpoint: context.endpoint,
            currentUserSnapshot: context.currentUserSnapshot
        }).catch((error) => {
            if (!isActiveRun(runId, context)) {
                return;
            }

            pushRuntimeNotification({
                level: 'warning',
                title: 'Friend bootstrap failed',
                error
            });
        });
    };

    const runFavoritesBootstrap = (context, runId) => {
        favoritesBootstrapStarted = true;
        bootstrapFavorites({
            userId: context.userId,
            endpoint: context.endpoint,
            currentUserSnapshot: context.currentUserSnapshot
        }).catch((error) => {
            if (!isActiveRun(runId, context)) {
                return;
            }

            pushRuntimeNotification({
                level: 'warning',
                title: 'Favorites hydration failed',
                error
            });
        });
    };

    const runModerationRefresh = (context, runId) => {
        moderationRefreshStarted = true;
        const target = {
            userId: context.userId,
            endpoint: context.endpoint
        };
        refreshPlayerModerations({
            isCurrent: () => isActiveModerationRun(runId, target)
        }).catch((error) => {
            if (!isActiveModerationRun(runId, target)) {
                return;
            }

            pushRuntimeNotification({
                level: 'warning',
                title: 'Moderation sync failed',
                error
            });
        });
    };

    const runActivityBootstrap = (context, runId) => {
        activityBootstrapStarted = true;
        bootstrapActivityCache({
            userId: context.userId,
            currentUserSnapshot: context.currentUserSnapshot
        }).catch((error) => {
            if (!isActiveRun(runId, context)) {
                return;
            }

            pushRuntimeNotification({
                level: 'warning',
                title: 'Activity cache warm-up failed',
                error
            });
        });
    };

    const runRealtimeTransport = (context, runId) => {
        realtimeTransportStarted = true;
        startRealtimeTransport({
            userId: context.userId,
            endpoint: context.endpoint,
            websocket: context.websocket,
            currentUserSnapshot: context.currentUserSnapshot
        }).catch((error) => {
            if (isActiveRun(runId, context)) {
                console.warn('Realtime transport bootstrap failed:', error);
            }
        });
    };

    const update = () => {
        if (disposed) {
            return;
        }

        const context = getAuthenticatedRuntimeContext();
        if (!context) {
            if (activeContext) {
                resetContext(null);
            }
            if (activeModerationTarget) {
                resetModerationTarget(null);
            }
            return;
        }

        if (!isSameAuthenticatedContext(activeContext, context)) {
            resetContext(context);
        }

        if (!isSameAuthenticatedIdentity(activeModerationTarget, context)) {
            resetModerationTarget(context);
        }

        const runId = activeRunId;
        const moderationRunId = activeModerationRunId;
        const sessionState = useSessionStore.getState();
        const runtimeState = useRuntimeStore.getState();

        if (!sessionState.isFriendsLoaded && !friendBootstrapStarted) {
            runFriendBootstrap(context, runId);
        }

        if (!sessionState.isFavoritesLoaded && !favoritesBootstrapStarted) {
            runFavoritesBootstrap(context, runId);
        }

        if (!moderationRefreshStarted) {
            runModerationRefresh(context, moderationRunId);
        }

        if (
            !activityBootstrapStarted &&
            (
                runtimeState.activity.currentUserId !== context.userId ||
                runtimeState.activity.status === 'idle'
            )
        ) {
            runActivityBootstrap(context, runId);
        }

        if (!sessionState.isFriendsLoaded) {
            if (realtimeTransportStarted) {
                realtimeTransportStarted = false;
                stopRealtimeTransport({ updateStatus: false });
            }
            return;
        }

        if (!realtimeTransportStarted) {
            runRealtimeTransport(context, runId);
        }
    };

    const unsubscribeSession = useSessionStore.subscribe(update);
    const unsubscribeRuntime = useRuntimeStore.subscribe(update);

    update();

    return () => {
        disposed = true;
        unsubscribeSession();
        unsubscribeRuntime();
        activeContext = null;
        activeRunId += 1;
        stopRealtimeTransport();
    };
}
