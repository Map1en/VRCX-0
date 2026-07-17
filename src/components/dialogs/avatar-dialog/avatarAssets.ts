import type { AvatarGalleryFile } from '@/repositories/avatarProfileRepository';
import { compareUnityVersion } from '@/shared/utils/avatar';
import {
    extractFileId,
    extractFileVersion,
    extractVariantVersion
} from '@/shared/utils/fileUtils';

import type { AvatarSideData } from './avatarDialogTypes';

export function defaultAvatarSideData(): AvatarSideData {
    return {
        galleryRows: [],
        galleryImages: [],
        fileAnalysis: {},
        cache: {
            inCache: false,
            cacheSize: '',
            cacheLocked: false,
            cachePath: ''
        }
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function avatarGalleryImageUrl(file: unknown): string {
    if (!isRecord(file)) {
        return '';
    }
    const typedFile: AvatarGalleryFile = file;
    const versions = Array.isArray(typedFile.versions)
        ? typedFile.versions
        : [];
    const latestVersion = versions[versions.length - 1];
    return (
        latestVersion?.file?.url ||
        typedFile.url ||
        typedFile.fileUrl ||
        typedFile.imageUrl ||
        ''
    );
}

export function isCacheCandidatePackage(
    unityPackage: unknown,
    sdkUnityVersion = ''
): boolean {
    if (!isRecord(unityPackage)) {
        return false;
    }
    if (unityPackage.platform !== 'standalonewindows') {
        return false;
    }
    if (
        unityPackage.variant &&
        unityPackage.variant !== 'standard' &&
        unityPackage.variant !== 'security'
    ) {
        return false;
    }
    if (
        sdkUnityVersion &&
        unityPackage.unitySortNumber &&
        !compareUnityVersion(
            String(unityPackage.unitySortNumber),
            sdkUnityVersion
        )
    ) {
        return false;
    }
    return true;
}

export function resolveAssetBundleArgs(avatar: unknown, sdkUnityVersion = '') {
    const source = isRecord(avatar) ? avatar : {};
    const unityPackages = Array.isArray(source.unityPackages)
        ? source.unityPackages
        : [];
    let selectedPackage: Record<string, unknown> | null = null;
    for (let index = unityPackages.length - 1; index >= 0; index -= 1) {
        const unityPackage = unityPackages[index];
        if (isCacheCandidatePackage(unityPackage, sdkUnityVersion)) {
            selectedPackage = isRecord(unityPackage) ? unityPackage : null;
            break;
        }
    }
    if (!selectedPackage && sdkUnityVersion) {
        return resolveAssetBundleArgs(avatar, '');
    }
    const assetUrl = String(selectedPackage?.assetUrl || source.assetUrl || '');
    const fileId = extractFileId(assetUrl);
    const fileVersion = Number.parseInt(extractFileVersion(assetUrl), 10);
    const variant =
        !selectedPackage?.variant || selectedPackage.variant === 'standard'
            ? 'security'
            : String(selectedPackage.variant);
    const variantVersion =
        Number.parseInt(extractVariantVersion(assetUrl), 10) || 0;
    if (!fileId || !Number.isFinite(fileVersion)) {
        return null;
    }
    return {
        fileId,
        fileVersion,
        variant,
        variantVersion
    };
}
