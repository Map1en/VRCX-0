import { normalizeString as normalizeId } from '@/shared/utils/string';

export type GameLogSessionDurationDetails = {
    durationByKey: Map<string, number>;
    maxDurationMs: number;
};

export function createEmptyGameLogSessionDurationDetails(): GameLogSessionDurationDetails {
    return {
        durationByKey: new Map(),
        maxDurationMs: 0
    };
}

export function playerDurationKey(item: any) {
    const userId = normalizeId(item?.userId || item?.user_id);
    if (userId) {
        return `id:${userId}`;
    }
    const displayName = String(item?.displayName || item?.display_name || '')
        .trim()
        .toUpperCase();
    return displayName ? `name:${displayName}` : '';
}

export function buildGameLogSessionDurationDetails(
    rows: any[]
): GameLogSessionDurationDetails {
    const durationByKey = new Map<string, number>();

    for (const row of rows) {
        const key = playerDurationKey(row);
        const durationMs = Number(row?.time || 0);
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
    item: any
) {
    const key = playerDurationKey(item);
    return key ? durationByKey.get(key) || 0 : 0;
}
