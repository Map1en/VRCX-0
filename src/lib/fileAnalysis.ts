import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache.js';
import { vrchatAuthRepository } from '@/repositories/index.js';
import { compareUnityVersion } from '@/shared/utils/avatar.js';
import { extractFileId, extractFileVersion } from '@/shared/utils/fileUtils.js';

type UnityPackage = Record<string, any> & {
    assetUrl?: string;
    platform?: string;
    unitySortNumber?: string | number;
    variant?: string;
};

type RepositoryResponse = {
    json?: any;
};

type FileAnalysisOptions = {
    unityPackages?: unknown;
    sdkUnityVersion?: string;
    endpoint?: string;
};

function formatMiB(value: unknown) {
    const size = Number(value);
    return Number.isFinite(size) ? `${(size / 1048576).toFixed(2)} MB` : '';
}

function normalizePlatform(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function isAnalyzablePackage(
    unityPackage: unknown,
    sdkUnityVersion: string
): unityPackage is UnityPackage {
    if (
        !unityPackage ||
        (typeof unityPackage !== 'object' && typeof unityPackage !== 'function')
    ) {
        return false;
    }
    const source = unityPackage as UnityPackage;
    if (
        source.variant &&
        source.variant !== 'standard' &&
        source.variant !== 'security'
    ) {
        return false;
    }
    if (
        sdkUnityVersion &&
        source.unitySortNumber &&
        !compareUnityVersion(source.unitySortNumber as string, sdkUnityVersion)
    ) {
        return false;
    }
    return true;
}

function formatFileAnalysis(json: unknown): (Record<string, any> & {
    success?: boolean;
}) | null {
    if (!json || typeof json !== 'object') {
        return null;
    }
    const source = json as Record<string, any>;
    return {
        ...source,
        ...(typeof source.fileSize !== 'undefined'
            ? { _fileSize: formatMiB(source.fileSize) }
            : {}),
        ...(typeof source.uncompressedSize !== 'undefined'
            ? { _uncompressedSize: formatMiB(source.uncompressedSize) }
            : {}),
        ...(typeof source.avatarStats?.totalTextureUsage !== 'undefined'
            ? {
                  _totalTextureUsage: formatMiB(
                      source.avatarStats.totalTextureUsage
                  )
              }
            : {})
    };
}

export async function getFileAnalysisForUnityPackages({
    unityPackages = [],
    sdkUnityVersion = '',
    endpoint = ''
}: FileAnalysisOptions = {}) {
    const result: Record<string, any> = {};
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
        const variant =
            !unityPackage.variant || unityPackage.variant === 'standard'
                ? 'security'
                : unityPackage.variant;
        if (!fileId || !Number.isFinite(version)) {
            continue;
        }
        try {
            const response = await fetchCachedData<RepositoryResponse>({
                queryKey: queryKeys.fileAnalysis(
                    { fileId, version, variant },
                    endpoint
                ),
                policy: entityQueryPolicies.fileAnalysis,
                queryFn: () =>
                    vrchatAuthRepository.executeGet(
                        `analysis/${fileId}/${version}/${variant}`,
                        {
                            endpoint
                        }
                    )
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
