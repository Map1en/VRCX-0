import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/tauri/index.js', () => ({
    backend: {
        assetBundle: {
            CheckVRChatCache: vi.fn()
        }
    }
}));

vi.mock('@/repositories/index.js', () => ({
    vrchatAuthRepository: {
        getConfig: vi.fn()
    }
}));

import { backend } from '@/platform/tauri/index.js';
import { vrchatAuthRepository } from '@/repositories/index.js';

import { defaultAvatarSideData } from './avatarAssets.js';
import { readAvatarCacheInfo } from './avatarCacheAdapter.js';

describe('avatarCacheAdapter', () => {
    beforeEach(() => {
        vi.mocked(backend.assetBundle.CheckVRChatCache).mockReset();
        vi.mocked(vrchatAuthRepository.getConfig).mockReset();
    });

    it('reads avatar cache info using resolved bundle args', async () => {
        vi.mocked(vrchatAuthRepository.getConfig).mockResolvedValue({
            json: { sdkUnityVersion: '2022.3.6f1' }
        });
        vi.mocked(backend.assetBundle.CheckVRChatCache).mockResolvedValue({
            Item1: 2097152,
            Item2: true,
            Item3: 'C:/cache/avatar'
        });

        await expect(
            readAvatarCacheInfo(
                {
                    unityPackages: [
                        {
                            platform: 'standalonewindows',
                            variant: 'security',
                            unitySortNumber: '20220306000',
                            assetUrl:
                                'https://api.vrchat.cloud/api/1/file/file_cache/4/file?v=8'
                        }
                    ]
                },
                'https://api.example.test'
            )
        ).resolves.toEqual({
            inCache: true,
            cacheSize: '2.00 MB',
            cacheLocked: true,
            cachePath: 'C:/cache/avatar'
        });
        expect(vrchatAuthRepository.getConfig).toHaveBeenCalledWith({
            endpoint: 'https://api.example.test'
        });
        expect(backend.assetBundle.CheckVRChatCache).toHaveBeenCalledWith(
            'file_cache',
            4,
            'security',
            8
        );
    });

    it('returns empty cache info without checking cache when no bundle args can be resolved', async () => {
        vi.mocked(vrchatAuthRepository.getConfig).mockResolvedValue({
            json: { sdkUnityVersion: '' }
        });

        await expect(
            readAvatarCacheInfo({ assetUrl: '' }, '')
        ).resolves.toEqual(defaultAvatarSideData().cache);
        expect(backend.assetBundle.CheckVRChatCache).not.toHaveBeenCalled();
    });

    it('reads cache info with unfiltered bundle args when config lookup fails', async () => {
        vi.mocked(vrchatAuthRepository.getConfig).mockRejectedValue(
            new Error('offline')
        );
        vi.mocked(backend.assetBundle.CheckVRChatCache).mockResolvedValue({
            item1: 1048576,
            item2: false,
            item3: 'C:/cache/fallback'
        });

        await expect(
            readAvatarCacheInfo(
                {
                    unityPackages: [
                        {
                            platform: 'standalonewindows',
                            variant: 'standard',
                            unitySortNumber: '20220307000',
                            assetUrl:
                                'https://api.vrchat.cloud/api/1/file/file_config-fallback/6/file'
                        }
                    ]
                },
                'https://api.example.test'
            )
        ).resolves.toEqual({
            inCache: true,
            cacheSize: '1.00 MB',
            cacheLocked: false,
            cachePath: 'C:/cache/fallback'
        });
        expect(backend.assetBundle.CheckVRChatCache).toHaveBeenCalledWith(
            'file_config-fallback',
            6,
            'security',
            0
        );
    });
});
