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

const BACKEND_GAME_LOG_SIDE_EFFECT_TYPES = new Set([
    'video-play',
    'video-sync',
    'vrcx',
    'api-request',
    'screenshot',
    'sticker-spawn',
    'vrc-quit',
    'openvr-init',
    'desktop-mode',
    'udon-exception'
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

export function isBackendHandledGameLogSideEffectType(type: unknown): boolean {
    return BACKEND_GAME_LOG_SIDE_EFFECT_TYPES.has(String(type || ''));
}

export function shouldSkipBackendHandledGameLogSideEffect(
    gameLog: GameLogLike,
    options: { backendGameLogSideEffectsAvailable: boolean }
): boolean {
    return (
        options.backendGameLogSideEffectsAvailable &&
        isBackendHandledGameLogSideEffectType(gameLog?.type)
    );
}
