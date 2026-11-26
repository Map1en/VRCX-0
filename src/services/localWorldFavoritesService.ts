import type {
    FavoriteGroupMap,
    LocalFavoriteGroup
} from '@/domain/favorites/types';
import { commands } from '@/platform/tauri/bindings';

export interface LocalWorldFavoritesSnapshot {
    favoritesByGroup: FavoriteGroupMap;
    groups: LocalFavoriteGroup[];
}

export async function loadLocalWorldFavoritesSnapshot(): Promise<LocalWorldFavoritesSnapshot> {
    const snapshot = await commands.appFavoriteLocalSnapshot('world');
    const favoritesByGroup: FavoriteGroupMap = {};
    for (const group of snapshot.groups) {
        favoritesByGroup[String(group.id)] = [];
    }
    for (const row of snapshot.favorites) {
        const worldId = (row.worldId ?? '').trim();
        const ids = favoritesByGroup[String(row.groupId)];
        if (worldId && ids && !ids.includes(worldId)) {
            ids.unshift(worldId);
        }
    }
    return {
        favoritesByGroup,
        groups: snapshot.groups
    };
}
