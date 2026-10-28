import { collectRuntimeRosterPlayers } from '@/domain/instances/currentInstanceRoster';
import { commands } from '@/platform/tauri/bindings';
import type { GameLogProjection } from '@/platform/tauri/bindings';
import { normalizeLocationValue, parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { useInstanceJoinHistoryStore } from '@/state/instanceJoinHistoryStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { loadCurrentInstanceRoster } from './currentInstanceRosterService';
import { recordGameRuntimePresence } from './domainIngestionService';

type RuntimeState = ReturnType<typeof useRuntimeStore.getState>;
type GameStatePatch = Parameters<RuntimeState['setGameState']>[0];
export function applyRuntimeGameLogProjection(projection: GameLogProjection) {
    if (useRuntimeStore.getState().gameIsolation.enabled) {
        return;
    }
    const {
        currentLocation,
        currentWorldId,
        currentWorldName,
        currentDestination,
        currentLocationStartedAt,
        lastGameLogAt,
        lastGameLogType
    } = projection;
    const {
        playerIds: currentLocationPlayerIds,
        players: currentLocationPlayers
    } = collectRuntimeRosterPlayers(projection.currentLocationPlayers);

    const gameStatePatch: GameStatePatch = {
        currentLocation,
        currentWorldId,
        currentWorldName,
        currentDestination,
        currentLocationStartedAt,
        currentLocationPlayerIds,
        currentLocationPlayers,
        lastGameLogAt,
        lastGameLogType
    };
    useRuntimeStore.getState().setGameState(gameStatePatch);

    if (currentLocationStartedAt) {
        useInstanceJoinHistoryStore
            .getState()
            .recordInstanceJoin(currentLocation, currentLocationStartedAt);
    }

    const domainRuntime = useRuntimeStore.getState();
    recordGameRuntimePresence({
        endpoint: domainRuntime.auth.currentUserEndpoint,
        currentLocation,
        currentDestination,
        currentLocationStartedAt,
        currentLocationPlayers,
        currentWorldName
    });
}

export async function hydrateRuntimeGameLogProjection(): Promise<boolean> {
    const initialState = useRuntimeStore.getState();
    const currentUserId = normalizeString(initialState.auth.currentUserId);
    if (
        !currentUserId ||
        !(await commands.appIsGameRunning().catch(() => false))
    ) {
        return false;
    }

    const snapshot = await loadCurrentInstanceRoster({ currentLocation: '' });
    const snapshotLocation = normalizeLocationValue(snapshot.context.location);
    const parsedSnapshotLocation = parseLocation(snapshotLocation);
    if (
        snapshot.context.source !== 'runtime' ||
        !parsedSnapshotLocation.isRealInstance
    ) {
        return false;
    }

    const stillRunning = await commands.appIsGameRunning().catch(() => false);
    const latestState = useRuntimeStore.getState();
    if (
        normalizeString(latestState.auth.currentUserId) !== currentUserId ||
        latestState.auth.currentUserEndpoint !==
            initialState.auth.currentUserEndpoint ||
        latestState.gameState !== initialState.gameState ||
        latestState.runtimeEvents.gameLogProjection?.count !==
            initialState.runtimeEvents.gameLogProjection?.count ||
        !stillRunning
    ) {
        return false;
    }

    applyRuntimeGameLogProjection({
        currentLocation: snapshotLocation,
        currentDestination: '',
        currentLocationPlayerIds: [],
        currentWorldId: snapshot.context.worldId,
        currentWorldName: snapshot.context.worldName,
        currentLocationStartedAt: snapshot.context.createdAt,
        currentLocationPlayers: snapshot.players.map((player) => ({
            userId: player.userId,
            displayName: player.displayName,
            joinTimeMs: player.joinedAtMs
        })),
        lastGameLogAt: snapshot.context.createdAt,
        lastGameLogType: 'startup-roster'
    });
    return true;
}

export function resetGameLogSessionState(
    stoppedAt: string = new Date().toISOString()
) {
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.resetNowPlayingState();
    runtimeStore.setGameState({
        currentLocation: '',
        currentWorldId: '',
        currentWorldName: '',
        currentDestination: '',
        currentLocationStartedAt: null,
        currentLocationPlayerIds: [],
        currentLocationPlayers: [],
        lastGameLogAt: stoppedAt,
        lastGameLogType: 'game-stopped'
    });
}
