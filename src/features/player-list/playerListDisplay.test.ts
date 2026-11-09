import { describe, expect, it } from 'vitest';

import { onlinePresence } from '@/test/presenceFixtures';

import {
    getHomeWorldId,
    getWorldImage,
    resolvePlatformMeta,
    resolvePlatformMode,
    resolveStatusMeta
} from './playerListDisplay';

describe('playerListDisplay', () => {
    it('shows normalized platform labels and compact mode labels', () => {
        expect(resolvePlatformMeta('standalonewindows')).toMatchObject({
            label: 'PC'
        });
        expect(resolvePlatformMeta('quest')).toMatchObject({
            label: 'Android'
        });
        expect(resolvePlatformMeta('ios')).toMatchObject({
            label: 'iOS'
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

    it('renders the current player from the realtime presence view over stale raw fields', () => {
        expect(
            resolveStatusMeta({
                isCurrentUser: true,
                location: 'offline',
                state: 'offline',
                status: 'active',
                $presence: onlinePresence('wrld_live:123'),
                statusDescription: 'Me'
            }).statusDotClassName
        ).toBe('user-status-indicator online bg-[var(--status-online)]');
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

    it('formats world header images', () => {
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
    });
});
