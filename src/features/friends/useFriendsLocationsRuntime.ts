import { useMemo } from 'react';

import { useCurrentInstancePresence } from '@/domain/presence/useCurrentInstancePresence';
import { useRuntimeStore } from '@/state/runtimeStore';

const EMPTY_CURRENT_LOCATION_PLAYER_IDS = Object.freeze([]);

export function useFriendsLocationsRuntime() {
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state: any) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state: any) => state.gameState.currentDestination
    );
    const currentLocationPlayerIds = useRuntimeStore(
        (state: any) => state.gameState.currentLocationPlayerIds
    );
    const domainCurrentInstancePresence = useCurrentInstancePresence();
    const isGameRunning = useRuntimeStore(
        (state: any) => state.gameState.isGameRunning
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
            isGameRunning
        }),
        [
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
