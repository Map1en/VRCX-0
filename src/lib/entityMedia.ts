import { backend } from '@/platform/index.js';
import vrchatSearchRepository from '@/repositories/vrchatSearchRepository.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { getColourFromUserID } from '@/shared/utils/colour.js';
import { parseLocation } from '@/shared/utils/location.js';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';

type LooseRecord = Record<string, any>;

type ImageUser = LooseRecord & {
    userIcon?: string;
    profilePicOverrideThumbnail?: string;
    profilePicOverride?: string;
    thumbnailUrl?: string;
    currentAvatarThumbnailImageUrl?: string;
    currentAvatarImageUrl?: string;
};

type RepositoryResponse = {
    json?: any;
};

type OpenExternalLinkOptions = {
    directAccess?: boolean;
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
        const endpoint = normalizeVrchatEndpointDomain(
            endpointDomain ||
                useRuntimeStore.getState().auth.currentUserEndpoint
        );
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
    return hueToHex(getColourFromUserID((userId || '') as string), isDarkMode);
}

export function userImage(
    user: ImageUser | null | undefined,
    isIcon = false,
    resolution: string | number = '128',
    isUserDialogIcon = false,
    displayVRCPlusIconsAsAvatar: boolean | null = null
) {
    if (!user) {
        return '';
    }
    const shouldDisplayVrcPlusIcon =
        displayVRCPlusIconsAsAvatar ??
        useShellStore.getState().displayVRCPlusIconsAsAvatar;
    if (
        (isUserDialogIcon && user.userIcon) ||
        (shouldDisplayVrcPlusIcon && user.userIcon)
    ) {
        if (isIcon) {
            return convertFileUrlToImageUrl(user.userIcon);
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
            return convertFileUrlToImageUrl(user.currentAvatarImageUrl);
        }
        return user.currentAvatarImageUrl;
    }
    return '';
}

function normalizeString(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

async function openGroupShortCode(shortCode: unknown) {
    const normalizedShortCode = normalizeString(shortCode);
    if (!/^[A-Za-z0-9]{3,6}\.[0-9]{4}$/.test(normalizedShortCode)) {
        return false;
    }

    try {
        const response = (await vrchatSearchRepository.getGroups({
            query: normalizedShortCode
        })) as RepositoryResponse;
        const group = (Array.isArray(response.json) ? response.json : []).find(
            (entry) =>
                `${entry?.shortCode}.${entry?.discriminator}` ===
                normalizedShortCode
        );
        if (group?.id) {
            openGroupDialog({
                groupId: group.id,
                title: group.name || normalizedShortCode,
                seedData: group
            });
            return true;
        }
    } catch (error) {
        console.warn('Failed to resolve group short code:', error);
    }

    return false;
}

async function openWorldShortName(location: unknown, shortName: unknown) {
    const normalizedShortName = normalizeString(shortName);
    if (!/^[A-Za-z0-9]{8}$/.test(normalizedShortName)) {
        return false;
    }

    try {
        const response =
            (await vrchatSearchRepository.getInstanceFromShortName(
                normalizedShortName
            )) as RepositoryResponse;
        const resolvedLocation = response.json?.location || location;
        if (resolvedLocation) {
            const parsedLocation = parseLocation(resolvedLocation);
            openWorldDialog({
                worldId: parsedLocation.worldId || resolvedLocation,
                title: response.json?.shortName || normalizedShortName,
                seedData: response.json
            });
            return true;
        }
    } catch (error) {
        console.warn('Failed to resolve world short name:', error);
    }

    if (location) {
        const parsedLocation = parseLocation(location);
        openWorldDialog({
            worldId: parsedLocation.worldId || location,
            title: normalizedShortName
        });
        return true;
    }

    return false;
}

async function openDirectAccessTarget(input: unknown) {
    let value = normalizeString(input);
    if (!value) {
        return false;
    }

    if (value.startsWith('/home/')) {
        value = `https://vrchat.com${value}`;
    }

    if (value.startsWith('https://vrchat.')) {
        let url;
        try {
            url = new URL(value);
        } catch {
            return false;
        }
        const urlPathSplit = url.pathname.split('/');
        if (urlPathSplit[2] === 'launch') {
            const worldId = url.searchParams.get('worldId');
            const instanceId = url.searchParams.get('instanceId');
            const shortName = url.searchParams.get('shortName');
            if (worldId && instanceId) {
                const location = `${worldId}:${instanceId}`;
                if (shortName) {
                    return openWorldShortName(location, shortName);
                }
                openWorldDialog({ worldId });
                return true;
            }
            if (worldId) {
                openWorldDialog({ worldId });
                return true;
            }
        }
        if (urlPathSplit.length >= 4) {
            const type = urlPathSplit[2];
            const entityId = urlPathSplit[3];
            if (type === 'user') {
                openUserDialog({ userId: entityId });
                return true;
            }
            if (type === 'avatar') {
                openAvatarDialog({ avatarId: entityId });
                return true;
            }
            if (type === 'group') {
                openGroupDialog({ groupId: entityId });
                return true;
            }
            if (type === 'world') {
                openWorldDialog({ worldId: entityId });
                return true;
            }
        }
        return false;
    }

    if (value.startsWith('https://vrc.group/')) {
        return openGroupShortCode(value.substring(18));
    }
    if (value.startsWith('https://vrch.at/')) {
        return openWorldShortName('', value.substring(16, 24));
    }
    if (/^[A-Za-z0-9]{8}$/.test(value)) {
        return openWorldShortName('', value);
    }
    if (/^[A-Za-z0-9]{3,6}\.[0-9]{4}$/.test(value)) {
        return openGroupShortCode(value);
    }
    if (value.startsWith('usr_') || /^[A-Za-z0-9]{10}$/.test(value)) {
        openUserDialog({ userId: value });
        return true;
    }
    if (value.startsWith('avtr_') || value.startsWith('b_')) {
        openAvatarDialog({ avatarId: value });
        return true;
    }
    if (value.startsWith('grp_')) {
        openGroupDialog({ groupId: value });
        return true;
    }
    if (
        value.startsWith('wrld_') ||
        value.startsWith('wld_') ||
        value.startsWith('o_')
    ) {
        if (value.includes('&instanceId=')) {
            const [worldId, params] = value.split('&', 2);
            const instanceId = new URLSearchParams(params).get('instanceId');
            openWorldDialog({
                worldId: instanceId ? `${worldId}:${instanceId}` : worldId
            });
            return true;
        }
        openWorldDialog({ worldId: value });
        return true;
    }

    return false;
}

export async function copyTextToClipboard(text: string) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (error) {
        console.warn('Failed to copy link:', error);
    }
}

export async function openExternalLink(
    link: unknown,
    options: OpenExternalLinkOptions = {}
) {
    if (!link) {
        return;
    }

    const normalizedLink = String(link);
    if (options.directAccess && (await openDirectAccessTarget(normalizedLink))) {
        return;
    }

    try {
        await backend.app.OpenLink(normalizedLink);
    } catch {
        if (
            normalizedLink.startsWith('http://') ||
            normalizedLink.startsWith('https://')
        ) {
            window.open(normalizedLink, '_blank', 'noopener,noreferrer');
        }
    }
}
