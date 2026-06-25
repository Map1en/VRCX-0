import { assetBundleRepository } from '@/repositories/assetBundleRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import { compareUnityVersion } from '@/shared/utils/avatar';
import {
    extractFileId,
    extractFileVersion,
    extractVariantVersion
} from '@/shared/utils/fileUtils';

type UnityPackage = Record<string, unknown> & {
    assetUrl?: string;
    platform?: string;
    unitySortNumber?: string | number;
    variant?: string;
};

type WorldRecord = Record<string, unknown> & {
    assetUrl?: string;
    unityPackages?: unknown;
};

type WorldAssetBundleArgs = {
    fileId: string;
    fileVersion: number;
    variant: string;
    variantVersion: number;
};

type WorldCacheInfo = {
    inCache: boolean;
    cacheSize: string;
    cacheLocked: boolean;
    cachePath: string;
};

type CacheInfoTuple = Record<string, unknown> & {
    Item1?: unknown;
    item1?: unknown;
    Item2?: unknown;
    item2?: unknown;
    Item3?: unknown;
    item3?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function defaultWorldCacheInfo(): WorldCacheInfo {
    return {
        inCache: false,
        cacheSize: '',
        cacheLocked: false,
        cachePath: ''
    };
}

function isWorldCacheCandidatePackage(
    unityPackage: unknown,
    sdkUnityVersion: unknown = ''
): unityPackage is UnityPackage {
    if (!isRecord(unityPackage)) {
        return false;
    }
    const source = unityPackage;
    if (source.platform !== 'standalonewindows') {
        return false;
    }
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
        !compareUnityVersion(
            String(source.unitySortNumber),
            String(sdkUnityVersion)
        )
    ) {
        return false;
    }
    return true;
}

export function resolveWorldAssetBundleArgs(
    world: WorldRecord | null | undefined,
    sdkUnityVersion: unknown = ''
): WorldAssetBundleArgs | null {
    const unityPackages = Array.isArray(world?.unityPackages)
        ? world.unityPackages
        : [];
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
    const assetUrl = String(selectedPackage?.assetUrl || world?.assetUrl || '');
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

export async function readWorldCacheInfo(
    world: WorldRecord | null | undefined,
    endpoint: unknown = '',
    sdkUnityVersion?: string
): Promise<WorldCacheInfo> {
    let resolvedSdkUnityVersion = sdkUnityVersion;
    if (typeof resolvedSdkUnityVersion !== 'string') {
        const configResponse = await vrchatAuthRepository
            .getConfig({ endpoint: String(endpoint ?? '') })
            .catch(
                (): Awaited<
                    ReturnType<typeof vrchatAuthRepository.getConfig>
                > | null => null
            );
        resolvedSdkUnityVersion = String(
            configResponse?.json?.sdkUnityVersion || ''
        );
    }
    const args = resolveWorldAssetBundleArgs(world, resolvedSdkUnityVersion);
    if (!args) {
        return defaultWorldCacheInfo();
    }
    const cacheInfo = (await assetBundleRepository.checkVRChatCache(
        args.fileId,
        args.fileVersion,
        args.variant,
        args.variantVersion
    )) as CacheInfoTuple;
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
