import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import { compareUnityVersion } from '@/shared/utils/avatar';
import { extractFileId, extractFileVersion } from '@/shared/utils/fileUtils';

type UnityPackage = Record<string, unknown> & {
    assetUrl?: string;
    platform?: string;
    unitySortNumber?: string | number;
    variant?: string;
};

type RepositoryResponse = {
    json?: unknown;
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(
        value && (typeof value === 'object' || typeof value === 'function')
    );
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
        !compareUnityVersion(String(source.unitySortNumber), sdkUnityVersion)
    ) {
        return false;
    }
    return true;
}

function formatFileAnalysis(json: unknown):
    | (Record<string, unknown> & {
          success?: boolean;
      })
    | null {
    if (!isRecord(json)) {
        return null;
    }
    const source = json;
    const avatarStats = isRecord(source.avatarStats)
        ? source.avatarStats
        : null;
    return {
        ...source,
        ...(typeof source.fileSize !== 'undefined'
            ? { _fileSize: formatMiB(source.fileSize) }
            : {}),
        ...(typeof source.uncompressedSize !== 'undefined'
            ? { _uncompressedSize: formatMiB(source.uncompressedSize) }
            : {}),
        ...(typeof avatarStats?.totalTextureUsage !== 'undefined'
            ? {
                  _totalTextureUsage: formatMiB(avatarStats.totalTextureUsage)
              }
            : {})
    };
}

export async function getFileAnalysisForUnityPackages({
    unityPackages = [],
    sdkUnityVersion = '',
    endpoint = ''
}: FileAnalysisOptions = {}) {
    const result: Record<string, unknown> = {};
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
                    vrchatAuthRepository.getFileAnalysis({
                        endpoint,
                        fileId,
                        version,
                        variant
                    })
            });
            const analysis = formatFileAnalysis(response.json);
            if (analysis?.success) {
                result[platform] = analysis;
            }
        } catch {
            // no-op
        }
    }

    return result;
}
