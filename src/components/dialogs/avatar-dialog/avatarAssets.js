import { compareUnityVersion } from '@/shared/utils/avatar.js';
import {
    extractFileId,
    extractFileVersion,
    extractVariantVersion
} from '@/shared/utils/fileUtils.js';

export function defaultAvatarSideData() {
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

export function avatarGalleryImageUrl(file) {
    const versions = Array.isArray(file?.versions) ? file.versions : [];
    const latestVersion = versions[versions.length - 1];
    return (
        latestVersion?.file?.url ||
        file?.url ||
        file?.fileUrl ||
        file?.imageUrl ||
        ''
    );
}

export function isCacheCandidatePackage(unityPackage, sdkUnityVersion = '') {
    if (!unityPackage || unityPackage.platform !== 'standalonewindows') {
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
        !compareUnityVersion(unityPackage.unitySortNumber, sdkUnityVersion)
    ) {
        return false;
    }
    return true;
}

export function resolveAssetBundleArgs(avatar, sdkUnityVersion = '') {
    const unityPackages = Array.isArray(avatar?.unityPackages)
        ? avatar.unityPackages
        : [];
    let selectedPackage = null;
    for (let index = unityPackages.length - 1; index >= 0; index -= 1) {
        const unityPackage = unityPackages[index];
        if (isCacheCandidatePackage(unityPackage, sdkUnityVersion)) {
            selectedPackage = unityPackage;
            break;
        }
    }
    if (!selectedPackage && sdkUnityVersion) {
        return resolveAssetBundleArgs(avatar, '');
    }
    const assetUrl = selectedPackage?.assetUrl || avatar?.assetUrl || '';
    const fileId = extractFileId(assetUrl);
    const fileVersion = Number.parseInt(extractFileVersion(assetUrl), 10);
    const variant =
        !selectedPackage?.variant || selectedPackage.variant === 'standard'
            ? 'security'
            : selectedPackage.variant;
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
