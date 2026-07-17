import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
export { resolveCurrentInviteLocation } from '@/shared/utils/invite';

export function normalizeFavoriteSearchValue(value: any) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeFavoriteEntityId(value: any) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function sortFavoriteItems(items: any, sortValue: any) {
    return [...items].sort((left: any, right: any) => {
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

export function resolveFavoriteImage(url: unknown) {
    return typeof url === 'string' ? convertFileUrlToImageUrl(url, 256) : '';
}

export function shrinkFavoriteImage(url: unknown) {
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

export function favoriteGroupType(kind: any, group: any) {
    if (group?.type) {
        return group.type;
    }
    if (kind === 'world') {
        return 'world';
    }
    return kind;
}
