import { userImage } from '@/services/entityMediaService';
import { normalizeString } from '@/shared/utils/string';
import { normalizeProfileLanguageRows } from '@/shared/utils/userLanguage';
import { computeTrustLevel } from '@/shared/utils/userTransforms';

import { resolvePlatformMeta } from './playerListDisplay';
import { parseTimeMs, resolvePlayerRowUserId } from './playerListRows';
import type {
    PlayerListContext,
    PlayerListModerationRecord,
    PlayerListProfileRecord,
    PlayerListRecord,
    PlayerListRow,
    PlayerListSourceRow
} from './playerListTypes';

function isRecord(value: unknown): value is PlayerListRecord {
    return Boolean(value && typeof value === 'object');
}

function hasArrayItems(value: unknown) {
    return Array.isArray(value) && value.length > 0;
}

function hasProfileText(value: unknown) {
    return Boolean(normalizeString(value));
}

function hasUsefulProfileFields(
    source: unknown
): source is PlayerListProfileRecord {
    if (!isRecord(source)) {
        return false;
    }

    return Boolean(
        hasProfileText(source.$trustLevel) ||
        hasProfileText(source.$trustClass) ||
        Number(source.$trustSortNum) > 0 ||
        hasArrayItems(source.tags) ||
        hasProfileText(source.developerType) ||
        hasProfileText(source.$platform) ||
        hasProfileText(source.platform) ||
        hasProfileText(source.last_platform) ||
        hasProfileText(source.status) ||
        hasProfileText(source.statusDescription) ||
        hasProfileText(source.profilePicOverrideThumbnail) ||
        hasProfileText(source.profilePicOverride) ||
        hasProfileText(source.thumbnailUrl) ||
        hasProfileText(source.currentAvatarThumbnailImageUrl) ||
        hasProfileText(source.currentAvatarImageUrl) ||
        hasProfileText(source.userIcon) ||
        hasArrayItems(source.$languages) ||
        hasArrayItems(source.languages) ||
        hasArrayItems(source.bioLinks) ||
        hasProfileText(source.note) ||
        hasProfileText(source.memo) ||
        source.$moderations ||
        source.moderations ||
        source.ageVerified === true ||
        hasProfileText(source.ageVerificationStatus) ||
        source.isFriend === true
    );
}

function resolveRowProfile(row: PlayerListSourceRow) {
    const ref = isRecord(row.ref) ? row.ref : null;
    if (hasUsefulProfileFields(ref)) {
        return ref;
    }
    return hasUsefulProfileFields(row) ? row : null;
}

function normalizeUserRef(
    source: unknown,
    fallbackUserId: unknown
): PlayerListProfileRecord | null {
    if (!isRecord(source)) {
        return null;
    }

    const id = normalizeString(source.id || source.userId || fallbackUserId);
    const trust = computeTrustLevel(
        Array.isArray(source.tags)
            ? source.tags.filter(
                  (tag): tag is string => typeof tag === 'string'
              )
            : [],
        normalizeString(source.developerType)
    );
    const hasUpstreamTrust = hasProfileText(source.$trustClass);

    return {
        ...source,
        id: id || source.id,
        $trustLevel: hasUpstreamTrust
            ? normalizeString(source.$trustLevel)
            : trust.trustLevel,
        $trustClass: hasUpstreamTrust
            ? normalizeString(source.$trustClass)
            : trust.trustClass,
        $trustSortNum: hasUpstreamTrust
            ? Number(source.$trustSortNum ?? 0) || 0
            : trust.trustSortNum,
        $isModerator: hasUpstreamTrust
            ? Boolean(source.$isModerator)
            : trust.isModerator,
        $isTroll: hasUpstreamTrust ? Boolean(source.$isTroll) : trust.isTroll,
        $isProbableTroll: hasUpstreamTrust
            ? Boolean(source.$isProbableTroll)
            : trust.isProbableTroll,
        $platform: source.$platform || ''
    };
}

const PROFILE_PRESENCE_REFRESH_FIELDS = [
    'status',
    'statusDescription',
    'state',
    'stateBucket',
    'location',
    '$location',
    '$location_at',
    'locationAt',
    'locationUpdatedAt',
    'worldId',
    'instanceId',
    'travelingToLocation',
    'travelingToWorld',
    'travelingToInstance',
    '$travelingToLocation',
    '$travelingToTime'
];

function hasRefreshValue(value: unknown) {
    return value !== undefined && value !== null && value !== '';
}

function mergePresenceIntoProfile(
    presence: PlayerListProfileRecord | null | undefined,
    profile: PlayerListProfileRecord | null | undefined
): PlayerListProfileRecord | null {
    if (!presence) {
        return profile || null;
    }
    if (!isRecord(profile)) {
        return presence;
    }

    const merged: PlayerListProfileRecord = { ...presence, ...profile };
    for (const field of PROFILE_PRESENCE_REFRESH_FIELDS) {
        if (hasRefreshValue(presence[field])) {
            merged[field] = presence[field];
        }
    }
    return merged;
}

type PlayerListUserRefInput = {
    currentUserSnapshot?: PlayerListProfileRecord | null;
    friend?: PlayerListProfileRecord | null;
    isCurrentUser?: boolean | string;
    knownUser?: PlayerListProfileRecord | null;
    normalizedUserId: string;
    profilesByUserId: Record<
        string,
        PlayerListProfileRecord | null | undefined
    >;
    row: PlayerListSourceRow;
};

function resolveUserRef({
    currentUserSnapshot,
    friend,
    isCurrentUser,
    knownUser,
    normalizedUserId,
    profilesByUserId,
    row
}: PlayerListUserRefInput) {
    if (isCurrentUser) {
        return {
            userRef: normalizeUserRef(currentUserSnapshot, normalizedUserId)
        };
    }

    const fetchedProfile = normalizedUserId
        ? profilesByUserId?.[normalizedUserId]
        : null;
    const knownProfile =
        knownUser && fetchedProfile
            ? { ...knownUser, ...fetchedProfile }
            : fetchedProfile || knownUser;
    if (friend && knownProfile) {
        return {
            userRef: normalizeUserRef(
                mergePresenceIntoProfile(friend, knownProfile),
                normalizedUserId
            )
        };
    }
    if (knownProfile) {
        return {
            userRef: normalizeUserRef(knownProfile, normalizedUserId)
        };
    }
    if (friend) {
        return {
            userRef: normalizeUserRef(friend, normalizedUserId)
        };
    }

    const rowProfile = resolveRowProfile(row);
    return {
        userRef: normalizeUserRef(rowProfile, normalizedUserId)
    };
}

type EnrichPlayerListRowsInput = {
    clockNow: number;
    context: PlayerListContext;
    currentUserId?: unknown;
    currentUserSnapshot?: PlayerListProfileRecord | null;
    favoriteFriendIds: Set<string>;
    friendsById: Record<string, PlayerListProfileRecord | null | undefined>;
    languageOptionsMap?: Parameters<typeof normalizeProfileLanguageRows>[1];
    knownUsersById?: Record<string, PlayerListProfileRecord | null | undefined>;
    moderationByUserId?: Record<
        string,
        PlayerListModerationRecord | null | undefined
    >;
    playerSourceRows: readonly PlayerListSourceRow[];
    profilesByUserId?: Record<
        string,
        PlayerListProfileRecord | null | undefined
    >;
};

export function enrichPlayerListRows({
    clockNow,
    context,
    currentUserId,
    currentUserSnapshot,
    favoriteFriendIds,
    friendsById,
    languageOptionsMap = new Map(),
    knownUsersById = {},
    moderationByUserId = {},
    playerSourceRows,
    profilesByUserId = {}
}: EnrichPlayerListRowsInput): PlayerListRow[] {
    return playerSourceRows.map((row): PlayerListRow => {
        const normalizedUserId = resolvePlayerRowUserId(row);
        const friend = normalizedUserId ? friendsById[normalizedUserId] : null;
        const knownUser = normalizedUserId
            ? knownUsersById[normalizedUserId]
            : null;
        const moderation = normalizedUserId
            ? moderationByUserId[normalizedUserId]
            : null;
        const isCurrentUser =
            normalizedUserId &&
            normalizedUserId === normalizeString(currentUserId);
        const { userRef } = resolveUserRef({
            currentUserSnapshot,
            friend,
            isCurrentUser: Boolean(isCurrentUser),
            knownUser,
            normalizedUserId,
            profilesByUserId,
            row
        });
        const resolvedDisplayName =
            normalizeString(row.displayName) ||
            normalizeString(userRef?.displayName) ||
            normalizeString(userRef?.username) ||
            normalizedUserId ||
            '';
        const trustLevel = normalizeString(userRef?.$trustLevel);
        const trustSortNum = Number(userRef?.$trustSortNum ?? 0) || 0;
        const platform =
            userRef?.$platform ||
            userRef?.platform ||
            userRef?.last_platform ||
            '';
        const platformMeta = resolvePlatformMeta(platform);
        const statusDescription = normalizeString(userRef?.statusDescription);
        const languages = userRef
            ? normalizeProfileLanguageRows(userRef, languageOptionsMap)
            : [];
        const bioLinks = Array.isArray(userRef?.bioLinks)
            ? userRef.bioLinks.filter(Boolean)
            : [];
        const note =
            typeof userRef?.note === 'string'
                ? userRef.note
                : typeof userRef?.memo === 'string'
                  ? userRef.memo
                  : '';
        const isFavorite = normalizedUserId
            ? favoriteFriendIds.has(normalizedUserId)
            : false;
        const isBlocked = Boolean(
            row.isBlocked ||
            userRef?.$moderations?.isBlocked ||
            userRef?.moderations?.isBlocked ||
            moderation?.block
        );
        const isMuted = Boolean(
            row.isMuted ||
            userRef?.$moderations?.isMuted ||
            userRef?.moderations?.isMuted ||
            moderation?.mute
        );
        const isAvatarInteractionDisabled = Boolean(
            userRef?.$moderations?.isAvatarInteractionDisabled ||
            userRef?.moderations?.isAvatarInteractionDisabled ||
            moderation?.isAvatarInteractionDisabled
        );
        const isChatBoxMuted = Boolean(
            row.isChatBoxMuted ||
            userRef?.isChatBoxMuted ||
            userRef?.$moderations?.isChatBoxMuted ||
            userRef?.moderations?.isChatBoxMuted ||
            moderation?.isChatBoxMuted
        );
        const timeoutTime =
            Number(
                row.timeoutTime ??
                    userRef?.timeoutTime ??
                    userRef?.$moderations?.timeoutTime ??
                    userRef?.moderations?.timeoutTime ??
                    moderation?.timeoutTime ??
                    0
            ) || 0;
        const ageVerified = Boolean(
            row.ageVerified ||
            userRef?.ageVerified ||
            row.ageVerificationStatus === '18+' ||
            userRef?.ageVerificationStatus === '18+'
        );
        let moderationSeverity: PlayerListRow['moderationSeverity'] = '';
        if (normalizedUserId) {
            if (isBlocked) {
                moderationSeverity = 'blocked';
            } else if (isMuted) {
                moderationSeverity = 'muted';
            }
        }
        const joinedAtTime = parseTimeMs(row.joinedAt || row.joinedAtMs);
        return {
            ...row,
            displayName: resolvedDisplayName,
            userId: normalizedUserId,
            userRef,
            trustLevel,
            trustSortNum,
            trustClass: normalizeString(userRef?.$trustClass),
            platformLabel: platformMeta.label,
            platformIcon: platformMeta.icon,
            platformClassName: platformMeta.className,
            inVRMode: row.inVRMode,
            status: userRef?.status || '',
            statusDescription,
            languages,
            bioLinks,
            note,
            avatarUrl: userImage(userRef, true),
            isCurrentUser: Boolean(isCurrentUser),
            isFriend: Boolean(friend),
            isFavorite,
            isBlocked,
            isMuted,
            isAvatarInteractionDisabled,
            isChatBoxMuted,
            timeoutTime,
            moderationSeverity,
            ageVerified,
            timerMs:
                joinedAtTime > 0 ? Math.max(clockNow - joinedAtTime, 0) : 0,
            worldName: context.worldName,
            location: context.location
        };
    });
}
