const BACKEND_GAME_LOG_INGEST_TYPES = new Set([
    'location',
    'location-destination',
    'player-joined',
    'player-left',
    'portal-spawn',
    'resource-load-string',
    'resource-load-image',
    'event'
]);

type GameLogLike = {
    type?: unknown;
};

export function isBackendPersistedGameLogType(type: unknown): boolean {
    return BACKEND_GAME_LOG_INGEST_TYPES.has(String(type || ''));
}

export function shouldSkipBackendPersistedGameLog(
    gameLog: GameLogLike,
    options: { backendGameLogIngestAvailable: boolean }
): boolean {
    return (
        options.backendGameLogIngestAvailable &&
        isBackendPersistedGameLogType(gameLog?.type)
    );
}
