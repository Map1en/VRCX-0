import type {
    FavoriteGroup,
    FavoriteGroupMap,
    LocalFavoriteGroup
} from '@/domain/favorites/types';
import { presenceSection } from '@/domain/friends/presence';
import type {
    FriendRecordInput,
    FriendRosterInputById
} from '@/domain/friends/types';
import { normalizeString as normalizeId } from '@/shared/utils/string';

type InviteCurrentUser = FriendRecordInput | null | undefined;

type InviteFavoriteInputs = {
    favoriteFriendGroups?: readonly FavoriteGroup[];
    groupedFavoriteFriendIdsByGroupKey?: Record<string, string[]> | null;
    localFriendFavoriteGroups?: readonly LocalFavoriteGroup[];
    localFriendFavorites?: FavoriteGroupMap | null;
};

export function onlineFriendIdsFromGroup(
    userIds: readonly string[] | null | undefined,
    friendsById: FriendRosterInputById
) {
    return (userIds ?? []).map(normalizeId).filter((userId, index, source) => {
        const friend = friendsById[userId];
        return (
            userId &&
            source.indexOf(userId) === index &&
            friend?.$presence !== undefined &&
            presenceSection(friend.$presence) === 'online'
        );
    });
}

export function displayNameForUser(
    userId: string,
    friendsById: FriendRosterInputById,
    currentUser: InviteCurrentUser
) {
    if (normalizeId(currentUser?.id) === userId) {
        return (
            normalizeId(currentUser?.displayName) ||
            normalizeId(currentUser?.username) ||
            userId
        );
    }
    const friend = friendsById[userId];
    return (
        normalizeId(friend?.displayName) ||
        normalizeId(friend?.username) ||
        normalizeId(friend?.name) ||
        userId
    );
}

export function pushUniqueLabel(labels: string[], label: string) {
    const normalizedLabel = normalizeId(label);
    if (normalizedLabel && !labels.includes(normalizedLabel)) {
        labels.push(normalizedLabel);
    }
}

export function buildFavoriteGroupLabelsByUserId({
    favoriteFriendGroups,
    groupedFavoriteFriendIdsByGroupKey,
    localFriendFavoriteGroups,
    localFriendFavorites
}: InviteFavoriteInputs) {
    const labelsByUserId: Record<string, string[]> = {};
    function addLabel(userId: string, label: string) {
        const normalizedUserId = normalizeId(userId);
        if (!normalizedUserId) {
            return;
        }
        if (!labelsByUserId[normalizedUserId]) {
            labelsByUserId[normalizedUserId] = [];
        }
        pushUniqueLabel(labelsByUserId[normalizedUserId], label);
    }

    for (const group of favoriteFriendGroups ?? []) {
        const key = normalizeId(group.key);
        const label = normalizeId(group.displayName) || key;
        for (const userId of groupedFavoriteFriendIdsByGroupKey?.[key] ?? []) {
            addLabel(userId, label);
        }
    }

    for (const group of localFriendFavoriteGroups ?? []) {
        for (const userId of localFriendFavorites?.[String(group.id)] ?? []) {
            addLabel(userId, group.name);
        }
    }

    return labelsByUserId;
}

export function buildFriendsInCurrentInstanceIds({
    currentLocationPlayerIds,
    friendsById
}: {
    currentLocationPlayerIds: readonly string[];
    friendsById: FriendRosterInputById;
}) {
    const ids = new Set(currentLocationPlayerIds.map(normalizeId));
    return [...ids].filter((userId) => userId && friendsById[userId]);
}

export function buildFavoriteGroupItems({
    favoriteFriendGroups,
    groupedFavoriteFriendIdsByGroupKey,
    localFriendFavoriteGroups,
    localFriendFavorites,
    friendsById
}: InviteFavoriteInputs & { friendsById: FriendRosterInputById }) {
    const remote = (favoriteFriendGroups ?? [])
        .map((group) => {
            const key = normalizeId(group.key);
            const userIds = onlineFriendIdsFromGroup(
                groupedFavoriteFriendIdsByGroupKey?.[key],
                friendsById
            );
            return {
                key: `remote:${key}`,
                label: normalizeId(group.displayName) || key,
                userIds
            };
        })
        .filter((group) => group.key && group.userIds.length);

    const local = (localFriendFavoriteGroups ?? [])
        .map((group) => ({
            key: `local:${group.id}`,
            label: group.name,
            userIds: onlineFriendIdsFromGroup(
                localFriendFavorites?.[String(group.id)],
                friendsById
            )
        }))
        .filter((group) => group.key && group.userIds.length);

    return { remote, local };
}
