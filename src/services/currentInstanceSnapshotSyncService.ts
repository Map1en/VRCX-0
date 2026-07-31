import playerListPersistenceRepository from '@/repositories/playerListPersistenceRepository';
import {
    normalizeLocationValue,
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';
import { useRuntimeStore } from '@/state/runtimeStore';

import { recordGameRuntimePresence } from './domainIngestionService';

type RuntimeState = ReturnType<typeof useRuntimeStore.getState>;

function resolveCurrentInstanceLocation(state: RuntimeState): string {
    const runtimeLocation = normalizeLocationValue(
        state.gameState.currentLocation
    );
    if (runtimeLocation) {
        return parseLocation(runtimeLocation).isRealInstance
            ? runtimeLocation
            : '';
    }
    return resolveFriendPresenceLocation(state.auth.currentUserSnapshot, {
        requireInstance: true
    });
}

function currentInstanceRecoveryScope(
    state: RuntimeState,
    location: string
): string {
    return [
        state.auth.currentUserId,
        state.auth.currentUserEndpoint,
        location,
        normalizeLocationValue(
            state.gameState.currentLocationStartedAt ||
                state.gameState.lastGameStartedAt
        )
    ].join('::');
}

function startCurrentInstanceSnapshotSync(): () => void {
    let disposed = false;
    const attemptedScopes = new Set<string>();
    const requests = new Map<string, Promise<void>>();

    const restoreCurrentInstance = () => {
        if (disposed) {
            return;
        }
        const state = useRuntimeStore.getState();
        if (!state.gameState.isGameRunning) {
            attemptedScopes.clear();
            return;
        }
        if (
            !state.auth.currentUserId ||
            state.gameState.currentLocationPlayerIds.length
        ) {
            return;
        }

        const currentLocation = resolveCurrentInstanceLocation(state);
        if (!parseLocation(currentLocation).isRealInstance) {
            return;
        }
        const scope = currentInstanceRecoveryScope(state, currentLocation);
        if (attemptedScopes.has(scope) || requests.has(scope)) {
            return;
        }
        attemptedScopes.add(scope);

        const request = playerListPersistenceRepository
            .getCurrentInstanceSnapshot({
                currentUserId: state.auth.currentUserId,
                currentLocation,
                currentLocationStartedAt:
                    state.gameState.currentLocationStartedAt ||
                    state.gameState.lastGameStartedAt ||
                    ''
            })
            .then((snapshot) => {
                if (disposed) {
                    return;
                }
                const snapshotLocation = normalizeLocationValue(
                    snapshot.context.location
                );
                if (
                    !parseLocation(snapshotLocation).isRealInstance ||
                    snapshotLocation !== currentLocation
                ) {
                    return;
                }

                const latestState = useRuntimeStore.getState();
                if (
                    !latestState.gameState.isGameRunning ||
                    latestState.auth.currentUserId !==
                        state.auth.currentUserId ||
                    latestState.auth.currentUserEndpoint !==
                        state.auth.currentUserEndpoint ||
                    latestState.gameState.currentLocationPlayerIds.length > 0 ||
                    resolveCurrentInstanceLocation(latestState) !==
                        snapshotLocation ||
                    currentInstanceRecoveryScope(
                        latestState,
                        snapshotLocation
                    ) !== scope
                ) {
                    return;
                }

                const players = Array.isArray(snapshot.players)
                    ? snapshot.players
                    : [];
                const playerIds = players
                    .map((player) => String(player.userId || '').trim())
                    .filter(Boolean);
                const startedAt =
                    snapshot.context.createdAt ||
                    latestState.gameState.currentLocationStartedAt ||
                    '';
                const parsedLocation = parseLocation(snapshotLocation);

                if (!latestState.gameState.currentLocationPlayerIds.length) {
                    latestState.setGameState({
                        currentLocation: snapshotLocation,
                        currentLocationStartedAt: startedAt || null,
                        currentLocationPlayerIds: playerIds,
                        currentLocationPlayers: players,
                        currentWorldId: parsedLocation.worldId,
                        currentWorldName: snapshot.context.worldName
                    });
                }
                recordGameRuntimePresence({
                    endpoint: latestState.auth.currentUserEndpoint,
                    currentUserId: latestState.auth.currentUserId,
                    currentUserSnapshot: latestState.auth.currentUserSnapshot,
                    currentLocation: snapshotLocation,
                    currentLocationStartedAt: startedAt,
                    currentLocationPlayers: players,
                    currentWorldName: snapshot.context.worldName
                });
            })
            .catch((error: unknown) => {
                console.warn(
                    'Failed to restore current instance snapshot:',
                    error
                );
            })
            .finally(() => {
                requests.delete(scope);
            });
        requests.set(scope, request);
    };

    restoreCurrentInstance();
    const unsubscribe = useRuntimeStore.subscribe((state, previousState) => {
        if (
            state.auth.currentUserId !== previousState.auth.currentUserId ||
            state.auth.currentUserEndpoint !==
                previousState.auth.currentUserEndpoint ||
            state.auth.currentUserSnapshot !==
                previousState.auth.currentUserSnapshot ||
            state.gameState.isGameRunning !==
                previousState.gameState.isGameRunning ||
            state.gameState.currentLocation !==
                previousState.gameState.currentLocation ||
            state.gameState.currentLocationStartedAt !==
                previousState.gameState.currentLocationStartedAt ||
            state.gameState.lastGameStartedAt !==
                previousState.gameState.lastGameStartedAt ||
            state.gameState.currentLocationPlayerIds !==
                previousState.gameState.currentLocationPlayerIds
        ) {
            restoreCurrentInstance();
        }
    });

    return () => {
        disposed = true;
        unsubscribe();
        attemptedScopes.clear();
        requests.clear();
    };
}

export { resolveCurrentInstanceLocation, startCurrentInstanceSnapshotSync };
