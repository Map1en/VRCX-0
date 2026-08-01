import { commands } from '@/platform/tauri/bindings';
import { useFavoriteStore } from '@/state/favoriteStore';

import {
    favoriteCachePayload,
    normalizeFavoriteCacheEntityId
} from './favoriteCachePayload';

export async function cacheWorldDetails(
    world: unknown,
    fallbackWorldId?: unknown
): Promise<boolean> {
    const entity = favoriteCachePayload(world);
    if (!entity) {
        return false;
    }
    return commands.appFavoriteCacheSnapshot({
        kind: 'world',
        entity,
        fallbackEntityId: normalizeFavoriteCacheEntityId(fallbackWorldId)
    });
}

function isFavoriteWorldId(id: string): boolean {
    const state = useFavoriteStore.getState();
    return (
        state.favoriteWorldIds.includes(id) ||
        state.localWorldFavoritesList.includes(id)
    );
}

export async function cacheFavoriteWorldDetails(
    world: unknown
): Promise<boolean> {
    const entity = favoriteCachePayload(world);
    if (!entity) {
        return false;
    }
    const id = normalizeFavoriteCacheEntityId(entity.id);
    return id && isFavoriteWorldId(id) ? cacheWorldDetails(entity) : false;
}

function reportWorldCacheError(error: unknown): void {
    console.warn('Failed to cache favorite world details:', error);
}

export function persistWorldDetails(
    world: unknown,
    fallbackWorldId?: unknown
): void {
    void cacheWorldDetails(world, fallbackWorldId).catch(reportWorldCacheError);
}

export function persistFavoriteWorldDetails(world: unknown): void {
    void cacheFavoriteWorldDetails(world).catch(reportWorldCacheError);
}
