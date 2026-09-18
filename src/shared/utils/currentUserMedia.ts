import type { UserProfileEntity } from '@/domain/entities/user';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint';

export type ProfileMediaField = 'banner' | 'userIcon';

export const PROFILE_MEDIA_URL_FIELD = {
    banner: 'bannerCustomUrl',
    userIcon: 'userIcon'
} as const satisfies Record<ProfileMediaField, keyof UserProfileEntity>;

export function profileMediaFileUrl(endpoint: string, fileId: string): string {
    return fileId
        ? `${normalizeVrchatEndpointDomain(endpoint)}/file/${fileId}/1`
        : '';
}

export type ProfileMediaUpdate =
    | { userIcon: string }
    | { bannerType: 'customImage'; bannerCustomUrl: string }
    | { bannerType: 'avatarBanner' };

export function profileMediaUpdate(
    field: ProfileMediaField,
    fileUrl: string
): ProfileMediaUpdate {
    if (field === 'userIcon') {
        return { userIcon: fileUrl };
    }
    return fileUrl
        ? { bannerType: 'customImage', bannerCustomUrl: fileUrl }
        : { bannerType: 'avatarBanner' };
}

export function mergeCurrentUserMediaFields<
    TUser extends Pick<
        UserProfileEntity,
        'iconUrl' | 'bannerUrl' | 'bannerType' | 'iconType'
    >
>(user: TUser, profile: UserProfileEntity) {
    return {
        ...user,
        userIcon: profile.userIcon || '',
        bannerCustomUrl: profile.bannerCustomUrl || '',
        iconUrl: profile.iconUrl ?? user.iconUrl,
        bannerUrl: profile.bannerUrl ?? user.bannerUrl,
        bannerType: profile.bannerType ?? user.bannerType,
        iconType: profile.iconType ?? user.iconType
    };
}
