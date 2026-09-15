import { normalizeString } from '@/shared/utils/string';

import type { FavoriteGroupMap } from './types';

export function buildFavoriteIdSet(
    remoteFavoriteIds: Iterable<string> | null | undefined,
    localFriendFavorites: FavoriteGroupMap | null | undefined
): Set<string> {
    const ids = new Set<string>();

    for (const id of remoteFavoriteIds ?? []) {
        const normalized = normalizeString(id);
        if (normalized) {
            ids.add(normalized);
        }
    }

    for (const groupIds of Object.values(localFriendFavorites ?? {})) {
        for (const id of groupIds) {
            const normalized = normalizeString(id);
            if (normalized) {
                ids.add(normalized);
            }
        }
    }

    return ids;
}
