import type { FavoriteItem } from './favoritesTypes';

export const SHARE_COLLECTION_CLIENT_WORLD_CAP = 1000;

type ShareCollectionWorldCandidate = Pick<FavoriteItem, 'id'>;

type ShareCollectionWorldIds = {
    worldIds: string[];
    totalWorldIds: number;
    truncated: boolean;
};

export function buildShareCollectionWorldIds(
    items: readonly ShareCollectionWorldCandidate[]
): ShareCollectionWorldIds {
    const seen = new Set<string>();
    const validWorldIds: string[] = [];
    for (const item of items) {
        const worldId = item.id.trim();
        if (!worldId.startsWith('wrld_') || seen.has(worldId)) {
            continue;
        }
        seen.add(worldId);
        validWorldIds.push(worldId);
    }

    return {
        worldIds: validWorldIds.slice(0, SHARE_COLLECTION_CLIENT_WORLD_CAP),
        totalWorldIds: validWorldIds.length,
        truncated: validWorldIds.length > SHARE_COLLECTION_CLIENT_WORLD_CAP
    };
}
