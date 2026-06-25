import { parseLocation } from '@/shared/utils/location';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

export function usePlayerListRuntime() {
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentUserEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const gameLogLocation = useRuntimeStore(
        (state: any) => state.gameState.currentLocation || ''
    );
    const currentUserLocation = useRuntimeStore((state: any) => {
        return (
            state.gameState.currentLocation ||
            state.auth.currentUserSnapshot?.location ||
            ''
        );
    });
    const currentUserWorldId = useRuntimeStore(
        (state: any) =>
            parseLocation(state.gameState.currentLocation || '').worldId ||
            state.auth.currentUserSnapshot?.worldId ||
            ''
    );
    const currentLocationStartedAt = useRuntimeStore(
        (state: any) => state.gameState.currentLocationStartedAt
    );
    const isGameRunning = useRuntimeStore((state: any) =>
        Boolean(state.gameState.isGameRunning)
    );
    const addGameLogEventCount = useRuntimeStore(
        (state: any) => state.runtimeEvents.addGameLogEvent.count
    );
    const gameLogTailSyncedAt = useRuntimeStore(
        (state: any) => state.updateLoop.lastGameLogSyncAt
    );
    const runtimePlayerRows = useRuntimeStore(
        (state: any) => state.gameState.currentLocationPlayers
    );
    const gameLogDisabled = usePreferencesStore(
        (state: any) => state.gameLogDisabled
    );

    return {
        addGameLogEventCount,
        currentLocationStartedAt,
        currentUserEndpoint,
        currentUserId,
        currentUserLocation,
        currentUserSnapshot,
        currentUserWorldId,
        gameLogLocation,
        gameLogDisabled,
        gameLogTailSyncedAt,
        isGameRunning,
        runtimePlayerRows
    };
}
