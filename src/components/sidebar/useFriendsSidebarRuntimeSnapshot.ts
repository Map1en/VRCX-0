import { useMemo } from 'react';

import { useCurrentInstancePresence } from '@/lib/useCurrentInstancePresence';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

const EMPTY_CURRENT_LOCATION_PLAYER_IDS = Object.freeze([]);

export function useFriendsSidebarRuntimeSnapshot() {
    const themeMode = useShellStore((state) => state.themeMode);
    const currentUser = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
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
            isGameRunning
        }),
        [
            effectiveCurrentLocationPlayerIds,
            isGameRunning,
            runtimeCurrentDestination,
            runtimeCurrentLocation
        ]
    );
    const currentLocation =
        runtimeCurrentLocation === 'traveling'
            ? runtimeCurrentDestination
            : runtimeCurrentLocation;
    const isDarkMode =
        themeMode === 'dark' ||
        (typeof document !== 'undefined' &&
            document.documentElement.classList.contains('dark'));

    return {
        currentEndpoint,
        currentLocation,
        currentUser,
        currentUserId,
        effectiveCurrentLocationPlayerIds,
        gameState,
        isDarkMode
    };
}
