import { backend } from '@/platform/tauri/index.js';
import { vrchatAuthRepository } from '@/repositories/index.js';

import {
    defaultAvatarSideData,
    resolveAssetBundleArgs
} from './avatarAssets.js';

export async function readAvatarCacheInfo(avatar, endpoint = '') {
    const configResponse = await vrchatAuthRepository
        .getConfig({ endpoint })
        .catch(() => null);
    const sdkUnityVersion = String(configResponse?.json?.sdkUnityVersion || '');
    const args = resolveAssetBundleArgs(avatar, sdkUnityVersion);
    if (!args) {
        return defaultAvatarSideData().cache;
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
