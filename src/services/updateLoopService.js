import { useRuntimeStore } from '@/state/runtimeStore.js';
import { syncGameLogTail } from './gameLogIngestService.js';
import {
    resetBackgroundMaintenance,
    runBackgroundMaintenanceTick
} from './backgroundMaintenanceService.js';

let updateLoopTimer = null;
let stopped = true;

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
        await syncGameLogTail();
        await runBackgroundMaintenanceTick();
        useRuntimeStore
            .getState()
            .setStartupTask(
                'updateLoop',
                'running',
                'Game log tail sync and background maintenance are active.'
            );
    } catch (error) {
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
            'Starting game log tail sync and background maintenance.'
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
        .setStartupTask('updateLoop', 'pending', 'Game log tail sync is stopped.');
    resetBackgroundMaintenance();
}
