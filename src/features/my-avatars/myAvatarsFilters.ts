import { getAvailablePlatforms } from '@/shared/utils/avatarPlatform';

export function toggleMyAvatarsTagFilter(currentTags: any, tag: any) {
    const next = new Set(currentTags);
    if (next.has(tag)) {
        next.delete(tag);
    } else {
        next.add(tag);
    }
    return next;
}

export function collectMyAvatarTags(avatars: any) {
    const tagSet = new Set();
    for (const avatar of avatars) {
        for (const entry of avatar?.$tags || []) {
            if (entry?.tag) {
                tagSet.add(entry.tag);
            }
        }
    }
    return Array.from(tagSet).sort((left: any, right: any) =>
        left.localeCompare(right)
    );
}

export function matchesMyAvatarsPlatformFilter(
    avatar: any,
    platformFilter: any
) {
    if (platformFilter === 'all') {
        return true;
    }

    const platforms = getAvailablePlatforms(avatar?.unityPackages);
    return (
        Boolean(platforms?.isPC && platformFilter === 'pc') ||
        Boolean(platforms?.isQuest && platformFilter === 'android') ||
        Boolean(platforms?.isIos && platformFilter === 'ios')
    );
}

export function filterMyAvatars({
    avatars,
    searchQuery,
    platformFilter,
    releaseStatusFilter,
    tagFilters
}: any) {
    const searchValue = String(searchQuery || '')
        .trim()
        .toLowerCase();
    const selectedTags = tagFilters instanceof Set ? tagFilters : new Set();

    return (Array.isArray(avatars) ? avatars : []).filter((avatar: any) => {
        if (
            releaseStatusFilter !== 'all' &&
            avatar?.releaseStatus !== releaseStatusFilter
        ) {
            return false;
        }

        if (!matchesMyAvatarsPlatformFilter(avatar, platformFilter)) {
            return false;
        }

        if (selectedTags.size > 0) {
            const avatarTags = new Set(
                (avatar?.$tags || []).map((entry: any) => entry.tag)
            );
            if (![...selectedTags].some((tag: any) => avatarTags.has(tag))) {
                return false;
            }
        }

        if (!searchValue) {
            return true;
        }

        return (
            String(avatar?.name || '')
                .toLowerCase()
                .includes(searchValue) ||
            String(avatar?.description || '')
                .toLowerCase()
                .includes(searchValue) ||
            (avatar?.$tags || []).some((entry: any) =>
                String(entry?.tag || '')
                    .toLowerCase()
                    .includes(searchValue)
            )
        );
    });
}
