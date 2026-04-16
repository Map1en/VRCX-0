import { describe, expect, it } from 'vitest';

import {
    collectMyAvatarTags,
    filterMyAvatars,
    matchesMyAvatarsPlatformFilter,
    toggleMyAvatarsTagFilter
} from './myAvatarsFilters.js';

function avatarWithPlatforms(...platforms) {
    return {
        unityPackages: platforms.map((platform) => ({
            platform,
            variant: 'standard'
        }))
    };
}

describe('myAvatarsFilters', () => {
    it('adds and removes tag filters without mutating the current selection', () => {
        const current = new Set(['favorite']);

        const added = toggleMyAvatarsTagFilter(current, 'quest');
        expect([...added]).toEqual(['favorite', 'quest']);
        expect([...current]).toEqual(['favorite']);

        const removed = toggleMyAvatarsTagFilter(added, 'favorite');
        expect([...removed]).toEqual(['quest']);
        expect([...added]).toEqual(['favorite', 'quest']);
    });

    it('shows the tag filter menu as a sorted unique list of avatar tags', () => {
        expect(
            collectMyAvatarTags([
                {
                    $tags: [
                        { tag: 'quest' },
                        { tag: 'favorite' }
                    ]
                },
                {
                    $tags: [
                        { tag: 'favorite' },
                        { tag: 'public' },
                        { tag: '' }
                    ]
                },
                {}
            ])
        ).toEqual(['favorite', 'public', 'quest']);
    });

    it('matches avatars by the selected platform filter', () => {
        const allPlatforms = avatarWithPlatforms(
            'standalonewindows',
            'android',
            'ios'
        );

        expect(matchesMyAvatarsPlatformFilter(allPlatforms, 'all')).toBe(true);
        expect(matchesMyAvatarsPlatformFilter(allPlatforms, 'pc')).toBe(true);
        expect(matchesMyAvatarsPlatformFilter(allPlatforms, 'android')).toBe(
            true
        );
        expect(matchesMyAvatarsPlatformFilter(allPlatforms, 'ios')).toBe(true);
        expect(
            matchesMyAvatarsPlatformFilter(avatarWithPlatforms('android'), 'pc')
        ).toBe(false);
    });

    it('ignores unsupported package variants when filtering by platform', () => {
        const avatar = {
            unityPackages: [
                {
                    platform: 'standalonewindows',
                    variant: 'impostor'
                },
                {
                    platform: 'android',
                    variant: 'security'
                }
            ]
        };

        expect(matchesMyAvatarsPlatformFilter(avatar, 'pc')).toBe(false);
        expect(matchesMyAvatarsPlatformFilter(avatar, 'android')).toBe(true);
    });

    it('returns the avatars a user expects after combining search, visibility, platform, and tags', () => {
        const avatars = [
            {
                id: 'avtr_public_quest',
                name: 'Neon Fox',
                description: 'Dance avatar',
                releaseStatus: 'public',
                $tags: [{ tag: 'favorite' }, { tag: 'quest' }],
                unityPackages: [
                    {
                        platform: 'android',
                        variant: 'standard'
                    }
                ]
            },
            {
                id: 'avtr_private_pc',
                name: 'Midnight Cat',
                description: 'Desktop only',
                releaseStatus: 'private',
                $tags: [{ tag: 'favorite' }],
                unityPackages: [
                    {
                        platform: 'standalonewindows',
                        variant: 'standard'
                    }
                ]
            },
            {
                id: 'avtr_public_pc',
                name: 'Studio Bot',
                description: 'Searchable helper',
                releaseStatus: 'public',
                $tags: [{ tag: 'tooling' }],
                unityPackages: [
                    {
                        platform: 'standalonewindows',
                        variant: 'standard'
                    }
                ]
            }
        ];

        expect(
            filterMyAvatars({
                avatars,
                searchQuery: 'fox',
                platformFilter: 'android',
                releaseStatusFilter: 'public',
                tagFilters: new Set(['favorite'])
            }).map((avatar) => avatar.id)
        ).toEqual(['avtr_public_quest']);

        expect(
            filterMyAvatars({
                avatars,
                searchQuery: 'helper',
                platformFilter: 'all',
                releaseStatusFilter: 'public',
                tagFilters: new Set()
            }).map((avatar) => avatar.id)
        ).toEqual(['avtr_public_pc']);

        expect(
            filterMyAvatars({
                avatars,
                searchQuery: '',
                platformFilter: 'pc',
                releaseStatusFilter: 'all',
                tagFilters: new Set(['favorite'])
            }).map((avatar) => avatar.id)
        ).toEqual(['avtr_private_pc']);
    });
});
