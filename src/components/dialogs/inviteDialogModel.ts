import { normalizeString as normalizeId } from '@/shared/utils/string';

export function onlineFriendIdsFromGroup(userIds: any, friendsById: any) {
    return (Array.isArray(userIds) ? userIds : [])
        .map(normalizeId)
        .filter((userId: any, index: any, source: any) => {
            const friend = friendsById[userId];
            return (
                userId &&
                source.indexOf(userId) === index &&
                (friend?.stateBucket === 'online' || friend?.state === 'online')
            );
        });
}

export function displayNameForUser(
    userId: any,
    friendsById: any,
    currentUser: any
) {
    if (currentUser?.id === userId) {
        return currentUser.displayName || currentUser.username || userId;
    }
    const friend = friendsById[userId];
    const ref =
        friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
    return ref?.displayName || ref?.username || friend?.name || userId;
}

export function pushUniqueLabel(labels: string[], label: unknown) {
    const normalizedLabel = normalizeId(label);
    if (normalizedLabel && !labels.includes(normalizedLabel)) {
        labels.push(normalizedLabel);
    }
}

export function filterInviteUserIds({
    selectableUserIds,
    search,
    friendsById,
    currentUser
}: any) {
    const query = search.trim().toLowerCase();
    if (!query) {
        return selectableUserIds;
    }
    return selectableUserIds.filter((userId: any) => {
        const displayName = displayNameForUser(
            userId,
            friendsById,
            currentUser
        );
        return (
            userId.toLowerCase().includes(query) ||
            displayName.toLowerCase().includes(query)
        );
    });
}

export function sortInviteUserIdsWithSelectedFirst(
    filteredUserIds: any,
    selectedUserIdSet: any
) {
    return [...filteredUserIds].sort((left: any, right: any) => {
        const leftSelected = selectedUserIdSet.has(normalizeId(left));
        const rightSelected = selectedUserIdSet.has(normalizeId(right));
        if (leftSelected !== rightSelected) {
            return leftSelected ? -1 : 1;
        }
        return 0;
    });
}

export function buildFavoriteGroupLabelsByUserId({
    favoriteFriendGroups,
    groupedFavoriteFriendIdsByGroupKey,
    localFriendFavoriteGroups,
    localFriendFavorites
}: any) {
    const labelsByUserId: Record<string, string[]> = {};
    function addLabel(userId: unknown, label: unknown) {
        const normalizedUserId = normalizeId(userId);
        if (!normalizedUserId) {
            return;
        }
        if (!labelsByUserId[normalizedUserId]) {
            labelsByUserId[normalizedUserId] = [];
        }
        pushUniqueLabel(labelsByUserId[normalizedUserId], label);
    }

    for (const group of Array.isArray(favoriteFriendGroups)
        ? favoriteFriendGroups
        : []) {
        const key = normalizeId(group?.key);
        const label = group?.displayName || key;
        for (const userId of Array.isArray(
            groupedFavoriteFriendIdsByGroupKey?.[key]
        )
            ? groupedFavoriteFriendIdsByGroupKey[key]
            : []) {
            addLabel(userId, label);
        }
    }

    for (const groupName of Array.isArray(localFriendFavoriteGroups)
        ? localFriendFavoriteGroups
        : Object.keys(localFriendFavorites || {})) {
        const key = normalizeId(groupName);
        for (const userId of Array.isArray(localFriendFavorites?.[key])
            ? localFriendFavorites[key]
            : []) {
            addLabel(userId, key);
        }
    }

    return labelsByUserId;
}

export function buildFriendsInCurrentInstanceIds({
    currentLocationPlayerIds,
    friendsById
}: any) {
    const ids = new Set(
        (Array.isArray(currentLocationPlayerIds)
            ? currentLocationPlayerIds
            : []
        ).map(normalizeId)
    );
    return [...ids].filter((userId: any) => userId && friendsById[userId]);
}

export function buildFavoriteGroupItems({
    favoriteFriendGroups,
    groupedFavoriteFriendIdsByGroupKey,
    localFriendFavoriteGroups,
    localFriendFavorites,
    friendsById
}: any) {
    const remote = (
        Array.isArray(favoriteFriendGroups) ? favoriteFriendGroups : []
    )
        .map((group: any) => {
            const key = normalizeId(group?.key);
            const userIds = onlineFriendIdsFromGroup(
                groupedFavoriteFriendIdsByGroupKey?.[key],
                friendsById
            );
            return {
                key: `remote:${key}`,
                label: group?.displayName || key,
                userIds
            };
        })
        .filter((group: any) => group.key && group.userIds.length);

    const local = (
        Array.isArray(localFriendFavoriteGroups)
            ? localFriendFavoriteGroups
            : []
    )
        .map((groupName: any) => {
            const key = normalizeId(groupName);
            const userIds = onlineFriendIdsFromGroup(
                localFriendFavorites?.[key],
                friendsById
            );
            return {
                key: `local:${key}`,
                label: key,
                userIds
            };
        })
        .filter((group: any) => group.key && group.userIds.length);

    return { remote, local };
}
