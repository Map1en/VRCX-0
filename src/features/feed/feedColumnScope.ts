import type {
    FeedColumnConfig,
    FeedColumnFavoriteGroupSelection
} from './feedColumnsState';
import { normalizeFeedId as normalizeId } from './feedRows';

export type FeedFavoriteGroupOption = {
    key: string;
    label: string;
};

export type FeedColumnScopeDescriptionOptions = {
    allFavoritesLabel: string;
    allFriendsLabel: string;
    excludedAllFavoritesLabel?: string;
    excludedGroupCountLabel?(count: number): string;
    groupCountLabel(count: number): string;
    typeLabel(type: string): string;
};

type FeedRemoteFavorite = {
    $groupKey?: unknown;
    favoriteId?: unknown;
    type?: unknown;
};

type FeedFavoriteGroup = {
    displayName?: unknown;
    id?: unknown;
    key?: unknown;
    name?: unknown;
};

function buildFavoriteIdsForGroupSelection({
    groupKeys,
    localFriendFavorites,
    remoteFavoritesById
}: {
    groupKeys: FeedColumnFavoriteGroupSelection;
    localFriendFavorites: Record<string, unknown>;
    remoteFavoritesById: Record<string, FeedRemoteFavorite>;
}) {
    const ids = new Set<string>();
    const allGroups = groupKeys === 'all';
    const selectedGroups = new Set(
        allGroups ? [] : groupKeys.map(normalizeId).filter(Boolean)
    );
    const acceptsRemoteGroup = (groupKey: unknown) => {
        return allGroups || selectedGroups.has(normalizeId(groupKey));
    };
    const acceptsLocalGroup = (groupName: unknown) => {
        const normalizedGroupName = normalizeId(groupName);
        return allGroups || selectedGroups.has(`local:${normalizedGroupName}`);
    };

    for (const favorite of Object.values(remoteFavoritesById || {})) {
        if (
            favorite?.type !== 'friend' ||
            !acceptsRemoteGroup(favorite?.$groupKey)
        ) {
            continue;
        }
        const favoriteId = normalizeId(favorite?.favoriteId);
        if (favoriteId) {
            ids.add(favoriteId);
        }
    }

    for (const [groupName, groupIds] of Object.entries(
        localFriendFavorites || {}
    )) {
        if (!acceptsLocalGroup(groupName)) {
            continue;
        }
        for (const userId of Array.isArray(groupIds) ? groupIds : []) {
            const normalizedId = normalizeId(userId);
            if (normalizedId) {
                ids.add(normalizedId);
            }
        }
    }

    return ids;
}

export function buildFeedColumnFavoriteIds({
    column,
    localFriendFavorites,
    remoteFavoritesById
}: {
    column: FeedColumnConfig;
    localFriendFavorites: Record<string, unknown>;
    remoteFavoritesById: Record<string, FeedRemoteFavorite>;
}) {
    if (column.friendScope.kind !== 'favorites') {
        return new Set<string>();
    }
    return buildFavoriteIdsForGroupSelection({
        groupKeys: column.friendScope.groupKeys,
        localFriendFavorites,
        remoteFavoritesById
    });
}

export function buildFeedColumnExcludedFavoriteIds({
    column,
    localFriendFavorites,
    remoteFavoritesById
}: {
    column: FeedColumnConfig;
    localFriendFavorites: Record<string, unknown>;
    remoteFavoritesById: Record<string, FeedRemoteFavorite>;
}) {
    const excludedGroupKeys = column.friendScope.excludedFavoriteGroupKeys;
    if (
        !excludedGroupKeys ||
        (Array.isArray(excludedGroupKeys) && !excludedGroupKeys.length)
    ) {
        return new Set<string>();
    }
    return buildFavoriteIdsForGroupSelection({
        groupKeys: excludedGroupKeys,
        localFriendFavorites,
        remoteFavoritesById
    });
}

export function buildFeedFavoriteGroupOptions({
    favoriteFriendGroups,
    localFriendFavoriteGroups
}: {
    favoriteFriendGroups: FeedFavoriteGroup[];
    localFriendFavoriteGroups: unknown[];
}): FeedFavoriteGroupOption[] {
    const options = new Map<string, FeedFavoriteGroupOption>();
    for (const group of Array.isArray(favoriteFriendGroups)
        ? favoriteFriendGroups
        : []) {
        const key = normalizeId(group?.key || group?.name || group?.id);
        if (key) {
            options.set(key, {
                key,
                label:
                    normalizeId(group?.displayName || group?.name || key) || key
            });
        }
    }
    for (const groupName of Array.isArray(localFriendFavoriteGroups)
        ? localFriendFavoriteGroups
        : []) {
        const label = normalizeId(groupName);
        if (label) {
            options.set(`local:${label}`, {
                key: `local:${label}`,
                label
            });
        }
    }
    return [...options.values()].sort((left, right) =>
        left.label.localeCompare(right.label)
    );
}

export function describeFeedColumnScope(
    column: FeedColumnConfig,
    options: FeedColumnScopeDescriptionOptions
) {
    const scope =
        column.friendScope.kind === 'favorites'
            ? column.friendScope.groupKeys === 'all'
                ? options.allFavoritesLabel
                : options.groupCountLabel(column.friendScope.groupKeys.length)
            : options.allFriendsLabel;
    const excludedGroupKeys = column.friendScope.excludedFavoriteGroupKeys;
    const exclusion =
        excludedGroupKeys === 'all'
            ? options.excludedAllFavoritesLabel
            : Array.isArray(excludedGroupKeys) && excludedGroupKeys.length
              ? options.excludedGroupCountLabel?.(excludedGroupKeys.length)
              : '';
    return [
        scope,
        exclusion,
        column.feedTypes.map(options.typeLabel).join(', ')
    ]
        .filter(Boolean)
        .join(' · ');
}
