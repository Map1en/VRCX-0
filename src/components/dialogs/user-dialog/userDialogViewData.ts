import { presenceOf, presenceOnlineForMs } from '@/domain/friends/presence';
import { normalizeUserRelationshipHistory } from '@/services/userDialogSessionCacheService';

import {
    normalizeUserGroupMembershipRows,
    sortUserGroupRows,
    splitUserGroups
} from './userDialogGroupRows';
import type {
    UserDialogAvatarReleaseStatus,
    UserDialogAvatarSort,
    UserDialogGroupSort,
    UserDialogMutualFriendSort
} from './userDialogListOptions';
import {
    filterRows,
    firstArray,
    formatCountText,
    formatStatsDate,
    hydrateMutualFriendRows,
    mergePreviousDisplayNames,
    normalizedText,
    resolveStatusStateText,
    sortAvatarRows,
    sortMutualFriendRows
} from './userDialogRows';
import type { UserDialogRemoteStatus } from './userDialogTabService';
import {
    normalizeLanguageOptionsFromConfig,
    normalizeProfileLanguageRows
} from './userProfileFields';

type DialogRecord = Record<string, unknown>;
type DialogRow = DialogRecord & {
    id?: string;
    name?: string;
    displayName?: string;
    releaseStatus?: string;
};
type Translate = (key: string) => string;

function record(value: unknown): DialogRecord {
    return value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

function rows(value: unknown): DialogRow[] {
    return Array.isArray(value) ? value.map(record) : [];
}

function optionalFiniteCount(...values: unknown[]) {
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

function validTimestampValue(value: unknown) {
    if (value === undefined || value === null || value === '') {
        return '';
    }
    return validTimestampMs(value) ? normalizedText(value) : '';
}

function validTimestampMs(value: unknown) {
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

function estimatedOnlineDuration(profile: DialogRecord, nowMs?: number) {
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
        return 0;
    }
    return presenceOnlineForMs(presenceOf(profile), nowMs);
}

function resolveFriendedAt(profile: DialogRecord) {
    const friendship = record(profile.friendship);
    const relationship = record(profile.relationship);

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
}: {
    isCurrentUser: boolean;
    currentUserHasSharedConnectionsOptOut: boolean;
    t?: Translate;
}) {
    const translate = typeof t === 'function' ? t : (key: string) => key;

    return [
        { value: 'info', label: translate('dialog.user.info.header') },
        {
            value: 'instance-history',
            label: translate('dialog.previous_instances.header'),
            hidden: !isCurrentUser
        },
        ...(!isCurrentUser
            ? [
                  {
                      value: 'feed',
                      label: translate('nav_tooltip.feed'),
                      hidden: true
                  }
              ]
            : []),
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
        ...(!isCurrentUser
            ? [
                  {
                      value: 'activity',
                      label: translate('dialog.user.activity.header')
                  }
              ]
            : []),
        { value: 'json', label: translate('dialog.user.json.header') }
    ];
}

export function buildUserDialogListViewData({
    profile,
    remoteData,
    remoteStatus,
    loadedTabs,
    friendsById,
    search,
    mutualSort,
    groupSort,
    isCurrentUser,
    inGameGroupOrder,
    effectiveAvatarReleaseStatus,
    avatarSort,
    currentUserHasSharedConnectionsOptOut,
    t
}: {
    profile: DialogRecord;
    remoteData: DialogRecord;
    remoteStatus: UserDialogRemoteStatus;
    loadedTabs: Partial<Record<keyof UserDialogRemoteStatus, boolean>>;
    friendsById?: Record<string, DialogRecord> | null;
    search: Record<string, string>;
    mutualSort: UserDialogMutualFriendSort;
    groupSort: UserDialogGroupSort;
    isCurrentUser: boolean;
    inGameGroupOrder: readonly string[];
    effectiveAvatarReleaseStatus: UserDialogAvatarReleaseStatus;
    avatarSort: UserDialogAvatarSort;
    currentUserHasSharedConnectionsOptOut: boolean;
    t?: Translate;
}) {
    const normalizedGroupOrder = inGameGroupOrder
        .map((groupId) => groupId.trim())
        .filter(Boolean);
    const profileGroups = normalizeUserGroupMembershipRows(
        remoteStatus.groups === 'ready' || loadedTabs.groups
            ? remoteData.groups
            : firstArray(
                  profile.groups,
                  profile.groupMemberships,
                  profile.$groups
              )
    );
    const mutualFriends = hydrateMutualFriendRows(
        rows(
            remoteStatus.mutual === 'ready' || loadedTabs.mutual
                ? remoteData.mutual
                : firstArray(profile.mutualFriends, profile.$mutualFriends)
        ),
        friendsById
    );
    const profileWorlds = rows(
        remoteStatus.worlds === 'ready' || loadedTabs.worlds
            ? remoteData.worlds
            : firstArray(profile.worlds, profile.$worlds, profile.recentWorlds)
    );
    const favoriteWorlds = rows(
        remoteStatus['favorite-worlds'] === 'ready' ||
            loadedTabs['favorite-worlds']
            ? remoteData.favoriteWorlds
            : firstArray(profile.favoriteWorlds, profile.$favoriteWorlds)
    );
    const profileAvatars = rows(
        remoteStatus.avatars === 'ready' || loadedTabs.avatars
            ? remoteData.avatars
            : firstArray(profile.avatars, profile.$avatars)
    );
    const bioLinks = firstArray(profile.bioLinks)
        .map(normalizedText)
        .filter(Boolean);
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
        normalizedGroupOrder
    );
    const filteredProfileGroups = filterRows(
        sortedProfileGroups,
        search.groups
    );
    const filteredProfileWorlds = filterRows(profileWorlds, search.worlds);
    const filteredFavoriteWorlds = filterRows(
        favoriteWorlds,
        search.favoriteWorlds
    );
    const filteredProfileAvatars = filterRows(profileAvatars, search.avatars);
    const visibleProfileAvatars = sortAvatarRows(
        effectiveAvatarReleaseStatus === 'all' ||
            effectiveAvatarReleaseStatus === 'licensed'
            ? filteredProfileAvatars
            : filteredProfileAvatars.filter(
                  (avatar) =>
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
    isCurrentUser,
    vrchatConfigConstants,
    currentUserSnapshot,
    nowMs
}: {
    profile: DialogRecord;
    userStats: DialogRecord;
    sortedProfileGroups: ReturnType<typeof normalizeUserGroupMembershipRows>;
    isCurrentUser: boolean;
    vrchatConfigConstants: unknown;
    currentUserSnapshot: DialogRecord | null;
    nowMs?: number;
} & DialogRecord) {
    const statsPreviousDisplayNames = Array.isArray(
        userStats.previousDisplayNames
    )
        ? userStats.previousDisplayNames
        : [];
    const previousDisplayNames = mergePreviousDisplayNames(
        profile.displayName || profile.username,
        profile.previousDisplayNames,
        profile.pastDisplayNames,
        isCurrentUser ? currentUserSnapshot?.pastDisplayNames : null,
        statsPreviousDisplayNames
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
        normalizedText(profile.id),
        isCurrentUser
    );
    const groupLimits = record(record(vrchatConfigConstants).GROUPS);
    const currentUserTags = Array.isArray(currentUserSnapshot?.tags)
        ? currentUserSnapshot.tags
        : [];
    const isLocalUserVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
        currentUserTags.includes('system_supporter') ||
        globalThis.$debug?.debugVrcPlus
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
    const lastSeen = normalizedText(userStats.lastSeen || profile.lastSeen);
    const languageOptions = normalizeLanguageOptionsFromConfig({
        constants: vrchatConfigConstants
    });
    const languageOptionsMap = new Map(
        languageOptions.map((option) => [option.key, option])
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
    const presenceActivityAt = validTimestampValue(profile?.last_activity);
    const friendedAt = normalizedText(
        userStats.friendedAt || resolveFriendedAt(profile)
    );

    return {
        previousDisplayNames,
        previousDisplayNamesTitle,
        statusStateText,
        userGroupSections,
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
        friendedAt,
        relationshipHistory: normalizeUserRelationshipHistory(
            userStats.relationshipHistory
        )
    };
}
