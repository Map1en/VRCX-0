import { describe, expect, it } from 'vitest';

import {
    fileAnalysisSizeForPlatform,
    formatCount,
    getHomeWorldId,
    getLanguageFlagLabel,
    getWorldImage,
    languageClassName,
    resolvePlatformBadge,
    resolvePlatformMeta,
    resolvePlatformMode,
    resolveStatusMeta
} from './playerListDisplay.js';

describe('playerListDisplay', () => {
    it('shows normalized platform labels and compact mode labels', () => {
        expect(resolvePlatformMeta('standalonewindows')).toMatchObject({
            label: 'PC',
            className: 'text-muted-foreground'
        });
        expect(resolvePlatformMeta('quest')).toMatchObject({
            label: 'Android',
            className: 'text-muted-foreground'
        });
        expect(resolvePlatformMeta('ios')).toMatchObject({
            label: 'iOS',
            className: 'text-muted-foreground'
        });
        expect(resolvePlatformMeta('unknown')).toMatchObject({
            label: 'unknown',
            icon: null
        });
        expect(resolvePlatformMeta(42)).toMatchObject({
            label: '42',
            icon: null
        });
        expect(
            resolvePlatformMode({ inVRMode: true, platformLabel: 'PC' })
        ).toBe('VR');
        expect(
            resolvePlatformMode({ inVRMode: false, platformLabel: 'PC' })
        ).toBe('D');
        expect(
            resolvePlatformMode({ inVRMode: false, platformLabel: 'Android' })
        ).toBe('M');
        expect(
            resolvePlatformMode({ inVRMode: null, platformLabel: 'PC' })
        ).toBe('');
    });

    it('chooses status badge variants by relationship while preserving status text', () => {
        expect(
            resolveStatusMeta({
                isCurrentUser: true,
                statusDescription: 'Me',
                status: 'active'
            })
        ).toMatchObject({
            badgeVariant: 'default',
            label: 'Me'
        });
        expect(
            resolveStatusMeta({
                isFavorite: true,
                statusDescription: 'Favorite',
                status: 'join me'
            })
        ).toMatchObject({
            badgeVariant: 'default',
            label: 'Favorite'
        });
        expect(
            resolveStatusMeta({
                isFriend: true,
                statusDescription: 'Friend',
                status: 'ask me'
            })
        ).toMatchObject({
            badgeVariant: 'secondary',
            label: 'Friend'
        });
        expect(
            resolveStatusMeta({ statusDescription: 'Visitor', status: 'busy' })
        ).toMatchObject({
            badgeVariant: 'outline',
            label: 'Visitor'
        });
    });

    it('shows language flags and fallback class names for profile languages', () => {
        expect(getLanguageFlagLabel('eng')).toBe('us');
        expect(languageClassName('language_that_does_not_exist')).toBe(
            'language_that_does_not_exist'
        );
        expect(languageClassName('')).toBe('unknown');
    });

    it('resolves home world ids from location strings and profile objects', () => {
        expect(getHomeWorldId('wrld_home:123')).toBe('wrld_home');
        expect(
            getHomeWorldId({
                worldId: 'wrld_direct',
                location: 'wrld_fallback:1'
            })
        ).toBe('wrld_direct');
        expect(getHomeWorldId({ id: 'wrld_id' })).toBe('wrld_id');
        expect(getHomeWorldId(null)).toBe('');
    });

    it('formats world header counts, images, platform badges, and file sizes', () => {
        expect(formatCount(1234)).toBe('1,234');
        expect(formatCount('not numeric')).toBe('-');
        expect(
            getWorldImage({
                thumbnailImageUrl: 'https://example.test/thumb.png'
            })
        ).toBe('https://example.test/thumb.png');
        expect(
            getWorldImage({
                imageUrl:
                    'https://api.vrchat.cloud/api/1/file/file_01234567-89ab-cdef-0123-456789abcdef/7/file'
            })
        ).toBe(
            'https://api.vrchat.cloud/api/1/image/file_01234567-89ab-cdef-0123-456789abcdef/7/256'
        );
        expect(getWorldImage({})).toBe('');
        expect(resolvePlatformBadge('standalonewindows')).toMatchObject({
            key: 'PC',
            label: 'PC'
        });
        expect(resolvePlatformBadge('android')).toMatchObject({
            key: 'Quest',
            label: 'Android'
        });
        expect(resolvePlatformBadge('ios')).toMatchObject({
            key: 'iOS',
            label: 'iOS'
        });
        expect(resolvePlatformBadge('custom')).toEqual({
            key: 'custom',
            label: 'custom',
            icon: null
        });
        expect(resolvePlatformBadge(42)).toEqual({
            key: 42,
            label: 42,
            icon: null
        });
        expect(
            fileAnalysisSizeForPlatform(
                {
                    standalonewindows: { _fileSize: '100 MB' },
                    android: { _fileSize: '50 MB' },
                    ios: { _fileSize: '30 MB' }
                },
                'PC'
            )
        ).toBe('100 MB');
        expect(
            fileAnalysisSizeForPlatform(
                { android: { _fileSize: '50 MB' } },
                'Quest'
            )
        ).toBe('50 MB');
        expect(
            fileAnalysisSizeForPlatform({ ios: { _fileSize: '30 MB' } }, 'iOS')
        ).toBe('30 MB');
        expect(fileAnalysisSizeForPlatform({}, 'Unknown')).toBe('');
    });
});
