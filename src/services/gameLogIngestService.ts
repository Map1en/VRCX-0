import { buildCurrentUserGameStatePresencePatch } from '@/shared/utils/currentUserPresence';
import { normalizeString } from '@/shared/utils/string';
import { useRuntimeStore } from '@/state/runtimeStore';

import { recordGameRuntimePresence } from './domainIngestionService';

type RuntimeState = ReturnType<typeof useRuntimeStore.getState>;
type GameStatePatch = Parameters<RuntimeState['setGameState']>[0];
type CurrentLocationPlayer = {
    id: string;
    userId: string;
    displayName: string;
    joinedAt: string;
    joinedAtMs: number;
    lastDurationMs: number;
    source: 'runtime';
};

function collectProjectionPlayers(value: unknown): {
    playerIds: string[];
    players: CurrentLocationPlayer[];
} {
    const playersByKey = new Map<string, CurrentLocationPlayer>();
    for (const entry of Array.isArray(value) ? value : []) {
        const player =
            entry && typeof entry === 'object'
                ? (entry as Record<string, unknown>)
                : {};
        const userId = normalizeString(player.userId);
        const displayName = normalizeString(player.displayName);
        if (!userId && !displayName) {
            continue;
        }
        const joinTime = Number(player.joinTimeMs) || 0;
        playersByKey.set(userId || `display:${displayName}`, {
            id: userId || `display:${displayName}`,
            userId,
            displayName,
            joinedAt: joinTime ? new Date(joinTime).toISOString() : '',
            joinedAtMs: joinTime,
            lastDurationMs: 0,
            source: 'runtime'
        });
    }

    const players = Array.from(playersByKey.values());
    return {
        playerIds: Array.from(
            new Set(players.map((player) => player.userId).filter(Boolean))
        ),
        players
    };
}

export function applyRuntimeGameLogProjection(payload: unknown) {
    const projection =
        payload && typeof payload === 'object'
            ? (payload as Record<string, unknown>)
            : {};
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
    } = collectProjectionPlayers(projection.currentLocationPlayers);

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
