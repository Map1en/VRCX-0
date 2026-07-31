import { useMemo } from 'react';

import { useCurrentInstancePresence } from '@/lib/useCurrentInstancePresence';
import { useRuntimeStore } from '@/state/runtimeStore';

const EMPTY_CURRENT_LOCATION_PLAYER_IDS = Object.freeze([]);

export function useFriendsLocationsRuntime() {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const currentLocationPlayerIds = useRuntimeStore(
        (state) => state.gameState.currentLocationPlayerIds
    );
    const currentLocationPlayers = useRuntimeStore(
        (state) => state.gameState.currentLocationPlayers
    );
    const domainCurrentInstancePresence = useCurrentInstancePresence();
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const effectiveCurrentLocationPlayerIds =
        currentLocationPlayerIds && currentLocationPlayerIds.length
            ? currentLocationPlayerIds
            : domainCurrentInstancePresence?.userIds ||
              EMPTY_CURRENT_LOCATION_PLAYER_IDS;
    const gameState = useMemo(
        () => ({
            currentLocation: runtimeCurrentLocation,
            currentDestination: runtimeCurrentDestination,
            currentLocationPlayerIds: effectiveCurrentLocationPlayerIds,
            currentLocationPlayers,
            isGameRunning
        }),
        [
            currentLocationPlayers,
            effectiveCurrentLocationPlayerIds,
            isGameRunning,
            runtimeCurrentDestination,
            runtimeCurrentLocation
        ]
    );
    const canBoop = Boolean(currentUserSnapshot?.isBoopingEnabled);

    return {
        canBoop,
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        gameState
    };
}
