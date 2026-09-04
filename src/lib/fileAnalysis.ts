import type {
    AvatarStatsRecord,
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

const AVATAR_STAT_KEYS = [
    'animatorCount',
    'audioSourceCount',
    'blendShapeCount',
    'boneCount',
    'bounds',
    'cameraCount',
    'clothCount',
    'constraintCount',
    'constraintDepth',
    'contactCount',
    'lightCount',
    'lineRendererCount',
    'materialCount',
    'materialSlotsUsed',
    'meshCount',
    'meshParticleMaxPolygons',
    'particleCollisionEnabled',
    'particleSystemCount',
    'particleTrailsEnabled',
    'physBoneColliderCount',
    'physBoneCollisionCheckCount',
    'physBoneComponentCount',
    'physBoneTransformCount',
    'physicsColliders',
    'physicsRigidbodies',
    'raycastCount',
    'skinnedMeshCount',
    'totalClothVertices',
    'totalMaxParticles',
    'totalPolygons',
    'totalTextureUsage',
    'totalVertices',
    'trailRendererCount',
    'writeDefaultsUsed'
] as const satisfies readonly (keyof AvatarStatsRecord)[];

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

function pickAvatarStats(value: unknown): AvatarStatsRecord | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const entries = AVATAR_STAT_KEYS.flatMap((key) =>
        typeof value[key] === 'undefined' ? [] : [[key, value[key]]]
    );
    return entries.length
        ? (Object.fromEntries(entries) as AvatarStatsRecord)
        : undefined;
}

function formatFileAnalysis(json: unknown): FileAnalysisRecord | null {
    if (!isRecord(json) || !json.success) {
        return null;
    }
    const avatarStats = pickAvatarStats(json.avatarStats);
    return {
        _fileSize:
            typeof json.fileSize === 'undefined'
                ? ''
                : formatMiB(json.fileSize),
        ...(typeof json.uncompressedSize === 'undefined'
            ? {}
            : { _uncompressedSize: formatMiB(json.uncompressedSize) }),
        ...(avatarStats && typeof avatarStats.totalTextureUsage !== 'undefined'
            ? {
                  _totalTextureUsage: formatMiB(avatarStats.totalTextureUsage)
              }
            : {}),
        ...(typeof json.performanceRating === 'string'
            ? { performanceRating: json.performanceRating }
            : {}),
        ...(avatarStats ? { avatarStats } : {})
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

export function isPendingFileAnalysisError(error: unknown): boolean {
    return isVrchatRequestError(error) && error.status === 202;
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
                const queryKey = queryKeys.fileAnalysis(
                    { fileId, version, variant },
                    endpoint
                );
                try {
                    const analysis = await fetchCachedData({
                        queryKey,
                        policy: entityQueryPolicies.fileAnalysis,
                        queryFn: async () => {
                            const response =
                                await vrchatAuthRepository.getFileAnalysis({
                                    fileId,
                                    version,
                                    variant
                                });
                            return formatFileAnalysis(response.json);
                        }
                    });
                    if (analysis !== null) {
                        result[platform] = analysis;
                    }
                } catch (error) {
                    if (isPendingFileAnalysisError(error)) {
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
