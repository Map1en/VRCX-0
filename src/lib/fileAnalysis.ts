import type {
    FileAnalysisRecord,
    PlatformFileAnalysis
} from '@/domain/entities/world';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import { isVrchatRequestError } from '@/repositories/vrchatRequest';
import { compareUnityVersion } from '@/shared/utils/avatar';
import { extractFileId, extractFileVersion } from '@/shared/utils/fileUtils';
import { isRecord } from '@/shared/utils/record';

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

type FileAnalysisRequest = {
    fileId: string;
    variant: string;
    version: number;
};

export type FileAnalysisLoadResult = {
    fileAnalysis: PlatformFileAnalysis;
    pending: boolean;
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
    if (!isRecord(unityPackage)) {
        return false;
    }
    const source = unityPackage;
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

function formatFileAnalysis(json: unknown): FileAnalysisRecord | null {
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

function collectFileAnalysisRequests({
    unityPackages = [],
    sdkUnityVersion = ''
}: FileAnalysisOptions = {}): Map<string, FileAnalysisRequest> {
    const requests = new Map<string, FileAnalysisRequest>();
    const packages = Array.isArray(unityPackages) ? unityPackages : [];

    for (const unityPackage of packages) {
        if (!isAnalyzablePackage(unityPackage, sdkUnityVersion)) {
            continue;
        }
        const platform = normalizePlatform(unityPackage.platform);
        if (!platform || requests.has(platform)) {
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
        requests.set(platform, { fileId, variant, version });
    }

    return requests;
}

export function hasFileAnalysisCandidates(
    options: FileAnalysisOptions = {}
): boolean {
    return collectFileAnalysisRequests(options).size > 0;
}

export async function loadFileAnalysisForUnityPackages({
    unityPackages = [],
    sdkUnityVersion = '',
    endpoint = ''
}: FileAnalysisOptions = {}) {
    const result: PlatformFileAnalysis = {};
    let pending = false;
    const requests = collectFileAnalysisRequests({
        unityPackages,
        sdkUnityVersion
    });

    await Promise.all(
        Array.from(
            requests,
            async ([platform, { fileId, variant, version }]) => {
                try {
                    const response = await fetchCachedData<RepositoryResponse>({
                        queryKey: queryKeys.fileAnalysis(
                            { fileId, version, variant },
                            endpoint
                        ),
                        policy: entityQueryPolicies.fileAnalysis,
                        queryFn: () =>
                            vrchatAuthRepository.getFileAnalysis({
                                fileId,
                                version,
                                variant
                            })
                    });
                    const analysis = formatFileAnalysis(response.json);
                    if (analysis?.success) {
                        result[platform] = analysis;
                    }
                } catch (error) {
                    if (isVrchatRequestError(error) && error.status === 202) {
                        pending = true;
                    }
                }
            }
        )
    );

    return {
        fileAnalysis: result,
        pending
    } satisfies FileAnalysisLoadResult;
}

export async function getFileAnalysisForUnityPackages(
    options: FileAnalysisOptions = {}
) {
    const { fileAnalysis } = await loadFileAnalysisForUnityPackages(options);
    return fileAnalysis;
}
