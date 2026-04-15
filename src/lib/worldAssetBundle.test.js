import { describe, expect, it, vi } from 'vitest';

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

import { defaultWorldCacheInfo, resolveWorldAssetBundleArgs } from './worldAssetBundle.js';

function assetUrl(fileId, version, variantVersion = 0) {
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
        expect(resolveWorldAssetBundleArgs({
            unityPackages: [
                {
                    platform: 'standalonewindows',
                    assetUrl: assetUrl('file_impostor', 1),
                    variant: 'impostor'
                }
            ]
        })).toBeNull();

        expect(resolveWorldAssetBundleArgs({
            unityPackages: [
                {
                    platform: 'standalonewindows',
                    assetUrl: 'https://example.com/no-version',
                    variant: 'standard'
                }
            ]
        })).toBeNull();
    });

    it('uses the world assetUrl when the selected unity package lacks one', () => {
        expect(resolveWorldAssetBundleArgs({
            assetUrl: assetUrl('file_world', 8, 9),
            unityPackages: [
                {
                    platform: 'standalonewindows',
                    variant: 'standard'
                }
            ]
        })).toEqual({
            fileId: 'file_world',
            fileVersion: 8,
            variant: 'security',
            variantVersion: 9
        });
    });
});
