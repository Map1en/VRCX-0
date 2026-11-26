import type { FavoriteKind } from '@/domain/favorites/types';
import type {
    FavoriteBulkRemoveInput,
    FavoriteBulkRemoveResult
} from '@/platform/tauri/bindings';

import type { FavoriteItem } from './favoritesTypes';

export function buildFavoriteBulkRemoveInput({
    items,
    kind
}: {
    items: FavoriteItem[];
    kind: FavoriteKind;
}): FavoriteBulkRemoveInput {
    const batchItems = items.map((item) => {
        if (item.source === 'history') {
            throw new Error(
                'Favorite history entries cannot be removed as favorites.'
            );
        }
        return {
            key: item.key,
            source: item.source,
            entityId: item.id,
            groupId: item.source === 'local' ? Number(item.groupKey) : null
        };
    });
    return {
        kind,
        items: batchItems
    };
}

export function favoriteBulkRemoveSuccessfulKeys(
    result: FavoriteBulkRemoveResult
): Set<string> {
    return new Set(
        result.items
            .filter((item) => item.state === 'removed')
            .map((item) => item.key)
    );
}
