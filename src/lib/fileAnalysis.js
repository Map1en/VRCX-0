import { compareUnityVersion } from '@/shared/utils/avatar.js';
import { extractFileId, extractFileVersion } from '@/shared/utils/fileUtils.js';
import { vrchatAuthRepository } from '@/repositories/index.js';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/services/entityQueryCacheService.js';

function formatMiB(value) {
    const size = Number(value);
    return Number.isFinite(size) ? `${(size / 1048576).toFixed(2)} MB` : '';
}

function normalizePlatform(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isAnalyzablePackage(unityPackage, sdkUnityVersion) {
    if (!unityPackage || typeof unityPackage !== 'object') {
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

function formatFileAnalysis(json) {
    if (!json || typeof json !== 'object') {
        return null;
    }
    return {
        ...json,
        ...(typeof json.fileSize !== 'undefined' ? { _fileSize: formatMiB(json.fileSize) } : {}),
        ...(typeof json.uncompressedSize !== 'undefined' ? { _uncompressedSize: formatMiB(json.uncompressedSize) } : {}),
        ...(typeof json.avatarStats?.totalTextureUsage !== 'undefined'
            ? { _totalTextureUsage: formatMiB(json.avatarStats.totalTextureUsage) }
            : {})
    };
}

export async function getFileAnalysisForUnityPackages({
    unityPackages = [],
    sdkUnityVersion = '',
    endpoint = ''
} = {}) {
    const result = {};
    const packages = Array.isArray(unityPackages) ? unityPackages : [];

    for (const unityPackage of packages) {
        if (!isAnalyzablePackage(unityPackage, sdkUnityVersion)) {
            continue;
        }
        const platform = normalizePlatform(unityPackage.platform);
        if (!platform || result[platform]) {
            continue;
        }
        const assetUrl = unityPackage.assetUrl || '';
        const fileId = extractFileId(assetUrl);
        const version = Number.parseInt(extractFileVersion(assetUrl), 10);
        const variant = !unityPackage.variant || unityPackage.variant === 'standard'
            ? 'security'
            : unityPackage.variant;
        if (!fileId || !Number.isFinite(version)) {
            continue;
        }
        try {
            const response = await fetchCachedData({
                queryKey: queryKeys.fileAnalysis({ fileId, version, variant }, endpoint),
                policy: entityQueryPolicies.fileAnalysis,
                queryFn: () =>
                    vrchatAuthRepository.executeGet(`analysis/${fileId}/${version}/${variant}`, {
                        endpoint
                    })
            });
            const analysis = formatFileAnalysis(response.json);
            if (analysis?.success) {
                result[platform] = analysis;
            }
        } catch {
            // Keep the dialog usable if an optional analysis endpoint fails for one platform.
        }
    }

    return result;
}
