import { describe, expect, it } from 'vitest';

import {
    FEED_COLUMNS_DEFAULT_CONFIG,
    copyFeedColumnExclusion,
    sanitizeFeedColumnConfig,
    sanitizeFeedColumnsConfig,
    sanitizeFeedViewMode
} from './feedColumnsState';

describe('feed columns state helpers', () => {
    it('keeps table as the fallback view mode', () => {
        expect(sanitizeFeedViewMode('columns')).toBe('columns');
        expect(sanitizeFeedViewMode('table')).toBe('table');
        expect(sanitizeFeedViewMode('bad')).toBe('table');
    });

    it('provides the accepted default columns without an All column', () => {
        expect(
            FEED_COLUMNS_DEFAULT_CONFIG.map((column) => column.title)
        ).toEqual(['Favorites', 'Location', 'Profile', 'Presence']);
        expect(FEED_COLUMNS_DEFAULT_CONFIG[0]).toMatchObject({
            friendScope: { kind: 'favorites', groupKeys: 'all' }
        });
        expect(
            FEED_COLUMNS_DEFAULT_CONFIG.slice(1).map(
                (column) => column.friendScope
            )
        ).toEqual([
            { kind: 'all', excludedFavoriteGroupKeys: 'all' },
            { kind: 'all', excludedFavoriteGroupKeys: 'all' },
            { kind: 'all', excludedFavoriteGroupKeys: 'all' }
        ]);
    });

    it('sanitizes column scope, types, and width', () => {
        expect(
            sanitizeFeedColumnConfig({
                id: ' bad id ',
                title: '  Custom  ',
                width: 9999,
                friendScope: {
                    kind: 'favorites',
                    groupKeys: ['group-a', '', 'group-a', 'group-b']
                },
                feedTypes: ['GPS', 'Bad', 'Online', 'GPS']
            })
        ).toEqual({
            id: expect.any(String),
            title: 'Custom',
            width: 420,
            friendScope: {
                kind: 'favorites',
                groupKeys: ['group-a', 'group-b']
            },
            feedTypes: ['GPS', 'Online']
        });
    });

    it('expands the legacy Favorites column title', () => {
        expect(
            sanitizeFeedColumnConfig({
                id: 'fav',
                title: 'Fav',
                friendScope: { kind: 'favorites', groupKeys: 'all' },
                feedTypes: ['GPS']
            })
        ).toMatchObject({
            id: 'fav',
            title: 'Favorites'
        });
    });

    it('preserves an explicitly empty selected favorite group scope', () => {
        expect(
            sanitizeFeedColumnConfig({
                id: 'empty-favorites',
                title: 'Empty Favorites',
                friendScope: {
                    kind: 'favorites',
                    groupKeys: []
                },
                feedTypes: ['GPS']
            })
        ).toMatchObject({
            friendScope: {
                kind: 'favorites',
                groupKeys: []
            }
        });
    });

    it('sanitizes selected favorite group exclusions', () => {
        expect(
            sanitizeFeedColumnConfig({
                id: 'excluded-favorites',
                title: 'Excluded Favorites',
                friendScope: {
                    kind: 'all',
                    excludedFavoriteGroupKeys: [
                        'group-a',
                        '',
                        'group-a',
                        'local:group-b'
                    ]
                },
                feedTypes: ['GPS']
            })
        ).toMatchObject({
            friendScope: {
                kind: 'all',
                excludedFavoriteGroupKeys: ['group-a', 'local:group-b']
            }
        });
    });

    it('adds favorite exclusions to legacy default profile and presence presets', () => {
        expect(
            sanitizeFeedColumnsConfig([
                {
                    id: 'profile',
                    title: 'Profile',
                    width: 320,
                    friendScope: { kind: 'all' },
                    feedTypes: ['Status', 'Avatar', 'Bio']
                },
                {
                    id: 'presence',
                    title: 'Presence',
                    width: 320,
                    friendScope: { kind: 'all' },
                    feedTypes: ['Online', 'Offline']
                }
            ]).map((column) => column.friendScope)
        ).toEqual([
            { kind: 'all', excludedFavoriteGroupKeys: 'all' },
            { kind: 'all', excludedFavoriteGroupKeys: 'all' }
        ]);
    });

    it('does not force favorite exclusions onto edited preset-derived columns', () => {
        expect(
            sanitizeFeedColumnConfig({
                id: 'profile',
                title: 'Profile',
                width: 320,
                friendScope: { kind: 'all' },
                feedTypes: ['Status']
            })
        ).toMatchObject({
            friendScope: { kind: 'all' },
            feedTypes: ['Status']
        });
    });

    it('copies exclusions when replacing a column scope base', () => {
        const sourceScope = {
            kind: 'all' as const,
            excludedFavoriteGroupKeys: ['group-a']
        };
        const nextScope = copyFeedColumnExclusion(sourceScope, {
            kind: 'favorites',
            groupKeys: 'all'
        });

        expect(nextScope).toEqual({
            kind: 'favorites',
            groupKeys: 'all',
            excludedFavoriteGroupKeys: ['group-a']
        });
        sourceScope.excludedFavoriteGroupKeys.push('group-b');
        expect(nextScope).toEqual({
            kind: 'favorites',
            groupKeys: 'all',
            excludedFavoriteGroupKeys: ['group-a']
        });
    });

    it('falls back to defaults when persisted columns are unusable', () => {
        expect(sanitizeFeedColumnsConfig([])).toEqual(
            FEED_COLUMNS_DEFAULT_CONFIG
        );
        expect(
            sanitizeFeedColumnsConfig([{ title: '', feedTypes: [] }])
        ).toEqual(FEED_COLUMNS_DEFAULT_CONFIG);
    });
});
