import { normalizeLanguageCode } from '@/localization/locales';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { DEFAULT_TIME_UNIT_LABELS, useShellStore } from '@/state/shellStore';

import { startRuntimeAuthFailureRecovery } from './authSessionRecoveryService';
import { startRuntimeGameClientSync } from './gameClientLifecycle';
import { stopGameStateService } from './gameStateService';
import { getTimeUnitLabels, setI18nLanguage } from './i18nService';
import { bindRuntimeEvents } from './runtimeEventBridgeService';
import { initializeReactRuntime } from './startupService';
import { applyThemeMode } from './themeService';
import { startRuntimeUpdateLoop } from './updateLoopService';
import { startVrcStatusPolling } from './vrcStatusService';

type ShellState = ReturnType<typeof useShellStore.getState>;
type CleanupFn = () => void;
type RuntimeNotificationOptions = {
    level: string;
    title: string;
    error: unknown;
};
function pushRuntimeNotification({
    level,
    title,
    error
}: RuntimeNotificationOptions) {
    useNotificationStore.getState().pushNotification({
        level,
        title,
        message: error instanceof Error ? error.message : String(error)
    });
}

let reactRuntimeConsumerCount = 0;
let reactRuntimeStartPromise: Promise<void> | null = null;
let reactRuntimeCleanup: CleanupFn | null = null;

function cleanupReactRuntimeServices() {
    const cleanup = reactRuntimeCleanup;
    reactRuntimeCleanup = null;
    reactRuntimeStartPromise = null;
    cleanup?.();
}

function createReactRuntimeStartPromise() {
    const cleanups: Array<CleanupFn | null | undefined> = [
        startRuntimeAuthFailureRecovery()
    ];

    return initializeReactRuntime()
        .then(() => bindRuntimeEvents())
        .then((cleanup) => {
            cleanups.push(cleanup ?? null);
            cleanups.push(startRuntimeGameClientSync());
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
        .catch((error: unknown) => {
            for (const entry of cleanups) {
                entry?.();
            }
            reactRuntimeStartPromise = null;
            reactRuntimeCleanup = null;
            useRuntimeStore.getState().setShellState({
                backendRuntimeSnapshotHydrated: true,
                backendRuntimeSessionHydrating: false
            });
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
    const syncThemeMode = (
        themeMode: ShellState['themeMode'],
        title: string
    ) => {
        applyThemeMode(themeMode).catch((error: unknown) => {
            pushRuntimeNotification({
                level: 'warning',
                title,
                error
            });
        });
    };

    syncThemeMode(useShellStore.getState().themeMode, 'Theme sync failed');

    const unsubscribeThemeMode = useShellStore.subscribe(
        (state, previousState) => {
            if (state.themeMode !== previousState.themeMode) {
                syncThemeMode(state.themeMode, 'Theme sync failed');
            }
        }
    );

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

export function startI18nLanguageSync() {
    const syncLanguage = (locale: unknown) => {
        const nextLocale = normalizeLanguageCode(locale);
        if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('lang', nextLocale);
        }
        useShellStore
            .getState()
            .setTimeUnitLabels(
                getTimeUnitLabels(nextLocale, DEFAULT_TIME_UNIT_LABELS)
            );
        setI18nLanguage(nextLocale).catch((error: unknown) => {
            pushRuntimeNotification({
                level: 'warning',
                title: 'Language sync failed',
                error
            });
        });
    };

    syncLanguage(useShellStore.getState().locale);

    return useShellStore.subscribe((state, previousState) => {
        if (state.locale !== previousState.locale) {
            syncLanguage(state.locale);
        }
    });
}
