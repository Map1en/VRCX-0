import {
    groupIdForRow,
    normalizeUserGroupMembershipRows,
    sortUserGroupRows,
    splitUserGroups
} from './userDialogGroupRows';
import {
    filterRows,
    firstArray,
    formatCountText,
    formatStatsDate,
    hydrateMutualFriendRows,
    normalizePreviousDisplayNames,
    normalizedText,
    resolveStatusStateText,
    sortAvatarRows,
    sortMutualFriendRows
} from './userDialogRows';
import {
    normalizeLanguageOptionsFromConfig,
    normalizeProfileLanguageRows
} from './userProfileFields';

function optionalFiniteCount(...values: any[]) {
    for (const value of values) {
        if (value === undefined || value === null || value === '') {
            continue;
        }
        const count = Number(value);
        if (Number.isFinite(count) && count >= 0) {
            return count;
        }
    }
    return undefined;
}

function validTimestampValue(value: any) {
    if (value === undefined || value === null || value === '') {
        return '';
    }
    return validTimestampMs(value) ? value : '';
}

function validTimestampMs(value: any) {
    if (value === undefined || value === null || value === '') {
        return 0;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? value : 0;
    }
    const numericValue = Number(value);
    if (
        typeof value === 'string' &&
        /^\d+$/.test(value.trim()) &&
        Number.isFinite(numericValue) &&
        numericValue > 0
    ) {
        return numericValue;
    }
    const timestamp = Date.parse(String(value));
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isCurrentlyOnline(profile: any) {
    const state = normalizedText(
        profile?.stateBucket || profile?.state
    ).toLowerCase();
    return state === 'online';
}

function estimatedOnlineDuration(profile: any, nowMs: any) {
    if (!isCurrentlyOnline(profile)) {
        return 0;
    }
    const lastLoginMs = validTimestampMs(profile?.last_login);
    const normalizedNowMs = Number(nowMs);
    if (
        !lastLoginMs ||
        !Number.isFinite(normalizedNowMs) ||
        lastLoginMs > normalizedNowMs
    ) {
        return 0;
    }
    return normalizedNowMs - lastLoginMs;
}

function resolvePresenceActivityAt(profile: any) {
    return (
        validTimestampValue(profile?.locationUpdatedAt) ||
        validTimestampValue(profile?.$location_at) ||
        validTimestampValue(profile?.locationAt) ||
        validTimestampValue(profile?.location_at) ||
        validTimestampValue(profile?.statusUpdatedAt) ||
        validTimestampValue(profile?.status_updated_at) ||
        validTimestampValue(profile?.statusAt) ||
        validTimestampValue(profile?.status_at) ||
        validTimestampValue(profile?.$status_at) ||
        validTimestampValue(profile?.statusDescriptionUpdatedAt) ||
        validTimestampValue(profile?.status_description_updated_at) ||
        validTimestampValue(profile?.statusDescriptionAt) ||
        validTimestampValue(profile?.status_description_at) ||
        validTimestampValue(profile?.$status_description_at) ||
        validTimestampValue(profile?.stateUpdatedAt) ||
        validTimestampValue(profile?.state_updated_at) ||
        validTimestampValue(profile?.stateAt) ||
        validTimestampValue(profile?.state_at) ||
        validTimestampValue(profile?.$state_at) ||
        ''
    );
}

function resolveFriendedAt(profile: any) {
    const friendship =
        profile?.friendship && typeof profile.friendship === 'object'
            ? profile.friendship
            : {};
    const relationship =
        profile?.relationship && typeof profile.relationship === 'object'
            ? profile.relationship
            : {};

    return (
        validTimestampValue(profile?.friendedAt) ||
        validTimestampValue(profile?.friended_at) ||
        validTimestampValue(profile?.friendDate) ||
        validTimestampValue(profile?.friend_date) ||
        validTimestampValue(profile?.friendAt) ||
        validTimestampValue(profile?.friend_at) ||
        validTimestampValue(profile?.friendSince) ||
        validTimestampValue(profile?.friend_since) ||
        validTimestampValue(profile?.friendshipCreatedAt) ||
        validTimestampValue(profile?.friendship_created_at) ||
        validTimestampValue(profile?.friendshipDate) ||
        validTimestampValue(profile?.friendship_date) ||
        validTimestampValue(friendship?.createdAt) ||
        validTimestampValue(friendship?.created_at) ||
        validTimestampValue(friendship?.date) ||
        validTimestampValue(relationship?.createdAt) ||
        validTimestampValue(relationship?.created_at) ||
        validTimestampValue(relationship?.date) ||
        ''
    );
}

export function buildUserDialogTabs({
    isCurrentUser,
    currentUserHasSharedConnectionsOptOut,
    t
}: any) {
    const translate = typeof t === 'function' ? t : (key: any) => key;

    return [
        { value: 'info', label: translate('dialog.user.info.header') },
        {
            value: 'instance-history',
            label: translate('dialog.previous_instances.header'),
            hidden: !isCurrentUser
        },
        ...(!isCurrentUser && !currentUserHasSharedConnectionsOptOut
            ? [
                  {
                      value: 'mutual',
                      label: translate('dialog.user.mutual_friends.header')
                  }
              ]
            : []),
        { value: 'groups', label: translate('dialog.user.groups.header') },
        { value: 'worlds', label: translate('dialog.user.worlds.header') },
        ...(!isCurrentUser
            ? [
                  {
                      value: 'favorite-worlds',
                      label: translate('dialog.user.favorite_worlds.header')
                  }
              ]
            : []),
        { value: 'avatars', label: translate('dialog.user.avatars.header') },
        { value: 'activity', label: translate('dialog.user.activity.header') },
        { value: 'json', label: translate('dialog.user.json.header') }
    ];
}

export function buildUserDialogListViewData({
    profile,
    remoteData,
    remoteStatus,
    friendsById,
    search,
    mutualSort,
    groupSort,
    isCurrentUser,
    inGameGroupOrder,
    selectedGroupIds,
    effectiveAvatarReleaseStatus,
    avatarSort,
    currentUserHasSharedConnectionsOptOut,
    t
}: any) {
    const profileGroups = normalizeUserGroupMembershipRows(
        remoteStatus.groups === 'ready'
            ? remoteData.groups
            : firstArray(
                  profile.groups,
                  profile.groupMemberships,
                  profile.$groups
              )
    );
    const mutualFriends = hydrateMutualFriendRows(
        remoteStatus.mutual === 'ready'
            ? remoteData.mutual
            : firstArray(profile.mutualFriends, profile.$mutualFriends),
        friendsById
    );
    const profileWorlds =
        remoteStatus.worlds === 'ready'
            ? remoteData.worlds
            : firstArray(profile.worlds, profile.$worlds, profile.recentWorlds);
    const favoriteWorlds =
        remoteStatus['favorite-worlds'] === 'ready'
            ? remoteData.favoriteWorlds
            : firstArray(profile.favoriteWorlds, profile.$favoriteWorlds);
    const profileAvatars =
        remoteStatus.avatars === 'ready'
            ? remoteData.avatars
            : firstArray(profile.avatars, profile.$avatars);
    const bioLinks = firstArray(profile.bioLinks);
    const filteredMutualFriends = filterRows(mutualFriends, search.mutual);
    const visibleMutualFriends = sortMutualFriendRows(
        filteredMutualFriends,
        mutualSort
    );
    const effectiveGroupSort =
        !isCurrentUser && groupSort === 'inGame' ? 'alphabetical' : groupSort;
    const sortedProfileGroups = sortUserGroupRows(
        profileGroups,
        effectiveGroupSort,
        inGameGroupOrder
    );
    const filteredProfileGroups = filterRows(
        sortedProfileGroups,
        search.groups
    );
    const selectedUserGroups = sortedProfileGroups.filter((group: any) =>
        selectedGroupIds.has(groupIdForRow(group))
    );
    const filteredProfileWorlds = filterRows(profileWorlds, search.worlds);
    const filteredFavoriteWorlds = filterRows(
        favoriteWorlds,
        search.favoriteWorlds
    );
    const filteredProfileAvatars = filterRows(profileAvatars, search.avatars);
    const visibleProfileAvatars = sortAvatarRows(
        effectiveAvatarReleaseStatus === 'all'
            ? filteredProfileAvatars
            : filteredProfileAvatars.filter(
                  (avatar: any) =>
                      avatar.releaseStatus === effectiveAvatarReleaseStatus
              ),
        avatarSort
    );
    const tabs = buildUserDialogTabs({
        isCurrentUser,
        currentUserHasSharedConnectionsOptOut,
        t
    });
    const groupSearchActive = normalizedText(search.groups).length > 0;

    return {
        profileGroups,
        mutualFriends,
        profileWorlds,
        favoriteWorlds,
        profileAvatars,
        bioLinks,
        filteredMutualFriends,
        visibleMutualFriends,
        effectiveGroupSort,
        sortedProfileGroups,
        filteredProfileGroups,
        selectedUserGroups,
        filteredProfileWorlds,
        filteredFavoriteWorlds,
        filteredProfileAvatars,
        visibleProfileAvatars,
        tabs,
        groupSearchActive
    };
}

export function buildUserDialogProfileSummary({
    profile,
    userStats,
    sortedProfileGroups,
    selectedUserGroups,
    isCurrentUser,
    vrchatConfigConstants,
    currentUserSnapshot,
    nowMs
}: any) {
    const previousDisplayNames = normalizePreviousDisplayNames(
        userStats.previousDisplayNames?.length
            ? userStats.previousDisplayNames
            : profile.previousDisplayNames || profile.pastDisplayNames
    );
    const previousDisplayNamesTitle = previousDisplayNames
        .map((entry: any) =>
            entry.updated_at
                ? `${entry.displayName} - ${formatStatsDate(entry.updated_at)}`
                : entry.displayName
        )
        .join('\n');
    const statusStateText = resolveStatusStateText(profile);
    const userGroupSections = splitUserGroups(
        sortedProfileGroups,
        profile.id,
        isCurrentUser
    );
    const selectedGroupCount = selectedUserGroups.length;
    const groupLimits = vrchatConfigConstants?.GROUPS || {};
    const isLocalUserVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
        currentUserSnapshot?.tags?.includes?.('system_supporter') ||
        (globalThis as typeof globalThis & { $debug?: AppDebug })?.$debug
            ?.debugVrcPlus
    );
    const ownGroupCountText = formatCountText(
        userGroupSections.ownGroups.length,
        groupLimits.MAX_OWNED
    );
    const remainingGroupCountText = formatCountText(
        userGroupSections.remainingGroups.length,
        isCurrentUser
            ? isLocalUserVrcPlusSupporter
                ? groupLimits.MAX_JOINED_PLUS
                : groupLimits.MAX_JOINED
            : 0
    );
    const userTimeSpent =
        Number(
            userStats.timeSpent ?? profile.timeSpent ?? profile.$timeSpent ?? 0
        ) || 0;
    const userJoinCount =
        Number(
            userStats.joinCount ?? profile.joinCount ?? profile.$joinCount ?? 0
        ) || 0;
    const lastSeen = userStats.lastSeen || profile.lastSeen || '';
    const languageOptions = normalizeLanguageOptionsFromConfig({
        constants: vrchatConfigConstants
    });
    const languageOptionsMap = new Map(
        languageOptions.map((option: any) => [option.key, option])
    );
    const profileLanguages = normalizeProfileLanguageRows(
        profile,
        languageOptionsMap
    );
    const mutualFriendCount = optionalFiniteCount(
        userStats.mutualFriendCount,
        profile.mutualFriendCount,
        profile.$mutualFriendCount
    );
    const friendNumber =
        Number(profile.$friendNumber ?? profile.friendNumber ?? 0) || 0;
    const estimatedOnlineDurationMs = estimatedOnlineDuration(profile, nowMs);
    const presenceActivityAt = resolvePresenceActivityAt(profile);
    const friendedAt = userStats.friendedAt || resolveFriendedAt(profile);

    return {
        previousDisplayNames,
        previousDisplayNamesTitle,
        statusStateText,
        userGroupSections,
        selectedGroupCount,
        ownGroupCountText,
        remainingGroupCountText,
        userTimeSpent,
        userJoinCount,
        lastSeen,
        profileLanguages,
        mutualFriendCount,
        friendNumber,
        estimatedOnlineDurationMs,
        presenceActivityAt,
        friendedAt
    };
}
