import { useRuntimeStore } from '@/state/runtimeStore.js';

import { normalizeString } from './parsing.js';

const ingestState = {
    initialized: false,
    initializing: null,
    syncing: false,
    tailCaughtUp: false,
    currentLocation: '',
    currentWorldName: '',
    currentLocationStartedAt: '',
    playersByKey: new Map(),
    lastVideoUrl: '',
    lastResourceUrl: ''
};

const nowPlayingState = {
    url: ''
};

const instanceMediaState = {
    printIds: [],
    stickerInventoryIds: [],
    emojiInventoryIds: []
};

function getCurrentLocationPlayerIds() {
    return Array.from(
        new Set(
            Array.from(ingestState.playersByKey.values())
                .map((player) => normalizeString(player.userId))
                .filter(Boolean)
        )
    );
}

function getCurrentLocation() {
    return (
        ingestState.currentLocation ||
        normalizeString(useRuntimeStore.getState().gameState.currentLocation) ||
        normalizeString(
            useRuntimeStore.getState().auth.currentUserSnapshot?.location
        )
    );
}

function resetCurrentGameLogSessionState() {
    ingestState.currentLocation = '';
    ingestState.currentWorldName = '';
    ingestState.currentLocationStartedAt = '';
    ingestState.playersByKey.clear();
    ingestState.lastVideoUrl = '';
    ingestState.lastResourceUrl = '';
}

export {
    getCurrentLocation,
    getCurrentLocationPlayerIds,
    ingestState,
    instanceMediaState,
    nowPlayingState,
    resetCurrentGameLogSessionState
};
