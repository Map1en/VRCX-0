import type { FavoriteGroupMap, FavoriteKind } from '@/domain/favorites/types';
import {
    commands,
    type LocalFavoriteSnapshot
} from '@/platform/tauri/bindings';
import { useFavoriteStore } from '@/state/favoriteStore';

const refreshSequences: Record<Exclude<FavoriteKind, 'world'>, number> = {
    friend: 0,
    avatar: 0
};

function buildGroupMap(
    snapshot: LocalFavoriteSnapshot,
    kind: Exclude<FavoriteKind, 'world'>
): FavoriteGroupMap {
    const map: FavoriteGroupMap = {};
    for (const group of snapshot.groups) {
        map[String(group.id)] = [];
    }
    for (const row of snapshot.favorites) {
        const entityId = (
            (kind === 'avatar' ? row.avatarId : row.userId) ?? ''
        ).trim();
        const bucket = map[String(row.groupId)];
        if (bucket && entityId && !bucket.includes(entityId)) {
            bucket.unshift(entityId);
        }
    }
    return map;
}

async function refreshLocalFavoritesForKind(
    kind: Exclude<FavoriteKind, 'world'>
): Promise<void> {
    const sequence = ++refreshSequences[kind];
    const currentUserId = useFavoriteStore.getState().currentUserId;
    const snapshot = await commands.appFavoriteLocalSnapshot(kind);
    const store = useFavoriteStore.getState();
    if (
        refreshSequences[kind] === sequence &&
        store.currentUserId === currentUserId
    ) {
        store.setLocalFavoritesForKind(kind, {
            localFavorites: buildGroupMap(snapshot, kind),
            localFavoriteGroups: snapshot.groups
        });
    }
}

export async function refreshLocalFavoritesForKinds(
    kinds: Iterable<FavoriteKind>
): Promise<void> {
    const uniqueKinds = Array.from(new Set(kinds)).filter(
        (kind): kind is Exclude<FavoriteKind, 'world'> => kind !== 'world'
    );
    await Promise.all(
        uniqueKinds.map((kind) => refreshLocalFavoritesForKind(kind))
    );
}
