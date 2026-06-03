import { userImage } from '@/services/entityMediaService';
import {
    computeTrustLevel,
    computeUserPlatform
} from '@/shared/utils/userTransforms';
import { normalizeProfileLanguageRows } from '@/shared/utils/userLanguage';

import { resolvePlatformMeta } from './playerListDisplay';
import {
    normalizeString,
    parseTimeMs,
    resolvePlayerRowUserId
} from './playerListRows';

function hasArrayItems(value: any) {
    return Array.isArray(value) && value.length > 0;
}

function hasProfileText(value: any) {
    return Boolean(normalizeString(value));
}

function hasUsefulProfileFields(source: any) {
    if (!source || typeof source !== 'object') {
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

function resolveRowProfile(row: any) {
    const ref = row?.ref && typeof row.ref === 'object' ? row.ref : null;
    if (hasUsefulProfileFields(ref)) {
        return ref;
    }
    return hasUsefulProfileFields(row) ? row : null;
}

function normalizeUserRef(source: any, fallbackUserId: any) {
    if (!source || typeof source !== 'object') {
        return null;
    }

    const tags = Array.isArray(source.tags) ? source.tags : [];
    const canComputeTrust =
        Array.isArray(source.tags) || hasProfileText(source.developerType);
    const trust = canComputeTrust
        ? computeTrustLevel(tags, normalizeString(source.developerType))
        : null;
    const id = normalizeString(source.id || source.userId || fallbackUserId);

    return {
        ...source,
        id: id || source.id,
        $trustLevel: source.$trustLevel || trust?.trustLevel || '',
        $trustClass: source.$trustClass || trust?.trustClass || '',
        $trustSortNum:
            Number(source.$trustSortNum ?? trust?.trustSortNum ?? 0) || 0,
        $isModerator: Boolean(source.$isModerator || trust?.isModerator),
        $isTroll: Boolean(source.$isTroll || trust?.isTroll),
        $isProbableTroll: Boolean(
            source.$isProbableTroll || trust?.isProbableTroll
        ),
        $platform:
            source.$platform ||
            computeUserPlatform(source.platform, source.last_platform)
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

function hasRefreshValue(value: any) {
    return value !== undefined && value !== null && value !== '';
}

function mergePresenceIntoProfile(presence: any, profile: any) {
    if (!presence) {
        return profile || null;
    }
    if (!profile || typeof profile !== 'object') {
        return presence;
    }

    const merged: any = { ...presence, ...profile };
    for (const field of PROFILE_PRESENCE_REFRESH_FIELDS) {
        if (hasRefreshValue(presence[field])) {
            merged[field] = presence[field];
        }
    }
    return merged;
}

function resolveUserRef({
    currentUserSnapshot,
    friend,
    isCurrentUser,
    knownUser,
    normalizedUserId,
    profilesByUserId,
    row
}: any) {
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

export function enrichPlayerListRows({
    clockNow,
    context,
    currentUserId,
    currentUserSnapshot,
    favoriteFriendIds,
    friendsById,
    languageOptionsMap = new Map(),
    knownUsersById = {},
    moderationByUserId,
    playerSourceRows,
    profilesByUserId = {}
}: any) {
    return playerSourceRows.map((row: any) => {
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
            isCurrentUser,
            knownUser,
            normalizedUserId,
            profilesByUserId,
            row
        });
        const resolvedDisplayName =
            row.displayName ||
            userRef?.displayName ||
            userRef?.username ||
            normalizedUserId ||
            '';
        const trustLevel = userRef?.$trustLevel || '';
        const trustSortNum = Number(userRef?.$trustSortNum ?? 0) || 0;
        const platform =
            userRef?.$platform ||
            userRef?.platform ||
            userRef?.last_platform ||
            '';
        const platformMeta = resolvePlatformMeta(platform);
        const statusDescription = userRef?.statusDescription || '';
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
        const moderationTags = normalizedUserId
            ? [
                  isBlocked ? 'blocked' : '',
                  isMuted ? 'muted' : ''
              ].filter(Boolean)
            : [];
        const moderationSeverity =
            moderationTags[0] === 'blocked'
                ? 'blocked'
                : moderationTags[0] === 'muted'
                  ? 'muted'
                  : '';
        const joinedAtTime = parseTimeMs(row.joinedAt || row.joinedAtMs);
        const iconWeight =
            (isCurrentUser ? 1000 : 0) +
            (row.isMaster ? 1000 : 0) +
            (row.isModerator ? 500 : 0) +
            (isFavorite ? 500 : 0) +
            (friend ? 250 : 0) -
            (isBlocked ? 100 : 0) -
            (isMuted ? 50 : 0) -
            (isAvatarInteractionDisabled ? 20 : 0) +
            (isChatBoxMuted ? -10 : 0) +
            (timeoutTime ? -5 : 0) +
            (ageVerified ? 5 : 0);

        return {
            ...row,
            displayName: resolvedDisplayName,
            userId: normalizedUserId,
            userRef,
            trustLevel,
            trustSortNum,
            trustClass: userRef?.$trustClass || '',
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
            moderationTags,
            ageVerified,
            iconWeight,
            timerMs:
                joinedAtTime > 0 ? Math.max(clockNow - joinedAtTime, 0) : 0,
            worldName: context.worldName,
            location: context.location
        };
    });
}
