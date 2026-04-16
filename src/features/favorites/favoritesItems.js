import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';

export function normalizeFavoriteSearchValue(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeFavoriteEntityId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

export function resolveCurrentInviteLocation(gameState, currentUserSnapshot) {
    const currentLocation = normalizeFavoriteEntityId(gameState?.currentLocation);
    if (currentLocation === 'traveling') {
        return normalizeFavoriteEntityId(gameState?.currentDestination);
    }

    return (
        currentLocation ||
        normalizeFavoriteEntityId(gameState?.currentDestination) ||
        normalizeFavoriteEntityId(currentUserSnapshot?.$locationTag || currentUserSnapshot?.location)
    );
}

export function sortFavoriteItems(items, sortValue) {
    return [...items].sort((left, right) => {
        if (sortValue === 'players') {
            const playerDelta = (right.playerCount || 0) - (left.playerCount || 0);
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

        const titleDelta = String(left.title || '').localeCompare(String(right.title || ''), undefined, {
            sensitivity: 'base'
        });
        if (titleDelta !== 0) {
            return titleDelta;
        }

        return String(left.id || '').localeCompare(String(right.id || ''));
    });
}

export function shrinkFavoriteImage(url) {
    const normalized = convertFileUrlToImageUrl(url, 128);
    if (typeof normalized !== 'string' || !normalized) {
        return '';
    }
    return normalized.includes('/256') ? normalized.replace('/256', '/128') : normalized;
}

export function favoriteGroupType(kind, group) {
    if (group?.type) {
        return group.type;
    }
    if (kind === 'world') {
        return 'world';
    }
    return kind;
}
