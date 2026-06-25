import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    checkVRChatCache: vi.fn(),
    getConfig: vi.fn()
}));

vi.mock('@/repositories/assetBundleRepository', () => ({
    assetBundleRepository: {
        checkVRChatCache: mocks.checkVRChatCache
    },
    default: {
        checkVRChatCache: mocks.checkVRChatCache
    }
}));

vi.mock('@/repositories/vrchatAuthRepository', () => ({
    default: {
        getConfig: mocks.getConfig
    }
}));

import { assetBundleRepository } from '@/repositories/assetBundleRepository';

import {
    defaultWorldCacheInfo,
    readWorldCacheInfo,
    resolveWorldAssetBundleArgs
} from './worldAssetBundle';

function assetUrl(fileId: any, version: any, variantVersion: any = 0) {
    return `https://api.vrchat.cloud/api/1/file/${fileId}/${version}/file?v=${variantVersion}`;
}

describe('worldAssetBundle', () => {
    it('returns the stable default cache info shape', () => {
        expect(defaultWorldCacheInfo()).toEqual({
            inCache: false,
            cacheSize: '',
            cacheLocked: false,
            cachePath: ''
        });
    });

    it('selects the newest compatible standalone windows package from the end', () => {
        const args = resolveWorldAssetBundleArgs(
            {
                unityPackages: [
                    {
                        platform: 'standalonewindows',
                        assetUrl: assetUrl('file_old', 1, 2),
                        variant: 'standard',
                        unitySortNumber: '20220305000'
                    },
                    {
                        platform: 'android',
                        assetUrl: assetUrl('file_android', 3, 4),
                        variant: 'standard',
                        unitySortNumber: '20220305000'
                    },
                    {
                        platform: 'standalonewindows',
                        assetUrl: assetUrl('file_new', 5, 6),
                        variant: 'security',
                        unitySortNumber: '20220306000'
                    }
                ]
            },
            '2022.3.6f1'
        );

        expect(args).toEqual({
            fileId: 'file_new',
            fileVersion: 5,
            variant: 'security',
            variantVersion: 6
        });
    });

    it('falls back to no SDK filtering when every package is newer than the SDK', () => {
        const args = resolveWorldAssetBundleArgs(
            {
                unityPackages: [
                    {
                        platform: 'standalonewindows',
                        assetUrl: assetUrl('file_future', 7),
                        variant: 'standard',
                        unitySortNumber: '20220307000'
                    }
                ]
            },
            '2022.3.6f1'
        );

        expect(args).toEqual({
            fileId: 'file_future',
            fileVersion: 7,
            variant: 'security',
            variantVersion: 0
        });
    });

    it('ignores unsupported variants and invalid asset URLs', () => {
        expect(
            resolveWorldAssetBundleArgs({
                unityPackages: [
                    {
                        platform: 'standalonewindows',
                        assetUrl: assetUrl('file_impostor', 1),
                        variant: 'impostor'
                    }
                ]
            })
        ).toBeNull();

        expect(
            resolveWorldAssetBundleArgs({
                unityPackages: [
                    {
                        platform: 'standalonewindows',
                        assetUrl: 'https://example.com/no-version',
                        variant: 'standard'
                    }
                ]
            })
        ).toBeNull();
    });

    it('uses the world assetUrl when the selected unity package lacks one', () => {
        expect(
            resolveWorldAssetBundleArgs({
                assetUrl: assetUrl('file_world', 8, 9),
                unityPackages: [
                    {
                        platform: 'standalonewindows',
                        variant: 'standard'
                    }
                ]
            })
        ).toEqual({
            fileId: 'file_world',
            fileVersion: 8,
            variant: 'security',
            variantVersion: 9
        });
    });

    it('reads visible VRChat cache size, lock state, and cache path', async () => {
        vi.mocked(assetBundleRepository.checkVRChatCache).mockResolvedValue({
            Item1: 2 * 1048576,
            Item2: true,
            Item3: 'C:\\VRChat\\Cache-WindowsPlayer\\asset\\version'
        });

        await expect(
            readWorldCacheInfo(
                {
                    assetUrl: assetUrl('file_world', 8, 9),
                    unityPackages: [
                        {
                            platform: 'standalonewindows',
                            variant: 'standard'
                        }
                    ]
                },
                '',
                '2022.3.6f1'
            )
        ).resolves.toEqual({
            inCache: true,
            cacheSize: '2.00 MB',
            cacheLocked: true,
            cachePath: 'C:\\VRChat\\Cache-WindowsPlayer\\asset\\version'
        });

        expect(assetBundleRepository.checkVRChatCache).toHaveBeenCalledWith(
            'file_world',
            8,
            'security',
            9
        );
    });
});
