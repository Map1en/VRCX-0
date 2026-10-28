import { commands } from '@/platform/tauri/bindings';
import type { GameIsolationSnapshot } from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    hydrateRuntimeGameLogProjection,
    resetGameLogSessionState
} from './gameLogIngestService';

export function applyGameIsolationSnapshot(snapshot: GameIsolationSnapshot) {
    const wasEnabled = useRuntimeStore.getState().gameIsolation.enabled;
    useRuntimeStore.getState().setGameIsolation(snapshot);
    const enabled = useRuntimeStore.getState().gameIsolation.enabled;
    if (enabled === wasEnabled) {
        return;
    }
    if (enabled) {
        resetGameLogSessionState();
        return;
    }
    void hydrateRuntimeGameLogProjection().catch((error: unknown) => {
        console.warn('Failed to restore the local game room:', error);
    });
}

export async function setGameIsolationEnabled(enabled: boolean) {
    applyGameIsolationSnapshot(await commands.appGameIsolationSet(enabled));
}
