import { directAccessParse } from '@/services/directAccessService';
import { openExternalLink as openShellExternalLink } from '@/services/shellIntegrationService';
import {
    convertFileUrlToImageUrl as convertFileUrlToImageUrlWithEndpoint,
    getNameColour,
    userImage as userImageWithOptions
} from '@/shared/utils/entityMedia';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

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
    return convertFileUrlToImageUrlWithEndpoint(
        url,
        resolution,
        endpointDomain || useRuntimeStore.getState().auth.currentUserEndpoint
    );
}

export function userImage(
    user: ImageUser | null | undefined,
    isIcon = false,
    resolution: string | number = '128',
    isUserDialogIcon = false,
    displayVRCPlusIconsAsAvatar: boolean | null = null
) {
    return userImageWithOptions(
        user,
        isIcon,
        resolution,
        isUserDialogIcon,
        displayVRCPlusIconsAsAvatar ??
            useShellStore.getState().displayVRCPlusIconsAsAvatar,
        useRuntimeStore.getState().auth.currentUserEndpoint
    );
}

type OpenExternalLinkOptions = {
    directAccess?: boolean;
};

export { getNameColour };

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
    if (options.directAccess) {
        const endpoint = useRuntimeStore.getState().auth.currentUserEndpoint;
        try {
            if (await directAccessParse(normalizedLink, endpoint)) {
                return;
            }
        } catch (error) {
            console.warn('Failed to resolve direct access target:', error);
        }
    }

    try {
        await openShellExternalLink(normalizedLink);
    } catch {
        if (
            normalizedLink.startsWith('http://') ||
            normalizedLink.startsWith('https://')
        ) {
            window.open(normalizedLink, '_blank', 'noopener,noreferrer');
        }
    }
}
