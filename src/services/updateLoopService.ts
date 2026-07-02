import { isVrchatMissingCredentialsError } from '@/repositories/vrchatRequest';
import { useRuntimeStore } from '@/state/runtimeStore';

import { shouldHandleRuntimeAuthFailure } from './authSessionRecoveryService';
import {
    resetBackgroundMaintenance,
    runBackgroundMaintenanceTick
} from './backgroundMaintenanceService';
import {
    getHostCapabilityUnavailableReason,
    isHostCapabilityAvailable,
    refreshHostCapabilities
} from './hostCapabilityService';
import i18n from './i18nService';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService';

let updateLoopTimer: ReturnType<typeof window.setTimeout> | null = null;
let lastGameLogCapabilityRefreshAt = 0;
let stopped = true;
let activeTickToken = 0;
let activeTickCount = 0;
const idleWaiters = new Set<() => void>();

function notifyUpdateLoopIdle() {
    if (activeTickCount !== 0) {
        return;
    }
    for (const resolve of idleWaiters) {
        resolve();
    }
    idleWaiters.clear();
}

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
    const tickToken = activeTickToken;
    activeTickCount += 1;

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
        runtimeStore.setUpdateLoopState({
            lastGameLogSyncAt: new Date().toISOString(),
            lastGameLogSyncDetail: gameLogAvailable
                ? 'Backend GameLog side effects are active.'
                : getHostCapabilityUnavailableReason('gameLogWatcher')
        });
        if (stopped || tickToken !== activeTickToken) {
            return;
        }
        await runBackgroundMaintenanceTick();
        useRuntimeStore
            .getState()
            .setStartupTask(
                'updateLoop',
                'running',
                gameLogAvailable
                    ? 'Backend game log ingest and background maintenance are active.'
                    : 'Background maintenance is active. Game log ingest is unavailable in this host.'
            );
    } catch (error) {
        if (isVrchatMissingCredentialsError(error)) {
            if (!shouldHandleRuntimeAuthFailure(error)) {
                return;
            }
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
        activeTickCount = Math.max(0, activeTickCount - 1);
        notifyUpdateLoopIdle();
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
    activeTickToken += 1;
    useRuntimeStore
        .getState()
        .setStartupTask(
            'updateLoop',
            'running',
            isHostCapabilityAvailable('gameLogWatcher')
                ? 'Starting game log tail sync and background maintenance.'
                : 'Starting background maintenance without game log tail sync.'
        );
    tickRuntimeLoop();
    return stopRuntimeUpdateLoop;
}

export function stopRuntimeUpdateLoop() {
    stopped = true;
    activeTickToken += 1;
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
    notifyUpdateLoopIdle();
}

export async function stopRuntimeUpdateLoopAndWaitForIdle(timeoutMs = 10000) {
    stopRuntimeUpdateLoop();
    if (activeTickCount === 0) {
        return;
    }
    const idle = await Promise.race([
        new Promise<void>((resolve) => {
            idleWaiters.add(() => resolve());
        }),
        new Promise<'timeout'>((resolve) => {
            window.setTimeout(() => resolve('timeout'), timeoutMs);
        })
    ]);
    if (idle === 'timeout' && activeTickCount !== 0) {
        throw new Error('Timed out waiting for runtime update loop to stop.');
    }
}
