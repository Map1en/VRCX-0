import { commands } from '@/platform/tauri/bindings';
import { useFavoriteStore } from '@/state/favoriteStore';

import {
    favoriteCachePayload,
    normalizeFavoriteCacheEntityId
} from './favoriteCachePayload';

export async function cacheAvatarDetails(
    avatar: unknown,
    fallbackAvatarId?: unknown
): Promise<boolean> {
    const entity = favoriteCachePayload(avatar);
    if (!entity) {
        return false;
    }
    return commands.appFavoriteCacheSnapshot({
        kind: 'avatar',
        entity,
        fallbackEntityId: normalizeFavoriteCacheEntityId(fallbackAvatarId)
    });
}

function isFavoriteAvatarId(id: string): boolean {
    const state = useFavoriteStore.getState();
    return (
        state.favoriteAvatarIds.includes(id) ||
        state.localAvatarFavoritesList.includes(id)
    );
}

export async function cacheFavoriteAvatarDetails(
    avatar: unknown
): Promise<boolean> {
    const entity = favoriteCachePayload(avatar);
    if (!entity) {
        return false;
    }
    const id = normalizeFavoriteCacheEntityId(entity.id);
    return id && isFavoriteAvatarId(id) ? cacheAvatarDetails(entity) : false;
}

function reportAvatarCacheError(error: unknown): void {
    console.warn('Failed to cache favorite avatar details:', error);
}

export function persistAvatarDetails(
    avatar: unknown,
    fallbackAvatarId?: unknown
): void {
    void cacheAvatarDetails(avatar, fallbackAvatarId).catch(
        reportAvatarCacheError
    );
}

export function persistFavoriteAvatarDetails(avatar: unknown): void {
    void cacheFavoriteAvatarDetails(avatar).catch(reportAvatarCacheError);
}
