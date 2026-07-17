import favoritePersistenceRepository, {
    type AvatarFavoriteRow,
    type FriendFavoriteRow,
    type WorldFavoriteRow
} from '@/repositories/favoritePersistenceRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import type {
    FavoriteGroupMap,
    FavoriteKind
} from '@/state/favoriteStoreTypes';

function buildGroupMap<Row extends { groupName: string }>(
    rows: Row[],
    idField: keyof Row
): FavoriteGroupMap {
    const map: FavoriteGroupMap = {};
    for (const row of rows) {
        const groupName = row.groupName;
        const entityId = String(row[idField] ?? '');
        if (!groupName || !entityId) {
            continue;
        }
        const bucket = map[groupName];
        if (bucket) {
            if (!bucket.includes(entityId)) {
                bucket.push(entityId);
            }
        } else {
            map[groupName] = [entityId];
        }
    }
    return map;
}

async function refreshLocalWorldFavorites(): Promise<void> {
    const [rows, groups] = await Promise.all([
        favoritePersistenceRepository.getWorldFavorites(),
        favoritePersistenceRepository.getExplicitLocalFavoriteGroups('world')
    ]);
    useFavoriteStore.getState().setLocalFavoritesForKind('world', {
        localFavorites: buildGroupMap<WorldFavoriteRow>(rows, 'worldId'),
        localFavoriteGroups: groups
    });
}

async function refreshLocalAvatarFavorites(): Promise<void> {
    const [rows, groups] = await Promise.all([
        favoritePersistenceRepository.getAvatarFavorites(),
        favoritePersistenceRepository.getExplicitLocalFavoriteGroups('avatar')
    ]);
    useFavoriteStore.getState().setLocalFavoritesForKind('avatar', {
        localFavorites: buildGroupMap<AvatarFavoriteRow>(rows, 'avatarId'),
        localFavoriteGroups: groups
    });
}

async function refreshLocalFriendFavorites(): Promise<void> {
    const [rows, groups] = await Promise.all([
        favoritePersistenceRepository.getFriendFavorites(),
        favoritePersistenceRepository.getExplicitLocalFavoriteGroups('friend')
    ]);
    useFavoriteStore.getState().setLocalFavoritesForKind('friend', {
        localFavorites: buildGroupMap<FriendFavoriteRow>(rows, 'userId'),
        localFavoriteGroups: groups
    });
}

async function refreshLocalFavoritesForKind(kind: FavoriteKind): Promise<void> {
    if (kind === 'world') {
        await refreshLocalWorldFavorites();
        return;
    }
    if (kind === 'avatar') {
        await refreshLocalAvatarFavorites();
        return;
    }
    if (kind === 'friend') {
        await refreshLocalFriendFavorites();
    }
}

export async function refreshLocalFavoritesForKinds(
    kinds: Iterable<FavoriteKind>
): Promise<void> {
    const uniqueKinds = Array.from(new Set(kinds));
    await Promise.all(
        uniqueKinds.map((kind) => refreshLocalFavoritesForKind(kind))
    );
}
