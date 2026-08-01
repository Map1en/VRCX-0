import { collectRuntimeRosterPlayers } from '@/domain/instances/currentInstanceRoster';
import { commands } from '@/platform/tauri/bindings';
import type { GameLogProjection } from '@/platform/tauri/bindings';
import { buildCurrentUserGameStatePresencePatch } from '@/shared/utils/currentUserPresence';
import { normalizeLocationValue, parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { useInstanceJoinHistoryStore } from '@/state/instanceJoinHistoryStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { loadCurrentInstanceRoster } from './currentInstanceRosterService';
import { recordGameRuntimePresence } from './domainIngestionService';

type RuntimeState = ReturnType<typeof useRuntimeStore.getState>;
type GameStatePatch = Parameters<RuntimeState['setGameState']>[0];
export function applyRuntimeGameLogProjection(projection: GameLogProjection) {
    const currentLocation = normalizeString(projection.currentLocation);
    const currentWorldId = normalizeString(projection.currentWorldId);
    const currentWorldName = normalizeString(projection.currentWorldName);
    const currentDestination = normalizeString(projection.currentDestination);
    const currentLocationStartedAt = normalizeString(
        projection.currentLocationStartedAt
    );
    const lastGameLogAt =
        normalizeString(projection.lastGameLogAt) || new Date().toISOString();
    const lastGameLogType = normalizeString(projection.lastGameLogType);
    const {
        playerIds: currentLocationPlayerIds,
        players: currentLocationPlayers
    } = collectRuntimeRosterPlayers(projection.currentLocationPlayers);

    const gameStatePatch: GameStatePatch = {
        currentLocation,
        currentWorldId,
        currentWorldName,
        currentDestination,
        currentLocationStartedAt: currentLocationStartedAt || null,
        currentLocationPlayerIds,
        currentLocationPlayers,
        lastGameLogAt,
        lastGameLogType
    };
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setGameState(gameStatePatch);

    if (currentLocation || currentDestination) {
        patchCurrentUserLocationFromGameState(runtimeStore, gameStatePatch);
    }

    if (currentLocationStartedAt) {
        useInstanceJoinHistoryStore
            .getState()
            .recordInstanceJoin(currentLocation, currentLocationStartedAt);
    }

    const domainRuntime = useRuntimeStore.getState();
    recordGameRuntimePresence({
        endpoint: domainRuntime.auth.currentUserEndpoint,
        currentUserId: domainRuntime.auth.currentUserId,
        currentUserSnapshot: domainRuntime.auth.currentUserSnapshot,
        currentLocation,
        currentDestination,
        currentLocationStartedAt,
        currentLocationPlayers,
        currentWorldName
    });
}

export async function restoreRuntimeGameLogProjectionFromPersistence(): Promise<boolean> {
    const initialState = useRuntimeStore.getState();
    const currentUserId = normalizeString(initialState.auth.currentUserId);
    if (
        !currentUserId ||
        !(await commands.appIsGameRunning().catch(() => false))
    ) {
        return false;
    }

    const currentLocation = normalizeLocationValue(
        initialState.gameState.currentLocation
    );
    const requestedLocation = parseLocation(currentLocation).isRealInstance
        ? currentLocation
        : '';
    const snapshot = await loadCurrentInstanceRoster({
        currentUserId,
        currentLocation: requestedLocation,
        currentLocationStartedAt:
            initialState.gameState.currentLocationStartedAt || ''
    });
    const snapshotLocation = normalizeLocationValue(snapshot.context.location);
    const parsedSnapshotLocation = parseLocation(snapshotLocation);
    if (!parsedSnapshotLocation.isRealInstance) {
        return false;
    }

    const latestState = useRuntimeStore.getState();
    const latestLocation = parseLocation(latestState.gameState.currentLocation);
    if (
        normalizeString(latestState.auth.currentUserId) !== currentUserId ||
        latestState.gameState.currentLocationPlayers.length > 0 ||
        (latestLocation.isRealInstance &&
            (latestLocation.worldId !== parsedSnapshotLocation.worldId ||
                latestLocation.instanceId !==
                    parsedSnapshotLocation.instanceId)) ||
        !(await commands.appIsGameRunning().catch(() => false))
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

function patchCurrentUserLocationFromGameState(
    runtimeStore: RuntimeState,
    gameStatePatch: GameStatePatch
) {
    const currentSnapshot = runtimeStore.auth.currentUserSnapshot;
    if (!currentSnapshot || typeof currentSnapshot !== 'object') {
        return;
    }

    const presencePatch = buildCurrentUserGameStatePresencePatch(
        {
            ...runtimeStore.gameState,
            ...gameStatePatch,
            isGameRunning: true
        },
        currentSnapshot
    );
    if (!presencePatch) {
        return;
    }

    const startedAt = Date.parse(
        normalizeString(gameStatePatch.currentLocationStartedAt)
    );
    const locationTime = Number.isFinite(startedAt) ? startedAt : Date.now();
    const timedPresencePatch: Record<string, unknown> = {
        ...presencePatch,
        ...(gameStatePatch.currentLocation === 'traveling'
            ? { $travelingToTime: locationTime }
            : { $location_at: locationTime })
    };

    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: {
            ...currentSnapshot,
            ...timedPresencePatch
        }
    });
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
