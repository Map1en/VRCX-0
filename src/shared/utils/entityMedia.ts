import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint';

import { getColourFromUserID } from './colour';

type LooseRecord = Record<string, unknown>;

type ImageUser = LooseRecord & {
    userIcon?: string;
    profilePicOverrideThumbnail?: string;
    profilePicOverride?: string;
    thumbnailUrl?: string;
    currentAvatarThumbnailImageUrl?: string;
    currentAvatarImageUrl?: string;
};

export function convertFileUrlToImageUrl(
    url: string | null | undefined,
    resolution: string | number = 128,
    endpointDomain: string | null = null
) {
    if (!url) {
        return '';
    }

    const pattern = /file\/file_([a-f0-9-]+)\/(\d+)(\/file)?\/?$/;
    const match = url.match(pattern);

    if (match) {
        const fileId = match[1];
        const version = match[2];
        const endpoint = normalizeVrchatEndpointDomain(endpointDomain);
        return `${endpoint}/image/file_${fileId}/${version}/${resolution}`;
    }

    return url;
}

function hsvToRgb(h: number, s: number, v: number) {
    let r = 0;
    let g = 0;
    let b = 0;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    switch (i % 6) {
        case 0:
            r = v;
            g = t;
            b = p;
            break;
        case 1:
            r = q;
            g = v;
            b = p;
            break;
        case 2:
            r = p;
            g = v;
            b = t;
            break;
        case 3:
            r = p;
            g = q;
            b = v;
            break;
        case 4:
            r = t;
            g = p;
            b = v;
            break;
        case 5:
            r = v;
            g = p;
            b = q;
            break;
        default:
            break;
    }

    const red = Math.round(r * 255);
    const green = Math.round(g * 255);
    const blue = Math.round(b * 255);
    const decColor = 0x1000000 + blue + 0x100 * green + 0x10000 * red;
    return `#${decColor.toString(16).substr(1)}`;
}

function hueToHex(hue: number, isDarkMode: boolean) {
    if (isDarkMode) {
        return hsvToRgb(hue / 65535, 0.6, 1);
    }
    return hsvToRgb(hue / 65535, 1, 0.7);
}

export function getNameColour(userId: unknown, isDarkMode: boolean) {
    return hueToHex(getColourFromUserID(String(userId || '')), isDarkMode);
}

export function userImage(
    user: ImageUser | null | undefined,
    isIcon: any = false,
    resolution: string | number = '128',
    isUserDialogIcon: any = false,
    displayVRCPlusIconsAsAvatar = false,
    endpointDomain: string | null = null
) {
    if (!user) {
        return '';
    }
    if (
        (isUserDialogIcon && user.userIcon) ||
        (displayVRCPlusIconsAsAvatar && user.userIcon)
    ) {
        if (isIcon) {
            return convertFileUrlToImageUrl(
                user.userIcon,
                resolution,
                endpointDomain
            );
        }
        return user.userIcon;
    }

    if (user.profilePicOverrideThumbnail) {
        if (isIcon) {
            return user.profilePicOverrideThumbnail.replace(
                '/256',
                `/${resolution}`
            );
        }
        return user.profilePicOverrideThumbnail;
    }
    if (user.profilePicOverride) {
        return user.profilePicOverride;
    }
    if (user.thumbnailUrl) {
        return user.thumbnailUrl;
    }
    if (user.currentAvatarThumbnailImageUrl) {
        if (isIcon) {
            return user.currentAvatarThumbnailImageUrl.replace(
                '/256',
                `/${resolution}`
            );
        }
        return user.currentAvatarThumbnailImageUrl;
    }
    if (user.currentAvatarImageUrl) {
        if (isIcon) {
            return convertFileUrlToImageUrl(
                user.currentAvatarImageUrl,
                resolution,
                endpointDomain
            );
        }
        return user.currentAvatarImageUrl;
    }
    return '';
}
