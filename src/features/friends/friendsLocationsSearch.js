import {
    normalizeFriendsLocationId,
    resolveLocationSummary
} from './friendsLocationsRows.js';

export function buildFriendsLocationsFavoriteIdSet(
    remoteFavoriteIds,
    localFriendFavorites
) {
    const ids = new Set();

    for (const id of remoteFavoriteIds ?? []) {
        const normalized = normalizeFriendsLocationId(id);
        if (normalized) {
            ids.add(normalized);
        }
    }

    for (const groupIds of Object.values(localFriendFavorites ?? {})) {
        if (!Array.isArray(groupIds)) {
            continue;
        }

        for (const id of groupIds) {
            const normalized = normalizeFriendsLocationId(id);
            if (normalized) {
                ids.add(normalized);
            }
        }
    }

    return ids;
}

export function matchesFriendLocationSearch(friend, searchQuery, favoriteIds) {
    if (!searchQuery) {
        return true;
    }

    const location = resolveLocationSummary(friend);
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
        return true;
    }

    return (
        String(friend?.displayName || '')
            .toLowerCase()
            .includes(query) ||
        String(friend?.username || '')
            .toLowerCase()
            .includes(query) ||
        String(friend?.statusDescription || '')
            .toLowerCase()
            .includes(query) ||
        String(friend?.worldId || '')
            .toLowerCase()
            .includes(query) ||
        String(friend?.location || '')
            .toLowerCase()
            .includes(query) ||
        String(location.label || '')
            .toLowerCase()
            .includes(query) ||
        String(location.meta || '')
            .toLowerCase()
            .includes(query) ||
        (query === 'favorite' &&
            favoriteIds.has(normalizeFriendsLocationId(friend?.id)))
    );
}
