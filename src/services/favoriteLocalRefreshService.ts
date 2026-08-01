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

const refreshSequences: Record<FavoriteKind, number> = {
    friend: 0,
    world: 0,
    avatar: 0
};

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

async function readLocalWorldFavorites() {
    const [rows, groups] = await Promise.all([
        favoritePersistenceRepository.getWorldFavorites(),
        favoritePersistenceRepository.getExplicitLocalFavoriteGroups('world')
    ]);
    return {
        localFavorites: buildGroupMap<WorldFavoriteRow>(rows, 'worldId'),
        localFavoriteGroups: groups
    };
}

async function readLocalAvatarFavorites() {
    const [rows, groups] = await Promise.all([
        favoritePersistenceRepository.getAvatarFavorites(),
        favoritePersistenceRepository.getExplicitLocalFavoriteGroups('avatar')
    ]);
    return {
        localFavorites: buildGroupMap<AvatarFavoriteRow>(rows, 'avatarId'),
        localFavoriteGroups: groups
    };
}

async function readLocalFriendFavorites(currentUserId: string | null) {
    const [rows, groups] = await Promise.all([
        favoritePersistenceRepository.getFriendFavorites(),
        favoritePersistenceRepository.getExplicitLocalFavoriteGroups(
            'friend',
            currentUserId
        )
    ]);
    return {
        localFavorites: buildGroupMap<FriendFavoriteRow>(rows, 'userId'),
        localFavoriteGroups: groups
    };
}

async function refreshLocalFavoritesForKind(kind: FavoriteKind): Promise<void> {
    const sequence = ++refreshSequences[kind];
    const currentUserId = useFavoriteStore.getState().currentUserId;
    const snapshot =
        kind === 'world'
            ? await readLocalWorldFavorites()
            : kind === 'avatar'
              ? await readLocalAvatarFavorites()
              : await readLocalFriendFavorites(currentUserId);
    const store = useFavoriteStore.getState();
    if (
        refreshSequences[kind] === sequence &&
        store.currentUserId === currentUserId
    ) {
        store.setLocalFavoritesForKind(kind, snapshot);
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
