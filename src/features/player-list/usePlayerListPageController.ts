import { parseLocation } from '@/shared/utils/location';

import { useCurrentPlayerRows } from './useCurrentPlayerRows';
import { usePlayerListActions } from './usePlayerListActions';
import { usePlayerListClock } from './usePlayerListClock';
import { usePlayerListLogLocation } from './usePlayerListLogLocation';
import { usePlayerListModeration } from './usePlayerListModeration';
import { usePlayerListProfileData } from './usePlayerListProfileData';
import { usePlayerListRuntime } from './usePlayerListRuntime';
import { usePlayerListSourceRows } from './usePlayerListSourceRows';
import { usePlayerListViewData } from './usePlayerListViewData';

export function usePlayerListPageController() {
    const runtime = usePlayerListRuntime();
    const clockNow = usePlayerListClock();
    const logLocationSnapshot = usePlayerListLogLocation(runtime);
    const playerListLocation =
        runtime.currentUserLocation || logLocationSnapshot?.location || '';
    const playerListWorldId =
        runtime.currentUserWorldId ||
        parseLocation(playerListLocation).worldId ||
        '';
    const playerListStartedAt =
        runtime.currentLocationStartedAt ||
        logLocationSnapshot?.createdAt ||
        '';
    const rowsState = useCurrentPlayerRows({
        ...runtime,
        logLocationSnapshot,
        playerListLocation,
        playerListStartedAt,
        playerListWorldId
    });
    const instanceSnapshot = rowsState.context;
    const moderationByUserId = usePlayerListModeration(runtime.currentUserId);
    const playerSourceRows = usePlayerListSourceRows({
        context: instanceSnapshot,
        currentLocationStartedAt: playerListStartedAt,
        currentUserId: runtime.currentUserId,
        currentUserLocation: playerListLocation,
        currentUserSnapshot: runtime.currentUserSnapshot,
        isGameRunning: runtime.isGameRunning,
        playerRows: rowsState.playerRows,
        runtimeRosterAvailable:
            Boolean(runtime.gameLogLocation) &&
            runtime.gameLogLocation === playerListLocation,
        runtimePlayerRows: runtime.runtimePlayerRows
    });
    const profileData = usePlayerListProfileData({
        currentUserEndpoint: runtime.currentUserEndpoint,
        currentUserId: runtime.currentUserId,
        playerSourceRows
    });
    const viewData = usePlayerListViewData({
        clockNow,
        context: instanceSnapshot,
        currentUserId: runtime.currentUserId,
        currentUserLocation: playerListLocation,
        currentUserSnapshot: runtime.currentUserSnapshot,
        gameLogDisabled: runtime.gameLogDisabled,
        isGameRunning: runtime.isGameRunning,
        knownUsersById: profileData.knownUsersById,
        languageOptionsMap: profileData.languageOptionsMap,
        loadStatus: rowsState.loadStatus,
        moderationByUserId,
        playerSourceRows,
        profilesByUserId: profileData.profilesByUserId
    });
    const actions = usePlayerListActions({
        currentUserEndpoint: runtime.currentUserEndpoint
    });

    return {
        actions,
        clockNow,
        detail: rowsState.detail,
        gameLogDisabled: runtime.gameLogDisabled,
        instanceSnapshot,
        isGameRunning: runtime.isGameRunning,
        loadStatus: rowsState.loadStatus,
        playerListLocation,
        playerListStartedAt,
        viewData
    };
}
