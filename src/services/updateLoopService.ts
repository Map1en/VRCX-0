import { isVrchatMissingCredentialsError } from '@/repositories/vrchatRequest.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import {
    resetBackgroundMaintenance,
    runBackgroundMaintenanceTick
} from './backgroundMaintenanceService.js';
import { syncGameLogTail } from './gameLogIngestService.js';
import {
    getHostCapabilityUnavailableReason,
    isHostCapabilityAvailable,
    refreshHostCapabilities
} from './hostCapabilityService.js';
import i18n from './i18nService.js';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService.js';

let updateLoopTimer = null;
let lastGameLogCapabilityRefreshAt = 0;
let stopped = true;

async function refreshGameLogCapabilityIfPrewatching() {
    const capabilities = useRuntimeStore.getState().hostCapabilities;
    if (
        capabilities?.platform !== 'linux' ||
        capabilities?.gameLogWatcher?.available ||
        !capabilities?.vrchatPathDiscovery?.available
    ) {
        return;
    }

    const now = Date.now();
    if (now - lastGameLogCapabilityRefreshAt < 30000) {
        return;
    }

    lastGameLogCapabilityRefreshAt = now;
    try {
        await refreshHostCapabilities();
    } catch (error) {
        console.warn('Failed to refresh host capabilities:', error);
    }
}

async function tickRuntimeLoop() {
    if (stopped) {
        return;
    }

    const runtimeStore = useRuntimeStore.getState();
    const tickCount = runtimeStore.updateLoop.tickCount + 1;

    runtimeStore.setUpdateLoopState({
        isRunning: true,
        tickCount,
        lastTickAt: new Date().toISOString()
    });

    try {
        await refreshGameLogCapabilityIfPrewatching();
        const gameLogAvailable = isHostCapabilityAvailable('gameLogWatcher');
        if (gameLogAvailable) {
            await syncGameLogTail();
        } else {
            runtimeStore.setUpdateLoopState({
                lastGameLogSyncAt: new Date().toISOString(),
                lastGameLogSyncDetail:
                    getHostCapabilityUnavailableReason('gameLogWatcher')
            });
        }
        await runBackgroundMaintenanceTick();
        useRuntimeStore
            .getState()
            .setStartupTask(
                'updateLoop',
                'running',
                gameLogAvailable
                    ? 'Game log tail sync and background maintenance are active.'
                    : 'Background maintenance is active. Game log tail sync is unavailable in this host.'
            );
    } catch (error) {
        if (isVrchatMissingCredentialsError(error)) {
            useRuntimeStore
                .getState()
                .setStartupTask(
                    'updateLoop',
                    'pending',
                    await i18n.t('message.auth.session_expired')
                );
            return;
        }

        await showSQLiteErrorDialog(error);
        useRuntimeStore
            .getState()
            .setStartupTask(
                'updateLoop',
                'error',
                error instanceof Error ? error.message : String(error)
            );
    } finally {
        if (!stopped) {
            updateLoopTimer = window.setTimeout(tickRuntimeLoop, 5000);
        }
    }
}

export function startRuntimeUpdateLoop() {
    if (updateLoopTimer !== null) {
        return stopRuntimeUpdateLoop;
    }

    stopped = false;
    useRuntimeStore
        .getState()
        .setStartupTask(
            'updateLoop',
            'running',
            isHostCapabilityAvailable('gameLogWatcher')
                ? 'Starting game log tail sync and background maintenance.'
                : 'Starting background maintenance without game log tail sync.'
        );
    void tickRuntimeLoop();
    return stopRuntimeUpdateLoop;
}

export function stopRuntimeUpdateLoop() {
    stopped = true;
    if (updateLoopTimer !== null) {
        window.clearTimeout(updateLoopTimer);
        updateLoopTimer = null;
    }

    useRuntimeStore.getState().setUpdateLoopState({
        isRunning: false
    });
    useRuntimeStore
        .getState()
        .setStartupTask(
            'updateLoop',
            'pending',
            'Game log tail sync is stopped.'
        );
    resetBackgroundMaintenance();
}
