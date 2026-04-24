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

function getCurrentLocationPlayers() {
    return Array.from(ingestState.playersByKey.values())
        .map((player) => {
            const userId = normalizeString(player.userId);
            const displayName = normalizeString(player.displayName);
            const joinTime = Number(player.joinTime) || 0;

            return {
                id: userId || (displayName ? `display:${displayName}` : ''),
                userId,
                displayName,
                joinedAt: joinTime ? new Date(joinTime).toISOString() : '',
                joinedAtMs: joinTime,
                lastDurationMs: 0,
                source: 'runtime'
            };
        })
        .filter((player) => player.id && (player.userId || player.displayName));
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
    getCurrentLocationPlayers,
    getCurrentLocationPlayerIds,
    ingestState,
    instanceMediaState,
    nowPlayingState,
    resetCurrentGameLogSessionState
};
