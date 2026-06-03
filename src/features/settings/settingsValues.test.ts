import { describe, expect, it } from 'vitest';

import { sharedFeedFiltersDefaults } from '@/shared/constants/feedFilters';

import { settingsTabs } from './settingsOptions';
import {
    buildOpenAiModelsEndpoint,
    buildTablePageSizeOptions,
    DEFAULT_TRANSLATION_ENDPOINT,
    filterTablePageSizeOptions,
    formatByteSize,
    isValidFontFamilyList,
    migrateLegacySharedFeedWristFilters,
    normalizeOverlayActivityFilters,
    normalizeSharedFeedFilters,
    normalizeTablePageSizes,
    overlayActivityTypeLabelKey,
    OVERLAY_ACTIVITY_TYPE_DEFINITIONS,
    parseIntegerInput,
    parseWebJson,
    TABLE_PAGE_SIZE_DEFAULTS
} from './settingsValues';

describe('settingsValues', () => {
    it('places the VR settings tab between notifications and media', () => {
        expect(settingsTabs.map(([value]) => value)).toEqual([
            'system',
            'interface',
            'social',
            'notifications',
            'vr',
            'media',
            'integrations',
            'advanced'
        ]);
    });

    it('normalizes table page sizes to the sorted usable choices users can save', () => {
        expect(
            normalizeTablePageSizes(['50', 10, '10', 0, -5, 2000, 'bad', 25])
        ).toEqual([10, 25, 50]);
        expect(normalizeTablePageSizes(['bad', 0])).toEqual(
            TABLE_PAGE_SIZE_DEFAULTS
        );
    });

    it('builds table page size suggestions from defaults and the current draft', () => {
        const options = buildTablePageSizeOptions([12, 50, '75']);

        expect(options).toContain(12);
        expect(options).toContain(1000);
        expect(options.filter((size: any) => size === 50)).toHaveLength(1);
        expect(filterTablePageSizeOptions(options, '5')).toEqual(
            options.filter((size: any) => String(size).includes('5'))
        );
        expect(filterTablePageSizeOptions(options, '')).toEqual(options);
    });

    it('keeps shared feed filters complete while preserving saved overrides', () => {
        const filters = normalizeSharedFeedFilters({
            noty: { displayName: 'Never' },
            wrist: 'invalid'
        });

        expect(filters.noty).toEqual({
            ...sharedFeedFiltersDefaults.noty,
            displayName: 'Never'
        });
        expect((filters as any).wrist).toBeUndefined();
    });

    it('normalizes wrist activity filters with type-specific scopes', () => {
        const filters = normalizeOverlayActivityFilters({
            wrist: {
                types: {
                    invite: {
                        scope: 'selectedFavorites',
                        favoriteGroupKeys: ['group_2', '', 'group_2']
                    },
                    friendRequest: {
                        scope: 'friends',
                        favoriteGroupKeys: ['group_3']
                    },
                    'group.queueReady': {
                        scope: 'everyoneInInstance',
                        favoriteGroupKeys: ['group_4']
                    },
                    OnPlayerJoined: {
                        scope: 'everyoneInInstance',
                        favoriteGroupKeys: ['group_5']
                    },
                    Avatar: {
                        scope: 'selectedFavorites',
                        favoriteGroupKeys: ['group_avatar']
                    },
                    PortalSpawn: {
                        scope: 'everyoneInInstance'
                    },
                    unknown: {
                        scope: 'on'
                    }
                }
            }
        });

        expect(filters).toMatchObject({
            version: 1,
            wrist: {
                types: {
                    invite: {
                        scope: 'selectedFavorites',
                        favoriteGroupKeys: ['group_2']
                    },
                    friendRequest: {
                        scope: 'on',
                        favoriteGroupKeys: 'all'
                    },
                    'group.queueReady': {
                        scope: 'on',
                        favoriteGroupKeys: 'all'
                    },
                    OnPlayerJoined: {
                        scope: 'everyoneInInstance',
                        favoriteGroupKeys: 'all'
                    },
                    AvatarChange: {
                        scope: 'selectedFavorites',
                        favoriteGroupKeys: ['group_avatar']
                    }
                }
            }
        });
        expect(Object.keys(filters.wrist.types)).toHaveLength(
            OVERLAY_ACTIVITY_TYPE_DEFINITIONS.length + 1
        );
        expect(filters.wrist.types.Avatar).toBeUndefined();
        expect(filters.wrist.types.PortalSpawn).toBeUndefined();
        expect(filters.wrist.types.unknown).toEqual({
            scope: 'on',
            favoriteGroupKeys: 'all'
        });
    });

    it('migrates legacy wrist category rules into per-type rules', () => {
        const filters = normalizeOverlayActivityFilters({
            wrist: {
                favoriteGroupKeys: ['group_1'],
                categories: {
                    actionRequired: {
                        scope: 'direct',
                        typeOverrides: {
                            boop: {
                                scope: 'off'
                            },
                            'group.queueReady': {
                                scope: 'criticalOnly'
                            }
                        }
                    },
                    currentInstance: {
                        scope: 'everyone',
                        favoriteGroupKeys: ['group_2']
                    },
                    profileChange: {
                        scope: 'allFavorites',
                        typeOverrides: {
                            Avatar: {
                                scope: 'selectedFavorites',
                                favoriteGroupKeys: ['group_3']
                            }
                        }
                    }
                }
            }
        });

        expect(filters.wrist.types.invite).toEqual({
            scope: 'on',
            favoriteGroupKeys: 'all'
        });
        expect(filters.wrist.types.boop).toEqual({
            scope: 'off',
            favoriteGroupKeys: 'all'
        });
        expect(filters.wrist.types['group.queueReady']).toEqual({
            scope: 'on',
            favoriteGroupKeys: 'all'
        });
        expect(filters.wrist.types.OnPlayerJoined).toEqual({
            scope: 'everyoneInInstance',
            favoriteGroupKeys: 'all'
        });
        expect(filters.wrist.types.DisplayName).toEqual({
            scope: 'allFavorites',
            favoriteGroupKeys: 'all'
        });
        expect(filters.wrist.types.AvatarChange).toEqual({
            scope: 'selectedFavorites',
            favoriteGroupKeys: ['group_3']
        });
        expect(filters.wrist.types.Avatar).toBeUndefined();
        expect(filters.wrist.types.PortalSpawn).toBeUndefined();
    });

    it('migrates legacy shared wrist feed filters into wrist activity filters', () => {
        const filters = migrateLegacySharedFeedWristFilters({
            wrist: {
                invite: 'VIP',
                OnPlayerJoined: 'Everyone',
                friendRequest: 'Off',
                'group.queueReady': 'Friends',
                Location: 'On'
            }
        });

        expect(filters.wrist.types.invite).toEqual({
            scope: 'allFavorites',
            favoriteGroupKeys: 'all'
        });
        expect(filters.wrist.types.OnPlayerJoined).toEqual({
            scope: 'everyoneInInstance',
            favoriteGroupKeys: 'all'
        });
        expect(filters.wrist.types.friendRequest).toEqual({
            scope: 'off',
            favoriteGroupKeys: 'all'
        });
        expect(filters.wrist.types['group.queueReady']).toEqual({
            scope: 'on',
            favoriteGroupKeys: 'all'
        });
        expect((filters.wrist.types as any).Location).toBeUndefined();
    });

    it('maps wrist activity raw type keys to locale-safe label keys', () => {
        expect(overlayActivityTypeLabelKey('group.queueReady')).toBe(
            'group_queueReady'
        );
        expect(overlayActivityTypeLabelKey('instance.closed')).toBe(
            'instance_closed'
        );
        expect(overlayActivityTypeLabelKey('OnPlayerJoined')).toBe(
            'OnPlayerJoined'
        );
    });

    it('builds the OpenAI models endpoint from chat completion endpoints users enter', () => {
        expect(buildOpenAiModelsEndpoint(DEFAULT_TRANSLATION_ENDPOINT)).toBe(
            'https://api.openai.com/v1/models'
        );
        expect(
            buildOpenAiModelsEndpoint(
                'https://proxy.example.test/openai/chat/completions?x=1#top'
            )
        ).toBe('https://proxy.example.test/openai/models');
        expect(buildOpenAiModelsEndpoint('custom-base/chat/completions')).toBe(
            'custom-base/models'
        );
    });

    it('parses JSON responses from web requests regardless of object or text payload shape', () => {
        expect(parseWebJson({ data: { ok: true } })).toEqual({ ok: true });
        expect(parseWebJson({ data: '{"models":["gpt"]}' })).toEqual({
            models: ['gpt']
        });
        expect(parseWebJson({ data: '' })).toEqual({});
    });

    it('validates custom font stacks before they are persisted', () => {
        expect(isValidFontFamilyList('"Comic Sans MS", Arial, system-ui')).toBe(
            true
        );
        expect(isValidFontFamilyList('Noto Sans JP')).toBe(true);
        expect(isValidFontFamilyList('bad;font')).toBe(false);
        expect(isValidFontFamilyList('')).toBe(false);
    });

    it('formats cache sizes into readable units for settings diagnostics', () => {
        expect(formatByteSize(0)).toBe('0 B');
        expect(formatByteSize(512)).toBe('512 B');
        expect(formatByteSize(1536)).toBe('1.50 KB');
        expect(formatByteSize(5 * 1024 * 1024)).toBe('5.00 MB');
    });

    it('uses a fallback when numeric settings input is empty or invalid', () => {
        expect(parseIntegerInput('250', 100)).toBe(250);
        expect(parseIntegerInput('abc', 100)).toBe(100);
    });
});
