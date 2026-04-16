import { describe, expect, it } from 'vitest';

import {
    avatarGalleryImageUrl,
    defaultAvatarSideData,
    isCacheCandidatePackage,
    resolveAssetBundleArgs
} from './avatarAssets.js';

describe('avatarAssets', () => {
    it('creates default side data and resolves gallery image urls', () => {
        expect(defaultAvatarSideData()).toEqual({
            galleryRows: [],
            galleryImages: [],
            fileAnalysis: {},
            cache: {
                inCache: false,
                cacheSize: '',
                cacheLocked: false,
                cachePath: ''
            }
        });

        expect(
            avatarGalleryImageUrl({
                url: 'https://example.test/root.png',
                versions: [
                    { file: { url: 'https://example.test/old.png' } },
                    { file: { url: 'https://example.test/new.png' } }
                ]
            })
        ).toBe('https://example.test/new.png');
        expect(
            avatarGalleryImageUrl({ fileUrl: 'https://example.test/file.png' })
        ).toBe('https://example.test/file.png');
        expect(avatarGalleryImageUrl(null)).toBe('');
    });

    it('filters cache candidate packages by platform, variant, and sdk unity version', () => {
        expect(isCacheCandidatePackage({ platform: 'android' }, '')).toBe(
            false
        );
        expect(
            isCacheCandidatePackage(
                { platform: 'standalonewindows', variant: 'impostor' },
                ''
            )
        ).toBe(false);
        expect(
            isCacheCandidatePackage(
                {
                    platform: 'standalonewindows',
                    variant: 'standard',
                    unitySortNumber: '20220307000'
                },
                '2022.3.6f1'
            )
        ).toBe(false);
        expect(
            isCacheCandidatePackage(
                {
                    platform: 'standalonewindows',
                    variant: 'security',
                    unitySortNumber: '20220306000'
                },
                '2022.3.6f1'
            )
        ).toBe(true);
    });

    it('resolves cache args from the latest matching package and falls back when sdk filtering has no match', () => {
        const avatar = {
            assetUrl:
                'https://api.vrchat.cloud/api/1/file/file_avatar-fallback/9/file',
            unityPackages: [
                {
                    platform: 'standalonewindows',
                    variant: 'standard',
                    unitySortNumber: '20220306000',
                    assetUrl:
                        'https://api.vrchat.cloud/api/1/file/file_old/1/file?v=3'
                },
                {
                    platform: 'standalonewindows',
                    variant: 'security',
                    unitySortNumber: '20220307000',
                    assetUrl:
                        'https://api.vrchat.cloud/api/1/file/file_new/2/file?v=5'
                }
            ]
        };

        expect(resolveAssetBundleArgs(avatar, '2022.3.6f1')).toEqual({
            fileId: 'file_old',
            fileVersion: 1,
            variant: 'security',
            variantVersion: 3
        });
        expect(
            resolveAssetBundleArgs(
                {
                    unityPackages: [avatar.unityPackages[1]]
                },
                '2022.3.6f1'
            )
        ).toEqual({
            fileId: 'file_new',
            fileVersion: 2,
            variant: 'security',
            variantVersion: 5
        });
        expect(
            resolveAssetBundleArgs({ assetUrl: avatar.assetUrl }, '')
        ).toEqual({
            fileId: 'file_avatar-fallback',
            fileVersion: 9,
            variant: 'security',
            variantVersion: 0
        });
        expect(
            resolveAssetBundleArgs({ assetUrl: 'not a file url' }, '')
        ).toBeNull();
    });

    it('falls back to unfiltered package selection when sdk filtering rejects every package', () => {
        expect(
            resolveAssetBundleArgs(
                {
                    unityPackages: [
                        {
                            platform: 'standalonewindows',
                            variant: 'standard',
                            unitySortNumber: '20220307000',
                            assetUrl:
                                'https://api.vrchat.cloud/api/1/file/file_future/2/file?v=5'
                        }
                    ]
                },
                '2022.3.6f1'
            )
        ).toEqual({
            fileId: 'file_future',
            fileVersion: 2,
            variant: 'security',
            variantVersion: 5
        });
    });
});
