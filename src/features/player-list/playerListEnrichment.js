import { userImage } from '@/lib/entityMedia.js';

import { resolvePlatformMeta } from './playerListDisplay.js';
import { normalizeString, parseTimeMs } from './playerListRows.js';

export function enrichPlayerListRows({
    clockNow,
    context,
    currentUserId,
    currentUserSnapshot,
    favoriteFriendIds,
    friendsById,
    moderationByUserId,
    playerSourceRows
}) {
    return playerSourceRows.map((row) => {
        const normalizedUserId = normalizeString(row.userId);
        const friend = normalizedUserId ? friendsById[normalizedUserId] : null;
        const moderation = normalizedUserId
            ? moderationByUserId[normalizedUserId]
            : null;
        const isCurrentUser =
            normalizedUserId &&
            normalizedUserId === normalizeString(currentUserId);
        const userRef = isCurrentUser
            ? currentUserSnapshot
            : friend || row.ref || null;
        const resolvedDisplayName =
            row.displayName ||
            userRef?.displayName ||
            userRef?.username ||
            normalizedUserId ||
            '';
        const trustLevel = userRef?.$trustLevel || '';
        const trustSortNum =
            Number.parseInt(userRef?.$trustSortNum ?? 0, 10) || 0;
        const platform =
            userRef?.$platform ||
            userRef?.platform ||
            userRef?.last_platform ||
            '';
        const platformMeta = resolvePlatformMeta(platform);
        const statusDescription = userRef?.statusDescription || '';
        const languages = Array.isArray(userRef?.$languages)
            ? userRef.$languages
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
        const isBlocked = Boolean(moderation?.block);
        const isMuted = Boolean(moderation?.mute);
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
        const ageVerified = Boolean(userRef?.ageVerified);
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
            ageVerified,
            iconWeight,
            timerMs:
                joinedAtTime > 0 ? Math.max(clockNow - joinedAtTime, 0) : 0,
            worldName: context.worldName,
            location: context.location
        };
    });
}
