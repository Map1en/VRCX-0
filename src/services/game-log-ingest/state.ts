import { normalizeString } from '@/shared/utils/string';
import { useRuntimeStore } from '@/state/runtimeStore';

type GameLogPlayer = {
    userId?: unknown;
    displayName?: unknown;
    joinTime?: unknown;
    joinTimeMs?: unknown;
};
type CurrentLocationPlayer = {
    id: string;
    userId: string;
    displayName: string;
    joinedAt: string;
    joinedAtMs: number;
    lastDurationMs: number;
    source: 'runtime';
};
type IngestState = {
    initialized: boolean;
    initializing: Promise<unknown> | null;
    watcherInitialized: boolean;
    syncing: boolean;
    tailCaughtUp: boolean;
    currentLocation: string;
    currentWorldName: string;
    currentLocationStartedAt: string;
    playersByKey: Map<string, GameLogPlayer>;
    lastVideoUrl: string;
    lastResourceUrl: string;
};
type RuntimeAuthSnapshot = Record<string, unknown> & {
    location?: unknown;
};

const ingestState: IngestState = {
    initialized: false,
    initializing: null,
    watcherInitialized: false,
    syncing: false,
    tailCaughtUp: false,
    currentLocation: '',
    currentWorldName: '',
    currentLocationStartedAt: '',
    playersByKey: new Map(),
    lastVideoUrl: '',
    lastResourceUrl: ''
};

const nowPlayingState: { url: string } = {
    url: ''
};

const instanceMediaState: {
    printIds: unknown[];
    stickerInventoryIds: unknown[];
    emojiInventoryIds: unknown[];
} = {
    printIds: [],
    stickerInventoryIds: [],
    emojiInventoryIds: []
};

function getCurrentLocationPlayerIds(): string[] {
    return Array.from(
        new Set(
            Array.from(ingestState.playersByKey.values())
                .map((player) => normalizeString(player.userId))
                .filter(Boolean)
        )
    );
}

function getCurrentLocationPlayers(): CurrentLocationPlayer[] {
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
                source: 'runtime' as const
            };
        })
        .filter((player): player is CurrentLocationPlayer =>
            Boolean(player.id && (player.userId || player.displayName))
        );
}

function getCurrentLocation(): string {
    const currentUserSnapshot = useRuntimeStore.getState().auth
        .currentUserSnapshot as RuntimeAuthSnapshot | null | undefined;
    return (
        ingestState.currentLocation ||
        normalizeString(useRuntimeStore.getState().gameState.currentLocation) ||
        normalizeString(currentUserSnapshot?.location)
    );
}

function resetCurrentGameLogSessionState(): void {
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
export type { CurrentLocationPlayer, GameLogPlayer };
