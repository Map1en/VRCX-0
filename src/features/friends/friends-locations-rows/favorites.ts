import {
    isRecord,
    localized,
    normalizeFriendsLocationId
} from './normalization';
import type {
    FavoriteGroupLabelsByFriendId,
    FavoriteGroupLabelsInput,
    FavoriteGroupSortValue,
    FriendLocationFriend,
    TranslationFn
} from './types';

function appendLabel(
    labelsByFriendId: FavoriteGroupLabelsByFriendId,
    friendId: unknown,
    label: unknown
) {
    const normalizedFriendId = normalizeFriendsLocationId(friendId);
    const normalizedLabel =
        typeof label === 'string' ? label.trim() : String(label ?? '').trim();
    if (!normalizedFriendId || !normalizedLabel) {
        return;
    }

    const labels = labelsByFriendId.get(normalizedFriendId) ?? [];
    if (!labels.includes(normalizedLabel)) {
        labels.push(normalizedLabel);
    }
    labelsByFriendId.set(normalizedFriendId, labels);
}

export function buildFavoriteGroupLabelsByFriendId({
    favoriteFriendGroups,
    groupedFavoriteFriendIdsByGroupKey,
    localFriendFavorites,
    t
}: FavoriteGroupLabelsInput) {
    const labelsByFriendId: FavoriteGroupLabelsByFriendId = new Map();

    for (const group of favoriteFriendGroups ?? []) {
        const groupKey = normalizeFriendsLocationId(group?.key);
        if (!groupKey) {
            continue;
        }

        const label = group.displayName || group.name || groupKey;
        const friendIds = groupedFavoriteFriendIdsByGroupKey?.[groupKey];
        if (Array.isArray(friendIds)) {
            for (const friendId of friendIds) {
                appendLabel(labelsByFriendId, friendId, label);
            }
        }
    }

    for (const [groupName, friendIds] of Object.entries(
        localFriendFavorites ?? {}
    )) {
        if (!Array.isArray(friendIds)) {
            continue;
        }

        const label = localized(
            t,
            'view.friends_locations.local_group',
            'Local: {name}',
            {
                name:
                    groupName ||
                    localized(t, 'view.friends_locations.favorite', 'Favorites')
            }
        );
        for (const friendId of friendIds) {
            appendLabel(labelsByFriendId, friendId, label);
        }
    }

    return labelsByFriendId;
}

export function compareFavoriteGroups(
    left: FavoriteGroupSortValue,
    right: FavoriteGroupSortValue,
    order: string[] = []
) {
    const leftIndex = order.indexOf(left.key);
    const rightIndex = order.indexOf(right.key);
    if (leftIndex >= 0 && rightIndex >= 0) {
        return leftIndex - rightIndex;
    }
    if (leftIndex >= 0) {
        return -1;
    }
    if (rightIndex >= 0) {
        return 1;
    }
    return String(left.label || left.key || '').localeCompare(
        String(right.label || right.key || ''),
        undefined,
        { sensitivity: 'base' }
    );
}

export function resolveFavoriteGroupLabels(
    friend: FriendLocationFriend | null | undefined,
    favoriteGroupLabelsByFriendId: FavoriteGroupLabelsByFriendId,
    favoriteIds: Set<string>,
    t: TranslationFn | null = null
) {
    const friendId = normalizeFriendsLocationId(
        isRecord(friend) ? friend.id : ''
    );
    if (!friendId) {
        return [];
    }

    const labels = favoriteGroupLabelsByFriendId.get(friendId) ?? [];
    if (labels.length > 0) {
        return labels;
    }

    return favoriteIds.has(friendId)
        ? [localized(t, 'view.friends_locations.favorite', 'Favorites')]
        : [];
}
