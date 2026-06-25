import { assetBundleRepository } from '@/repositories/assetBundleRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';

import { defaultAvatarSideData, resolveAssetBundleArgs } from './avatarAssets';

export async function readAvatarCacheInfo(avatar: any, endpoint: any = '') {
    const configResponse = await vrchatAuthRepository
        .getConfig({ endpoint })
        .catch((): null => null);
    const sdkUnityVersion = String(configResponse?.json?.sdkUnityVersion || '');
    const args = resolveAssetBundleArgs(avatar, sdkUnityVersion);
    if (!args) {
        return defaultAvatarSideData().cache;
    }
    const cacheInfo = await assetBundleRepository.checkVRChatCache(
        args.fileId,
        args.fileVersion,
        args.variant,
        args.variantVersion
    );
    const size = Number(cacheInfo?.Item1 ?? 0);
    const cacheLocked = Boolean(cacheInfo?.Item2);
    const cachePath = String(cacheInfo?.Item3 ?? '');
    return {
        inCache: size > 0,
        cacheSize: size > 0 ? `${(size / 1048576).toFixed(2)} MB` : '',
        cacheLocked,
        cachePath
    };
}
