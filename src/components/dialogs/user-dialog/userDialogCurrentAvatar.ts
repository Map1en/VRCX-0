import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import myAvatarRepository from '@/repositories/myAvatarRepository';

import type {
    UserDialogAvatarRecord,
    UserDialogProfileSnapshot
} from './userDialogProfileTypes';
import { normalizeUserId } from './userProfileFields';

type CurrentAvatarDetailsInput = {
    avatarId: string;
    currentUserId: string;
    profile: UserDialogProfileSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function hasRefreshValue(value: unknown) {
    return value !== undefined && value !== null && value !== '';
}

export function normalizedAvatarName(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function isUnknownAvatarName(value: unknown) {
    const name = normalizedAvatarName(value).toLowerCase();
    return (
        !name || name === '-' || name === 'unknown' || name === 'unknown avatar'
    );
}

function hasUsefulAvatarDetails(avatar: unknown) {
    if (!isRecord(avatar)) {
        return false;
    }
    return Boolean(
        !isUnknownAvatarName(avatar.name) ||
        hasRefreshValue(avatar.imageUrl) ||
        hasRefreshValue(avatar.thumbnailImageUrl)
    );
}

function hasUsefulAvatarName(avatar: unknown) {
    return Boolean(isRecord(avatar) && !isUnknownAvatarName(avatar.name));
}

export function shouldHydrateCurrentAvatar(profile: UserDialogProfileSnapshot) {
    return Boolean(
        normalizeUserId(profile?.currentAvatar) &&
        (isUnknownAvatarName(
            profile?.currentAvatarName || profile?.avatarName
        ) ||
            (!hasRefreshValue(profile?.currentAvatarImageUrl) &&
                !hasRefreshValue(profile?.currentAvatarThumbnailImageUrl)))
    );
}

export function mergeCurrentAvatarProfile(
    profile: UserDialogProfileSnapshot,
    avatar: unknown
) {
    if (!profile || !isRecord(avatar)) {
        return profile;
    }
    const avatarRecord: UserDialogAvatarRecord = avatar;

    const avatarId = normalizeUserId(avatarRecord.id);
    const currentAvatar = normalizeUserId(profile.currentAvatar) || avatarId;
    if (!currentAvatar || !avatarId || currentAvatar !== avatarId) {
        return profile;
    }

    let nextProfile = normalizeUserId(profile.currentAvatar)
        ? profile
        : { ...profile, currentAvatar: avatarId };
    const profileAvatarNameUnknown = isUnknownAvatarName(
        profile.currentAvatarName || profile.avatarName
    );
    const avatarName = normalizedAvatarName(avatarRecord.name);
    if (avatarName && profileAvatarNameUnknown) {
        nextProfile = { ...nextProfile, currentAvatarName: avatarName };
    }

    const thumbnailImageUrl =
        normalizedAvatarName(avatarRecord.thumbnailImageUrl) ||
        normalizedAvatarName(avatarRecord.imageUrl);
    if (
        thumbnailImageUrl &&
        (profileAvatarNameUnknown ||
            !hasRefreshValue(nextProfile.currentAvatarThumbnailImageUrl))
    ) {
        nextProfile = {
            ...nextProfile,
            currentAvatarThumbnailImageUrl: thumbnailImageUrl
        };
    }

    const imageUrl =
        normalizedAvatarName(avatarRecord.imageUrl) ||
        normalizedAvatarName(avatarRecord.thumbnailImageUrl);
    if (
        imageUrl &&
        (profileAvatarNameUnknown ||
            !hasRefreshValue(nextProfile.currentAvatarImageUrl))
    ) {
        nextProfile = { ...nextProfile, currentAvatarImageUrl: imageUrl };
    }

    return nextProfile;
}

export function mergeCurrentUserAvatarFields(
    profile: UserDialogProfileSnapshot,
    previousProfile: UserDialogProfileSnapshot
) {
    if (!previousProfile || !profile) {
        return profile;
    }
    const previousAvatarId = normalizeUserId(previousProfile.currentAvatar);
    const nextProfile =
        previousAvatarId && !normalizeUserId(profile.currentAvatar)
            ? { ...profile, currentAvatar: previousAvatarId }
            : profile;
    return mergeCurrentAvatarProfile(nextProfile, {
        id: previousProfile.currentAvatar,
        name: previousProfile.currentAvatarName || previousProfile.avatarName,
        imageUrl: previousProfile.currentAvatarImageUrl,
        thumbnailImageUrl: previousProfile.currentAvatarThumbnailImageUrl
    });
}

export async function getCurrentAvatarDetails({
    avatarId,
    currentUserId,
    profile
}: CurrentAvatarDetailsInput) {
    let avatarProfile: UserDialogAvatarRecord | null = null;
    try {
        avatarProfile = await avatarProfileRepository.getAvatarProfile({
            avatarId,
            force: true,
            dialog: true,
            allowLocalFallback: true,
            currentUserId
        });
    } catch {
        avatarProfile = null;
    }

    if (hasUsefulAvatarName(avatarProfile)) {
        return avatarProfile;
    }

    let myAvatar: UserDialogAvatarRecord | null = null;
    try {
        myAvatar = await myAvatarRepository.getMyAvatarById({
            avatarId
        });
    } catch {
        myAvatar = null;
    }
    if (hasUsefulAvatarName(myAvatar)) {
        return myAvatar;
    }

    const imageUrl =
        normalizedAvatarName(profile?.currentAvatarImageUrl) ||
        normalizedAvatarName(profile?.currentAvatarThumbnailImageUrl) ||
        normalizedAvatarName(avatarProfile?.imageUrl) ||
        normalizedAvatarName(avatarProfile?.thumbnailImageUrl) ||
        normalizedAvatarName(myAvatar?.imageUrl) ||
        normalizedAvatarName(myAvatar?.thumbnailImageUrl);
    if (imageUrl) {
        const imageAvatarInfo =
            await avatarProfileRepository.getAvatarNameFromImageUrl(imageUrl);
        const imageAvatarName = normalizedAvatarName(
            imageAvatarInfo?.avatarName
        );
        if (!isUnknownAvatarName(imageAvatarName)) {
            return {
                ...(avatarProfile || myAvatar || {}),
                id: avatarId,
                name: imageAvatarName,
                imageUrl:
                    normalizedAvatarName(profile?.currentAvatarImageUrl) ||
                    normalizedAvatarName(avatarProfile?.imageUrl) ||
                    normalizedAvatarName(myAvatar?.imageUrl) ||
                    imageUrl,
                thumbnailImageUrl:
                    normalizedAvatarName(
                        profile?.currentAvatarThumbnailImageUrl
                    ) ||
                    normalizedAvatarName(avatarProfile?.thumbnailImageUrl) ||
                    normalizedAvatarName(myAvatar?.thumbnailImageUrl) ||
                    imageUrl
            };
        }
    }

    return hasUsefulAvatarDetails(myAvatar)
        ? myAvatar
        : avatarProfile || myAvatar;
}
