import { backend } from '@/platform/tauri/index.js';
import { compareUnityVersion } from '@/shared/utils/avatar.js';
import { extractFileId, extractFileVersion, extractVariantVersion } from '@/shared/utils/fileUtils.js';
import { vrchatAuthRepository } from '@/repositories/index.js';

export function defaultWorldCacheInfo() {
    return {
        inCache: false,
        cacheSize: '',
        cacheLocked: false,
        cachePath: ''
    };
}

function isWorldCacheCandidatePackage(unityPackage, sdkUnityVersion = '') {
    if (!unityPackage || unityPackage.platform !== 'standalonewindows') {
        return false;
    }
    if (unityPackage.variant && unityPackage.variant !== 'standard' && unityPackage.variant !== 'security') {
        return false;
    }
    if (sdkUnityVersion && unityPackage.unitySortNumber && !compareUnityVersion(unityPackage.unitySortNumber, sdkUnityVersion)) {
        return false;
    }
    return true;
}

export function resolveWorldAssetBundleArgs(world, sdkUnityVersion = '') {
    const unityPackages = Array.isArray(world?.unityPackages) ? world.unityPackages : [];
    let selectedPackage = null;
    for (let index = unityPackages.length - 1; index >= 0; index -= 1) {
        const unityPackage = unityPackages[index];
        if (isWorldCacheCandidatePackage(unityPackage, sdkUnityVersion)) {
            selectedPackage = unityPackage;
            break;
        }
    }
    if (!selectedPackage && sdkUnityVersion) {
        return resolveWorldAssetBundleArgs(world, '');
    }
    const assetUrl = selectedPackage?.assetUrl || world?.assetUrl || '';
    const fileId = extractFileId(assetUrl);
    const fileVersion = Number.parseInt(extractFileVersion(assetUrl), 10);
    const variant = !selectedPackage?.variant || selectedPackage.variant === 'standard'
        ? 'security'
        : selectedPackage.variant;
    const variantVersion = Number.parseInt(extractVariantVersion(assetUrl), 10) || 0;
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

export async function readWorldCacheInfo(world, endpoint = '', sdkUnityVersion) {
    let resolvedSdkUnityVersion = sdkUnityVersion;
    if (typeof resolvedSdkUnityVersion !== 'string') {
        const configResponse = await vrchatAuthRepository.getConfig({ endpoint }).catch(() => null);
        resolvedSdkUnityVersion = String(configResponse?.json?.sdkUnityVersion || '');
    }
    const args = resolveWorldAssetBundleArgs(world, resolvedSdkUnityVersion);
    if (!args) {
        return defaultWorldCacheInfo();
    }
    const cacheInfo = await backend.assetBundle.CheckVRChatCache(
        args.fileId,
        args.fileVersion,
        args.variant,
        args.variantVersion
    );
    const size = Number(cacheInfo?.Item1 ?? cacheInfo?.item1 ?? 0);
    const cacheLocked = Boolean(cacheInfo?.Item2 ?? cacheInfo?.item2);
    const cachePath = String(cacheInfo?.Item3 ?? cacheInfo?.item3 ?? '');
    return {
        inCache: size > 0,
        cacheSize: size > 0 ? `${(size / 1048576).toFixed(2)} MB` : '',
        cacheLocked,
        cachePath
    };
}
