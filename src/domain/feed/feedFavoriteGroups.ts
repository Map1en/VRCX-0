import type {
    FavoriteGroup,
    LocalFavoriteGroup
} from '@/domain/favorites/types';

export type FeedFavoriteGroupOption = {
    key: string;
    label: string;
};

function normalizeFeedId(value: string | undefined) {
    return (value ?? '').trim();
}

export function buildFeedFavoriteGroupOptions({
    favoriteFriendGroups,
    localFriendFavoriteGroups
}: {
    favoriteFriendGroups: readonly FavoriteGroup[];
    localFriendFavoriteGroups: readonly LocalFavoriteGroup[];
}): FeedFavoriteGroupOption[] {
    const options = new Map<string, FeedFavoriteGroupOption>();
    for (const group of favoriteFriendGroups) {
        const key = normalizeFeedId(group.key || group.name);
        if (key) {
            options.set(key, {
                key,
                label:
                    normalizeFeedId(group?.displayName || group?.name || key) ||
                    key
            });
        }
    }
    for (const group of localFriendFavoriteGroups) {
        const key = `local:${group.id}`;
        options.set(key, { key, label: group.name });
    }
    return [...options.values()].sort((left, right) =>
        left.label.localeCompare(right.label)
    );
}
