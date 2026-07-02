import { describe, expect, it } from 'vitest';

import {
    DEFAULT_PREFERENCES,
    normalizeOverlayActivityFilters,
    normalizePreferenceSnapshot,
    normalizeSharedFeedFilters,
    normalizeTableLimits,
    normalizeTablePageSizes,
    parseSharedFeedFilters
} from './preferencesStore';

describe('preferencesStore normalizers', () => {
    it('keeps startup auto update enabled by default', () => {
        expect(DEFAULT_PREFERENCES.autoInstallUpdatesOnStartup).toBe(true);
        expect(
            normalizePreferenceSnapshot({}).autoInstallUpdatesOnStartup
        ).toBe(true);
        expect(
            normalizePreferenceSnapshot({
                autoInstallUpdatesOnStartup: false
            }).autoInstallUpdatesOnStartup
        ).toBe(false);
    });

    it('keeps background update downloads disabled by default', () => {
        expect(DEFAULT_PREFERENCES.autoBackgroundDownloadUpdates).toBe(false);
        expect(
            normalizePreferenceSnapshot({}).autoBackgroundDownloadUpdates
        ).toBe(false);
        expect(
            normalizePreferenceSnapshot({
                autoBackgroundDownloadUpdates: true
            }).autoBackgroundDownloadUpdates
        ).toBe(true);
    });

    it('keeps custom font selector fields round-trippable', () => {
        expect(DEFAULT_PREFERENCES.customFontPrimary).toBe('');
        expect(DEFAULT_PREFERENCES.customFontSecondary).toBe('');
        expect(DEFAULT_PREFERENCES.customFontOverride).toBe('');

        expect(
            normalizePreferenceSnapshot({
                customFontPrimary: 'Segoe UI',
                customFontSecondary: 'Noto Sans JP',
                customFontOverride: "'Manual Font', serif"
            })
        ).toMatchObject({
            customFontPrimary: 'Segoe UI',
            customFontSecondary: 'Noto Sans JP',
            customFontOverride: "'Manual Font', serif"
        });
    });

    it('normalizes table page sizes into a positive sorted unique list', () => {
        expect(
            normalizeTablePageSizes(['50', 10, 'bad', 10, 0, 1001, 25])
        ).toEqual([10, 25, 50]);
        expect(normalizeTablePageSizes([])).toEqual(
            DEFAULT_PREFERENCES.tablePageSizes
        );
        expect(normalizeTablePageSizes('not an array')).toEqual(
            DEFAULT_PREFERENCES.tablePageSizes
        );
    });

    it('normalizes hidden feed users into a unique user id list', () => {
        expect(
            normalizePreferenceSnapshot({
                feedHiddenUsers: [
                    'usr_alice',
                    { userId: '' },
                    null,
                    { userId: 'usr_alice' },
                    ' usr_bob '
                ]
            }).feedHiddenUsers
        ).toEqual(['usr_alice', 'usr_bob']);
    });

    it('clamps table limits to supported bounds with defaults for invalid values', () => {
        expect(
            normalizeTableLimits({
                maxTableSize: 50,
                searchLimit: 200000
            })
        ).toEqual({
            maxTableSize: 100,
            searchLimit: 100000
        });

        expect(
            normalizeTableLimits({
                maxTableSize: 'bad',
                searchLimit: null
            })
        ).toEqual(DEFAULT_PREFERENCES.tableLimits);
    });

    it('merges shared feed filters from objects and JSON strings', () => {
        expect(
            normalizeSharedFeedFilters({
                noty: {
                    GPS: 'Friends'
                }
            }).noty.GPS
        ).toBe('Friends');

        expect(
            parseSharedFeedFilters(
                JSON.stringify({
                    wrist: {
                        AvatarChange: 'VIP'
                    }
                })
            )
        ).toEqual(DEFAULT_PREFERENCES.sharedFeedFilters);

        expect(parseSharedFeedFilters('{bad json')).toEqual(
            DEFAULT_PREFERENCES.sharedFeedFilters
        );
    });

    it('normalizes overlay activity filters from persisted snapshots', () => {
        const filters = normalizeOverlayActivityFilters({
            wrist: {
                types: {
                    OnPlayerJoined: {
                        scope: 'everyoneInInstance',
                        favoriteGroupKeys: ['group_2', '', 'group_2']
                    },
                    Online: {
                        scope: 'everyoneInInstance'
                    },
                    'group.queueReady': {
                        scope: 'selectedFavorites',
                        favoriteGroupKeys: ['group_3']
                    },
                    FutureBackendType: {
                        scope: 'selectedFavorites',
                        favoriteGroupKeys: ['group_future', '']
                    }
                }
            }
        });

        expect(filters.wrist.types.OnPlayerJoined).toEqual({
            scope: 'everyoneInInstance',
            favoriteGroupKeys: 'all'
        });
        expect(filters.wrist.types.Online).toEqual({
            scope: 'friends',
            favoriteGroupKeys: 'all'
        });
        expect(filters.wrist.types['group.queueReady']).toEqual({
            scope: 'on',
            favoriteGroupKeys: 'all'
        });
        expect(filters.wrist.types.FutureBackendType).toEqual({
            scope: 'selectedFavorites',
            favoriteGroupKeys: ['group_future']
        });
    });

    it('migrates legacy shared wrist filters when overlay activity filters are missing', () => {
        const snapshot = normalizePreferenceSnapshot({
            sharedFeedFilters: JSON.stringify({
                wrist: {
                    invite: 'VIP',
                    OnPlayerJoined: 'Everyone',
                    friendRequest: 'Off'
                }
            })
        });

        expect(snapshot.overlayActivityFilters.wrist.types.invite).toEqual({
            scope: 'allFavorites',
            favoriteGroupKeys: 'all'
        });
        expect(
            snapshot.overlayActivityFilters.wrist.types.OnPlayerJoined
        ).toEqual({
            scope: 'everyoneInInstance',
            favoriteGroupKeys: 'all'
        });
        expect(
            snapshot.overlayActivityFilters.wrist.types.friendRequest
        ).toEqual({
            scope: 'off',
            favoriteGroupKeys: 'all'
        });
    });

    it('coerces persisted preference snapshots into safe runtime values', () => {
        const snapshot = normalizePreferenceSnapshot({
            notificationLayout: 'table',
            dataTableStriped: 'true',
            tableDensity: 'tiny',
            recentActionCooldownMinutes: '9999',
            autoLoginDelaySeconds: '99',
            weekStartsOn: 2,
            navPanelWidth: 9999,
            tablePageSizes: ['25', '10', '25'],
            wristOverlayStartMode: 'steamvr',
            wristOverlayButton: 'menu',
            wristOverlayHand: 'both',
            wristOverlaySize: 'large',
            wristOverlayDarkBackground: 'false',
            wristOverlayShowDevices: 'true',
            wristOverlayShowBatteryPercent: 'true',
            wristOverlayHidePrivateWorlds: 'true',
            tableLimits: {
                maxTableSize: 5,
                searchLimit: 999999
            },
            localFavoriteFriendsGroups: ['VIP', '', null],
            sharedFeedFilters: JSON.stringify({
                noty: {
                    Online: 'Friends'
                }
            }),
            overlayActivityFilters: JSON.stringify({
                wrist: {
                    favoriteGroupKeys: ['group_1'],
                    categories: {
                        profileChange: {
                            scope: 'allFavorites',
                            favoriteGroupKeys: ['group_2'],
                            typeOverrides: {
                                Avatar: {
                                    scope: 'off'
                                },
                                Bio: {
                                    scope: 'selectedFavorites',
                                    favoriteGroupKeys: ['group_3']
                                }
                            },
                            priority: 'low'
                        }
                    }
                }
            }),
            trustColor: {
                basic: '#abcdef',
                known: 'bad'
            },
            translationAPIType: 'openai',
            translationAPIEndpoint: '',
            translationAPIModel: '',
            translationAPIPrompt: null
        });

        expect(snapshot).toMatchObject({
            notificationLayout: 'table',
            dataTableStriped: true,
            tableDensity: 'standard',
            recentActionCooldownMinutes: 1440,
            autoLoginDelaySeconds: 10,
            weekStartsOn: 1,
            navPanelWidth: 480,
            tablePageSizes: [10, 25],
            tableLimits: {
                maxTableSize: 100,
                searchLimit: 100000
            },
            localFavoriteFriendsGroups: ['VIP'],
            wristOverlayStartMode: 'steamvr',
            wristOverlayButton: 'menu',
            wristOverlayHand: 'both',
            wristOverlaySize: 'large',
            wristOverlayDarkBackground: false,
            wristOverlayShowDevices: true,
            wristOverlayShowBatteryPercent: true,
            wristOverlayHidePrivateWorlds: true,
            translationAPIType: 'openai',
            translationAPIEndpoint: DEFAULT_PREFERENCES.translationAPIEndpoint,
            translationAPIModel: DEFAULT_PREFERENCES.translationAPIModel,
            translationAPIPrompt: ''
        });
        expect(snapshot.sharedFeedFilters.noty.Online).toBe('Friends');
        expect(snapshot.overlayActivityFilters.wrist).toMatchObject({
            types: {
                DisplayName: {
                    scope: 'allFavorites',
                    favoriteGroupKeys: 'all'
                },
                AvatarChange: {
                    scope: 'off',
                    favoriteGroupKeys: 'all'
                },
                Bio: {
                    scope: 'selectedFavorites',
                    favoriteGroupKeys: ['group_3']
                }
            }
        });
        expect(snapshot.trustColor.basic).toBe('#ABCDEF');
        expect(snapshot.trustColor.known).toBe(
            (DEFAULT_PREFERENCES.trustColor as any).known
        );
    });

    it('keeps DeepL translation provider snapshots', () => {
        expect(
            normalizePreferenceSnapshot({
                translationAPIType: 'deepl'
            }).translationAPIType
        ).toBe('deepl');
    });

    it('falls back invalid wrist overlay trigger preferences to defaults', () => {
        expect(
            normalizePreferenceSnapshot({
                wristOverlayStartMode: 'invalid',
                wristOverlayButton: 'trigger'
            })
        ).toMatchObject({
            wristOverlayStartMode: 'vrchatVrMode',
            wristOverlayButton: 'grip'
        });
    });
});
