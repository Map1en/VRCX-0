export type FeedFavoriteGroupOption = {
    key: string;
    label: string;
};

type FeedFavoriteGroup = {
    displayName?: unknown;
    id?: unknown;
    key?: unknown;
    name?: unknown;
};

function normalizeFeedId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
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
        const key = normalizeFeedId(group?.key || group?.name || group?.id);
        if (key) {
            options.set(key, {
                key,
                label:
                    normalizeFeedId(group?.displayName || group?.name || key) ||
                    key
            });
        }
    }
    for (const groupName of Array.isArray(localFriendFavoriteGroups)
        ? localFriendFavoriteGroups
        : []) {
        const label = normalizeFeedId(groupName);
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
