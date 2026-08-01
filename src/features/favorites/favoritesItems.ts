import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
export { resolveCurrentInviteLocation } from '@/shared/utils/invite';

import type { FavoriteKind } from './favoritesTypes';

type SortableFavoriteItem = {
    id?: unknown;
    title?: unknown;
    orderIndex?: number;
    playerCount?: number;
};

export function normalizeFavoriteSearchValue(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeFavoriteEntityId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function sortFavoriteItems<TItem extends SortableFavoriteItem>(
    items: readonly TItem[],
    sortValue: unknown
): TItem[] {
    return [...items].sort((left, right) => {
        if (sortValue === 'players') {
            const playerDelta =
                (right.playerCount || 0) - (left.playerCount || 0);
            if (playerDelta !== 0) {
                return playerDelta;
            }
            return 0;
        }

        if (sortValue === 'date') {
            const orderDelta =
                (left.orderIndex ?? Number.MAX_SAFE_INTEGER) -
                (right.orderIndex ?? Number.MAX_SAFE_INTEGER);
            if (orderDelta !== 0) {
                return orderDelta;
            }
        }

        const titleDelta = String(left.title || '').localeCompare(
            String(right.title || ''),
            undefined,
            {
                sensitivity: 'base'
            }
        );
        if (titleDelta !== 0) {
            return titleDelta;
        }

        return String(left.id || '').localeCompare(String(right.id || ''));
    });
}

export function resolveFavoriteImage(url: unknown): string {
    return typeof url === 'string' ? convertFileUrlToImageUrl(url, 256) : '';
}

export function shrinkFavoriteImage(url: unknown): string {
    if (typeof url !== 'string') {
        return '';
    }
    const normalized = convertFileUrlToImageUrl(url, 128);
    if (!normalized) {
        return '';
    }
    return normalized.includes('/256')
        ? normalized.replace('/256', '/128')
        : normalized;
}

export function favoriteGroupType(
    kind: FavoriteKind,
    group: { type?: unknown }
): string {
    if (typeof group.type === 'string' && group.type) {
        return group.type;
    }
    if (kind === 'world') {
        return 'world';
    }
    return kind;
}
