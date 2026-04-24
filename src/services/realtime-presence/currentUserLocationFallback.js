import { gameLogRepository } from '@/repositories/index.js';
import { buildCurrentUserGameStatePresencePatch } from '@/shared/utils/currentUserPresence.js';
import { createLocationEntry } from '@/shared/utils/gameLog.js';
import { isRealInstance } from '@/shared/utils/instance.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import {
    buildLocationPatch,
    firstString,
    getCurrentUserSnapshot,
    setCurrentUserSnapshot
} from './helpers.js';

function patchCurrentUserSnapshotFromGameState(runtimeStore) {
    const currentSnapshot = getCurrentUserSnapshot(runtimeStore);
    if (!currentSnapshot) {
        return false;
    }
    const presencePatch = buildCurrentUserGameStatePresencePatch(
        runtimeStore.gameState,
        currentSnapshot
    );
    if (!presencePatch) {
        return false;
    }
    const startedAt = Date.parse(
        runtimeStore.gameState.currentLocationStartedAt || ''
    );
    const locationTime = Number.isFinite(startedAt) ? startedAt : Date.now();
    setCurrentUserSnapshot(runtimeStore, {
        ...currentSnapshot,
        ...presencePatch,
        ...(runtimeStore.gameState.currentLocation === 'traveling'
            ? { $travelingToTime: locationTime }
            : { $location_at: locationTime })
    });
    return true;
}

async function updateRealtimeLocationFallback(location) {
    const normalizedLocation = firstString(location);
    const runtimeStore = useRuntimeStore.getState();
    if (!normalizedLocation || runtimeStore.gameState.isGameRunning) {
        return;
    }

    if (!isRealInstance(normalizedLocation)) {
        runtimeStore.setGameState({
            currentLocation: '',
            currentWorldId: '',
            currentWorldName: '',
            currentDestination: '',
            currentLocationStartedAt: null,
            currentLocationPlayerIds: []
        });
        return;
    }

    const createdAt = new Date().toISOString();
    const parsed = parseLocation(normalizedLocation);
    const worldName = parsed.worldId
        ? await gameLogRepository.getWorldNameByWorldId(parsed.worldId)
        : '';
    runtimeStore.setGameState({
        currentLocation: normalizedLocation,
        currentWorldId: parsed.worldId || '',
        currentWorldName: worldName || '',
        currentDestination: '',
        currentLocationStartedAt: createdAt,
        currentLocationPlayerIds: [],
        lastGameLogAt: createdAt,
        lastGameLogType: 'location'
    });

    const latestLocations = await gameLogRepository.lookupGameLogDatabase(
        ['Location'],
        [],
        1
    );
    const latestLocation =
        Array.isArray(latestLocations) && latestLocations.length
            ? firstString(latestLocations[0]?.location)
            : '';
    if (latestLocation === normalizedLocation) {
        return;
    }

    await gameLogRepository.addGamelogLocationToDatabase(
        createLocationEntry(
            createdAt,
            normalizedLocation,
            parsed.worldId || '',
            worldName || ''
        )
    );
}

async function applyCurrentUserLocationEvent(
    content,
    { isGameLogDisabled, patchCurrentUserSnapshot }
) {
    const runtimeStore = useRuntimeStore.getState();
    patchCurrentUserSnapshot(
        buildLocationPatch(
            content.location,
            content.travelingToLocation,
            content.worldId,
            runtimeStore.auth.currentUserSnapshot
        )
    );

    if (
        runtimeStore.gameState.isGameRunning &&
        !(await isGameLogDisabled()) &&
        firstString(runtimeStore.gameState.currentLocation)
    ) {
        patchCurrentUserSnapshotFromGameState(useRuntimeStore.getState());
        return true;
    }

    await updateRealtimeLocationFallback(content.location);
    return true;
}

export {
    applyCurrentUserLocationEvent,
    patchCurrentUserSnapshotFromGameState,
    updateRealtimeLocationFallback
};
