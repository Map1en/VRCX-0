import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import { clearFavoriteRemoteDetailsCache } from '@/services/favoriteRemoteDetailsCacheService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    CLEAR_VRCX_CACHE_CADENCE_SECONDS,
    CLEAR_VRCX_CACHE_DEFAULT_FREQUENCY_SECONDS,
    CLEAR_VRCX_CACHE_DISABLED_RETRY_DELAY_SECONDS,
    CLEAR_VRCX_CACHE_MIN_DEFER_SECONDS,
    APP_UPDATE_CHECK_INTERVAL_SECONDS
} from './backgroundMaintenanceTiming';
import { checkForAppUpdate } from './backgroundMaintenanceUpdateService';
import {
    recordRuntimeJobTelemetry,
    runRuntimeTelemetryJob
} from './runtimeJobTelemetryService';

type RuntimeScheduledTask = () => Promise<unknown>;

let running = false;

function resetTimers() {
    commands
        .appRuntimeFrontendScheduleSchedulesReset()
        .catch((error: unknown) => {
            console.warn(
                'Failed to reset runtime maintenance scheduler:',
                error
            );
        });
}

async function runClearVrcxCache() {
    const frequency = Number(
        await configRepository.getInt(
            'clearVRCXCacheFrequency',
            CLEAR_VRCX_CACHE_DEFAULT_FREQUENCY_SECONDS
        )
    );
    if (!frequency || frequency <= 0) {
        await deferRuntimeScheduledFrontendJob(
            'clearVRCXCacheCheck',
            CLEAR_VRCX_CACHE_DISABLED_RETRY_DELAY_SECONDS
        );
        return;
    }

    await deferRuntimeScheduledFrontendJob(
        'clearVRCXCacheCheck',
        Math.max(CLEAR_VRCX_CACHE_MIN_DEFER_SECONDS, Math.floor(frequency / 2))
    );
    const cleared = clearFavoriteRemoteDetailsCache();
    useRuntimeStore.getState().setUpdateLoopState({
        lastCacheCleanupAt: new Date().toISOString(),
        lastCacheCleanupDetail: `Cleared ${cleared.detailCacheCount} remote favorite detail cache entries.`
    });
}

async function deferRuntimeScheduledFrontendJob(
    timerName: string,
    delaySeconds: number
) {
    await commands
        .appRuntimeFrontendScheduleJobDefer({
            name: timerName,
            delaySeconds
        })
        .catch((error: unknown) => {
            console.warn(
                `Failed to defer runtime maintenance task ${timerName}:`,
                error
            );
        });
}

async function getDueRuntimeScheduledFrontendJobs() {
    const dueJobs = await commands
        .appRuntimeFrontendScheduleDueJobsGet()
        .catch((error: unknown): unknown[] => {
            console.warn('Failed to read runtime maintenance due jobs:', error);
            return [];
        });
    return new Set(Array.isArray(dueJobs) ? dueJobs : []);
}

async function runRuntimeScheduledTask(
    timerName: string,
    intervalSeconds: number,
    task: RuntimeScheduledTask
) {
    await runRuntimeTelemetryJob(
        {
            name: timerName,
            cadenceSeconds: intervalSeconds,
            detail: `Running Rust-scheduled frontend maintenance task ${timerName}.`
        },
        task
    );
}

export async function runBackgroundMaintenanceTick() {
    if (running || !useSessionStore.getState().isLoggedIn) {
        return;
    }

    running = true;
    const dueJobs = await getDueRuntimeScheduledFrontendJobs();
    const hasDueJobs = dueJobs.size > 0;
    if (hasDueJobs) {
        recordRuntimeJobTelemetry({
            name: 'backgroundMaintenanceTick',
            owner: 'frontend',
            status: 'running',
            detail: 'Frontend executor is running Rust-scheduled maintenance.'
        });
    }

    try {
        if (dueJobs.has('appUpdateCheck')) {
            await runRuntimeScheduledTask(
                'appUpdateCheck',
                APP_UPDATE_CHECK_INTERVAL_SECONDS,
                checkForAppUpdate
            );
        }
        if (dueJobs.has('clearVRCXCacheCheck')) {
            await runRuntimeScheduledTask(
                'clearVRCXCacheCheck',
                CLEAR_VRCX_CACHE_CADENCE_SECONDS,
                runClearVrcxCache
            );
        }
    } finally {
        running = false;
        if (hasDueJobs) {
            recordRuntimeJobTelemetry({
                name: 'backgroundMaintenanceTick',
                owner: 'frontend',
                status: 'completed',
                detail: 'Rust-scheduled frontend maintenance tick completed.'
            });
        }
    }
}

export function resetBackgroundMaintenance() {
    resetTimers();
}
