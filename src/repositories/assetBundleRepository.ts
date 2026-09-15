import { commands } from '@/platform/tauri/bindings';
import type { CacheCheckResult } from '@/platform/tauri/bindings';

async function getVRChatCacheFullLocation(
    fileId: string,
    fileVersion: number,
    variant: string,
    variantVersion: number
): Promise<string> {
    return commands.assetBundleGetVrchatCacheFullLocation(
        fileId,
        fileVersion,
        variant,
        variantVersion
    );
}

async function checkVRChatCache(
    fileId: string,
    fileVersion: number,
    variant: string,
    variantVersion: number
): Promise<CacheCheckResult> {
    return commands.assetBundleCheckVrchatCache(
        fileId,
        fileVersion,
        variant,
        variantVersion
    );
}

async function deleteCache(
    fileId: string,
    fileVersion: number,
    variant: string,
    variantVersion: number
): Promise<void> {
    await commands.assetBundleDeleteCache(
        fileId,
        fileVersion,
        variant,
        variantVersion
    );
}

async function deleteAllCache(): Promise<void> {
    await commands.assetBundleDeleteAllCache();
}

async function sweepCache(maxSizeBytes: number): Promise<string[]> {
    return commands.assetBundleSweepCacheToSize(maxSizeBytes);
}

async function getCacheSize(): Promise<number> {
    return Number(await commands.assetBundleGetCacheSize()) || 0;
}

export const assetBundleRepository = Object.freeze({
    checkVRChatCache,
    deleteAllCache,
    deleteCache,
    getCacheSize,
    getVRChatCacheFullLocation,
    sweepCache
});
