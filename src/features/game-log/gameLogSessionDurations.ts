import type { GameLogSessionPlayerDurationRowDto } from '@/platform/tauri/bindings';

export type GameLogSessionDurationDetails = {
    durationByKey: Map<string, number>;
    maxDurationMs: number;
};

type GameLogSessionPlayerIdentity = Pick<
    GameLogSessionPlayerDurationRowDto,
    'displayName' | 'userId'
>;

function playerDurationKey(
    item: GameLogSessionPlayerIdentity | null | undefined
) {
    const userId = item?.userId.trim() ?? '';
    if (userId) {
        return `id:${userId}`;
    }
    const displayName = (item?.displayName ?? '').trim().toUpperCase();
    return displayName ? `name:${displayName}` : '';
}

export function buildGameLogSessionDurationDetails(
    rows: readonly GameLogSessionPlayerDurationRowDto[]
): GameLogSessionDurationDetails {
    const durationByKey = new Map<string, number>();

    for (const row of rows) {
        const key = playerDurationKey(row);
        const durationMs = row.time;
        if (!key || !Number.isFinite(durationMs) || durationMs <= 0) {
            continue;
        }
        durationByKey.set(key, (durationByKey.get(key) || 0) + durationMs);
    }

    return {
        durationByKey,
        maxDurationMs: Math.max(0, ...durationByKey.values())
    };
}

export function getGameLogSessionPlayerDuration(
    durationByKey: Map<string, number>,
    item: GameLogSessionPlayerIdentity | null | undefined
) {
    const key = playerDurationKey(item);
    return key ? durationByKey.get(key) || 0 : 0;
}
