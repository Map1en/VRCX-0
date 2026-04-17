import {
    filterRows,
    firstArray,
    formatCountText,
    formatStatsDate,
    groupIdForRow,
    hydrateMutualFriendRows,
    normalizePreviousDisplayNames,
    normalizeUserGroupMembershipRows,
    normalizedText,
    resolveStatusStateText,
    sortAvatarRows,
    sortMutualFriendRows,
    sortUserGroupRows,
    splitUserGroups
} from './userDialogRows.js';
import {
    normalizeLanguageOptionsFromConfig,
    normalizeProfileLanguageRows
} from './userProfileFields.js';

export function buildUserDialogTabs({
    isCurrentUser,
    currentUserHasSharedConnectionsOptOut
}) {
    return [
        { value: 'info', label: 'Info' },
        ...(!isCurrentUser && !currentUserHasSharedConnectionsOptOut
            ? [{ value: 'mutual', label: 'Mutual' }]
            : []),
        { value: 'groups', label: 'Groups' },
        { value: 'worlds', label: 'Worlds' },
        ...(!isCurrentUser
            ? [
                  { value: 'favorite-worlds', label: 'Favorite Worlds' },
                  { value: 'avatars', label: 'Avatars' }
              ]
            : []),
        { value: 'activity', label: 'Activity' },
        { value: 'json', label: 'JSON' }
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
    currentUserHasSharedConnectionsOptOut
}) {
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
    const selectedUserGroups = sortedProfileGroups.filter((group) =>
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
                  (avatar) =>
                      avatar.releaseStatus === effectiveAvatarReleaseStatus
              ),
        avatarSort
    );
    const tabs = buildUserDialogTabs({
        isCurrentUser,
        currentUserHasSharedConnectionsOptOut
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
    mutualFriends,
    isCurrentUser,
    vrchatConfigConstants,
    currentUserSnapshot
}) {
    const previousDisplayNames = normalizePreviousDisplayNames(
        userStats.previousDisplayNames?.length
            ? userStats.previousDisplayNames
            : profile.previousDisplayNames || profile.pastDisplayNames
    );
    const previousDisplayNamesTitle = previousDisplayNames
        .map((entry) =>
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
        globalThis?.$debug?.debugVrcPlus
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
    const languageOptions = normalizeLanguageOptionsFromConfig(
        { constants: vrchatConfigConstants }
    );
    const languageOptionsMap = new Map(
        languageOptions.map((option) => [option.key, option])
    );
    const profileLanguages = normalizeProfileLanguageRows(
        profile,
        languageOptionsMap
    );
    const mutualFriendCount =
        Number(
            profile.mutualFriendCount ??
                profile.$mutualFriendCount ??
                mutualFriends.length ??
                0
        ) || 0;
    const friendNumber =
        Number(profile.$friendNumber ?? profile.friendNumber ?? 0) || 0;

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
        friendNumber
    };
}
