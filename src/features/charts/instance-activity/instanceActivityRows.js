import { parseLocation } from '@/shared/utils/locationParser.js';

export function parseLocalDayKey(dayKey) {
    const [year, month, day] = String(dayKey || '')
        .split('-')
        .map((value) => Number.parseInt(value, 10) || 0);
    return new Date(year, Math.max(0, month - 1), day || 1, 0, 0, 0, 0);
}

export function getLocalDayBounds(dayKey) {
    const start = parseLocalDayKey(dayKey);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return {
        start,
        end,
        startMs: start.getTime(),
        endMs: end.getTime()
    };
}

export function isValidActivityLocation(location) {
    const normalizedLocation = String(location ?? '').trim();
    if (!normalizedLocation) {
        return false;
    }
    return !parseLocation(normalizedLocation).isTraveling;
}

export function normalizeInstanceRow(
    row,
    selectedDate,
    currentUserId,
    worldDetailsById
) {
    const safeDuration = Math.max(0, Number(row.time) || 0);
    const leaveMs = new Date(row.created_at).getTime();
    const joinMs = Math.max(0, leaveMs - safeDuration);
    const { startMs, endMs } = getLocalDayBounds(selectedDate);
    const parsedLocation = parseLocation(row.location);
    const worldId = parsedLocation.worldId || '';
    const world = worldId ? worldDetailsById[worldId] : null;
    const worldName = world?.name || '';
    const visibleStartMs = Math.max(joinMs, startMs);
    const visibleEndMs = Math.min(leaveMs, endMs);
    const visibleDurationMs = Math.max(0, visibleEndMs - visibleStartMs);

    return {
        id: String(
            row.id || `${row.location}:${row.created_at}:${row.user_id}`
        ),
        currentUserId,
        displayName: row.display_name || '',
        location: row.location,
        userId: row.user_id || '',
        parsedLocation,
        worldId,
        worldName,
        worldResolvedFromCache: Boolean(world?.name),
        joinMs,
        leaveMs,
        visibleStartMs,
        visibleDurationMs
    };
}

export function getActivityDetailKey(location, joinMs) {
    return `${location || ''}:${Number.isFinite(joinMs) ? joinMs : 0}`;
}

export function getDetailGroupKeys(group, currentUserId) {
    const currentUserEntries = group.filter(
        (entry) => entry.userId === currentUserId
    );
    const entries = currentUserEntries.length ? currentUserEntries : [group[0]];
    return entries.map((entry) =>
        getActivityDetailKey(entry?.location, entry?.joinMs)
    );
}

export function buildChartRows(
    rawRows,
    selectedDate,
    currentUserId,
    worldDetailsById
) {
    return rawRows
        .filter((row) => row.user_id === currentUserId)
        .filter((row) => isValidActivityLocation(row.location))
        .map((row) =>
            normalizeInstanceRow(
                row,
                selectedDate,
                currentUserId,
                worldDetailsById
            )
        )
        .sort((left, right) => left.joinMs - right.joinMs);
}

export function normalizeDetailRow(
    row,
    currentUserId,
    friendIdSet,
    favoriteIdSet
) {
    const durationMs = Math.max(0, Number(row.time) || 0);
    const leaveMs = new Date(row.created_at).getTime();
    const joinMs = Math.max(0, leaveMs - durationMs);
    const userId = row.user_id || '';

    return {
        ...row,
        id: String(row.id || `${row.location}:${row.created_at}:${userId}`),
        displayName: row.display_name || '',
        userId,
        joinMs,
        leaveMs,
        durationMs,
        isCurrentUser: userId === currentUserId,
        isFriend:
            userId === currentUserId
                ? false
                : friendIdSet.has(userId) || favoriteIdSet.has(userId),
        isFavorite: userId === currentUserId ? false : favoriteIdSet.has(userId)
    };
}

export function doIntervalsOverlap(left, right) {
    return !(left.leaveMs < right.joinMs || right.leaveMs < left.joinMs);
}

export function splitDetailGroupsByCurrentUserOverlap(groups, currentUserId) {
    const result = [];

    for (const group of groups) {
        const currentUserCount = group.filter(
            (entry) => entry.userId === currentUserId
        ).length;
        if (currentUserCount <= 1) {
            result.push(group);
            continue;
        }

        const adjacency = Array.from({ length: group.length }, () => []);
        for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
            for (
                let rightIndex = leftIndex + 1;
                rightIndex < group.length;
                rightIndex += 1
            ) {
                if (doIntervalsOverlap(group[leftIndex], group[rightIndex])) {
                    adjacency[leftIndex].push(rightIndex);
                    adjacency[rightIndex].push(leftIndex);
                }
            }
        }

        const visited = new Set();
        for (let index = 0; index < group.length; index += 1) {
            if (visited.has(index)) {
                continue;
            }

            const stack = [index];
            const component = [];
            visited.add(index);
            while (stack.length) {
                const current = stack.pop();
                component.push(group[current]);
                for (const next of adjacency[current]) {
                    if (!visited.has(next)) {
                        visited.add(next);
                        stack.push(next);
                    }
                }
            }
            result.push(
                component.sort((left, right) => left.joinMs - right.joinMs)
            );
        }
    }

    return result.sort(
        (left, right) => (left[0]?.joinMs || 0) - (right[0]?.joinMs || 0)
    );
}

export function buildDetailGroups(
    rawRows,
    chartRows,
    currentUserId,
    friendIdSet,
    favoriteIdSet
) {
    const currentLocations = new Set(
        chartRows.map((row) => row.location).filter(Boolean)
    );
    if (!currentUserId || !currentLocations.size) {
        return [];
    }

    const groupsByLocation = new Map();
    for (const row of rawRows) {
        if (!currentLocations.has(row.location)) {
            continue;
        }

        const entry = normalizeDetailRow(
            row,
            currentUserId,
            friendIdSet,
            favoriteIdSet
        );
        const existing = groupsByLocation.get(entry.location) || [];
        existing.push(entry);
        groupsByLocation.set(entry.location, existing);
    }

    const groups = Array.from(groupsByLocation.values())
        .map((group) =>
            group.sort((left, right) => {
                const joinDiff = Math.abs(left.joinMs - right.joinMs);
                return joinDiff < 3000
                    ? left.leaveMs - right.leaveMs
                    : left.joinMs - right.joinMs;
            })
        )
        .filter((group) =>
            group.some((entry) => entry.userId === currentUserId)
        );

    return splitDetailGroupsByCurrentUserOverlap(groups, currentUserId);
}

export function filterDetailGroups(
    groups,
    { isDetailVisible, isSoloInstanceVisible, isNoFriendInstanceVisible }
) {
    if (!isDetailVisible) {
        return [];
    }

    return groups.filter((group) => {
        if (!isSoloInstanceVisible && group.length <= 1) {
            return false;
        }

        if (
            !isNoFriendInstanceVisible &&
            group.length > 1 &&
            !group.some((entry) => entry.isFriend)
        ) {
            return false;
        }

        return true;
    });
}
