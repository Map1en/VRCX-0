import { isWorldId } from '@/shared/constants/vrchatIds';

import type { FavoriteItem } from './favoritesTypes';

export const SHARE_COLLECTION_CLIENT_WORLD_CAP = 1000;

type ShareCollectionWorldCandidate = Pick<FavoriteItem, 'id' | 'title'>;

type SkippedShareCollectionWorld = {
    worldId: string;
    name: string;
};

type ShareCollectionWorldIds = {
    worldIds: string[];
    skippedWorlds: SkippedShareCollectionWorld[];
    totalWorldIds: number;
    truncated: boolean;
};

export function buildShareCollectionWorldIds(
    items: readonly ShareCollectionWorldCandidate[]
): ShareCollectionWorldIds {
    const seen = new Set<string>();
    const validWorldIds: string[] = [];
    const skippedWorlds: SkippedShareCollectionWorld[] = [];
    for (const item of items) {
        const worldId = item.id.trim();
        if (!isWorldId(worldId)) {
            skippedWorlds.push({
                worldId,
                name: item.title?.trim() || worldId
            });
            continue;
        }
        if (seen.has(worldId)) {
            continue;
        }
        seen.add(worldId);
        validWorldIds.push(worldId);
    }

    return {
        worldIds: validWorldIds.slice(0, SHARE_COLLECTION_CLIENT_WORLD_CAP),
        skippedWorlds,
        totalWorldIds: validWorldIds.length,
        truncated: validWorldIds.length > SHARE_COLLECTION_CLIENT_WORLD_CAP
    };
}
