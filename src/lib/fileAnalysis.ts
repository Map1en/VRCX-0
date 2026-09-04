import type { PlatformFileAnalysis } from '@/domain/entities/world';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import { compareUnityVersion } from '@/shared/utils/avatar';
import { extractFileId, extractFileVersion } from '@/shared/utils/fileUtils';
import { isRecord } from '@/shared/utils/record';

type UnityPackage = Record<string, unknown> & {
    assetUrl?: string;
    platform?: string;
    unitySortNumber?: string | number;
    variant?: string;
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

function fileAnalysisSize(json: unknown): string | null {
    if (!isRecord(json) || !json.success) {
        return null;
    }
    return typeof json.fileSize === 'undefined' ? '' : formatMiB(json.fileSize);
}

export async function getFileAnalysisForUnityPackages({
    unityPackages = [],
    sdkUnityVersion = '',
    endpoint = ''
}: FileAnalysisOptions = {}) {
    const result: PlatformFileAnalysis = {};
    const packages = Array.isArray(unityPackages) ? unityPackages : [];
    const requests = new Map<
        string,
        { fileId: string; variant: string; version: number }
    >();

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

    await Promise.all(
        Array.from(
            requests,
            async ([platform, { fileId, variant, version }]) => {
                try {
                    const fileSize = await fetchCachedData({
                        queryKey: queryKeys.fileAnalysis(
                            { fileId, version, variant },
                            endpoint
                        ),
                        policy: entityQueryPolicies.fileAnalysis,
                        queryFn: async () => {
                            const response =
                                await vrchatAuthRepository.getFileAnalysis({
                                    fileId,
                                    version,
                                    variant
                                });
                            return fileAnalysisSize(response.json);
                        }
                    });
                    if (fileSize !== null) {
                        result[platform] = { _fileSize: fileSize };
                    }
                } catch {
                    // no-op
                }
            }
        )
    );

    return result;
}
