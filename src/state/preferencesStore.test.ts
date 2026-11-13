import { describe, expect, it } from 'vitest';

import { TRUST_COLOR_DEFAULTS } from '@/shared/constants/trustColors';

import {
    DEFAULT_PREFERENCES,
    normalizePreferenceSnapshot,
    normalizeTableLimits,
    normalizeTablePageSizes
} from './preferencesStore';

describe('preferencesStore normalizers', () => {
    it('shows Friend Log notification dots by default and preserves an explicit opt-out', () => {
        expect(DEFAULT_PREFERENCES.friendLogNotificationDot).toBe(true);
        expect(normalizePreferenceSnapshot({}).friendLogNotificationDot).toBe(
            true
        );
        expect(
            normalizePreferenceSnapshot({ friendLogNotificationDot: false })
                .friendLogNotificationDot
        ).toBe(false);
    });

    it('shows every user dialog appearance layer by default and preserves explicit opt-outs', () => {
        const defaults = {
            showUserDialogProfileBackground: true,
            showUserDialogAvatarFrame: true,
            showUserDialogProfileEffect: true,
            showUserDialogNameplateEffect: true
        };

        expect(DEFAULT_PREFERENCES).toMatchObject(defaults);
        expect(normalizePreferenceSnapshot({})).toMatchObject(defaults);
        expect(
            normalizePreferenceSnapshot({
                showUserDialogProfileBackground: false,
                showUserDialogAvatarFrame: false,
                showUserDialogProfileEffect: false,
                showUserDialogNameplateEffect: false
            })
        ).toMatchObject({
            showUserDialogProfileBackground: false,
            showUserDialogAvatarFrame: false,
            showUserDialogProfileEffect: false,
            showUserDialogNameplateEffect: false
        });
    });

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

    it('keeps background mode delay disabled with a bounded minute default', () => {
        expect(DEFAULT_PREFERENCES.backgroundModeDelayEnabled).toBe(false);
        expect(DEFAULT_PREFERENCES.backgroundModeDelayMinutes).toBe(60);
        expect(normalizePreferenceSnapshot({})).toMatchObject({
            backgroundModeDelayEnabled: false,
            backgroundModeDelayMinutes: 60
        });
        expect(
            normalizePreferenceSnapshot({
                backgroundModeDelayEnabled: 'true',
                backgroundModeDelayMinutes: '5'
            })
        ).toMatchObject({
            backgroundModeDelayEnabled: true,
            backgroundModeDelayMinutes: 10
        });
        expect(
            normalizePreferenceSnapshot({
                backgroundModeDelayMinutes: '9999'
            }).backgroundModeDelayMinutes
        ).toBe(600);
        expect(
            normalizePreferenceSnapshot({
                backgroundModeDelayMinutes: 'bad'
            }).backgroundModeDelayMinutes
        ).toBe(60);
    });

    it('shows the desktop overlay background at 55% opacity and keeps it within 0-100%', () => {
        expect(DEFAULT_PREFERENCES.desktopWidgetNewestOnTop).toBe(true);
        expect(
            normalizePreferenceSnapshot({ desktopWidgetNewestOnTop: false })
                .desktopWidgetNewestOnTop
        ).toBe(false);
        expect(DEFAULT_PREFERENCES.desktopWidgetOpacity).toBe(55);
        expect(normalizePreferenceSnapshot({}).desktopWidgetOpacity).toBe(55);
        expect(
            normalizePreferenceSnapshot({ desktopWidgetOpacity: 'bad' })
                .desktopWidgetOpacity
        ).toBe(55);
        expect(
            normalizePreferenceSnapshot({ desktopWidgetOpacity: 140 })
                .desktopWidgetOpacity
        ).toBe(100);
        expect(
            normalizePreferenceSnapshot({ desktopWidgetOpacity: -5 })
                .desktopWidgetOpacity
        ).toBe(0);
        expect(
            normalizePreferenceSnapshot({ desktopWidgetOpacity: 30 })
                .desktopWidgetOpacity
        ).toBe(30);
    });

    it('keeps the desktop overlay activity filters separate from desktop notification filters', () => {
        const widgetFilters = {
            version: 1,
            types: {
                Online: {
                    scope: 'allFavorites' as const,
                    favoriteGroupKeys: 'all'
                }
            }
        };

        expect(DEFAULT_PREFERENCES.desktopWidgetActivityFilters).toEqual({
            version: 1,
            types: {}
        });
        const snapshot = normalizePreferenceSnapshot({
            desktopWidgetActivityFilters: widgetFilters
        });
        expect(snapshot.desktopWidgetActivityFilters).toEqual(widgetFilters);
        expect(snapshot.desktopNotificationActivityFilters).toEqual({
            version: 1,
            types: {}
        });
    });

    it('keeps auth recovery webhook events enabled by default', () => {
        expect(DEFAULT_PREFERENCES.webhookAuthEventsEnabled).toBe(true);
        expect(normalizePreferenceSnapshot({}).webhookAuthEventsEnabled).toBe(
            true
        );
        expect(
            normalizePreferenceSnapshot({
                webhookAuthEventsEnabled: false
            }).webhookAuthEventsEnabled
        ).toBe(false);
    });

    it('keeps reduced motion and blur disabled by default', () => {
        expect(DEFAULT_PREFERENCES.reducedMotionAndBlur).toBe(false);
        expect(normalizePreferenceSnapshot({}).reducedMotionAndBlur).toBe(
            false
        );
        expect(
            normalizePreferenceSnapshot({
                reducedMotionAndBlur: 'true'
            }).reducedMotionAndBlur
        ).toBe(true);
    });

    it('keeps proxy enabled separate from the proxy address', () => {
        expect(DEFAULT_PREFERENCES.proxyEnabled).toBe(false);
        expect(normalizePreferenceSnapshot({}).proxyEnabled).toBe(false);
        expect(
            normalizePreferenceSnapshot({
                proxyEnabled: true,
                proxyServer: ''
            })
        ).toMatchObject({
            proxyEnabled: true,
            proxyServer: ''
        });
    });

    it('accepts only supported avatar cleanup retention values', () => {
        for (const value of ['Off', '30', '90', '180', '365']) {
            expect(
                normalizePreferenceSnapshot({ avatarAutoCleanup: value })
                    .avatarAutoCleanup
            ).toBe(value);
        }
        for (const value of ['', '0', '31', ' 30 ', 'invalid', 30]) {
            expect(
                normalizePreferenceSnapshot({ avatarAutoCleanup: value })
                    .avatarAutoCleanup
            ).toBe('Off');
        }
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

    it('coerces persisted preference snapshots into safe runtime values', () => {
        const snapshot = normalizePreferenceSnapshot({
            notificationLayout: 'table',
            dataTableStriped: 'true',
            tableDensity: 'tiny',
            reducedMotionAndBlur: 'true',
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
            hmdNotificationsEnabled: 'true',
            hmdNotificationStartMode: 'steamvr',
            hmdNotificationTimeout: 999999,
            hmdNotificationOpacity: -1,
            hmdNotificationPosition: 'right',
            hmdNotificationStyle: 'compact',
            tableLimits: {
                maxTableSize: 5,
                searchLimit: 999999
            },
            localFavoriteFriendsGroups: ['VIP', '', null],
            trustColor: {
                basic: '#abcdef',
                known: 'bad'
            },
            translationAPIType: 'openai',
            translationAPIModel: '',
            translationAPIPrompt: null
        });

        expect(snapshot).toMatchObject({
            notificationLayout: 'table',
            dataTableStriped: true,
            tableDensity: 'standard',
            reducedMotionAndBlur: true,
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
            hmdNotificationsEnabled: true,
            hmdNotificationStartMode: 'steamvr',
            hmdNotificationTimeout: 30000,
            hmdNotificationOpacity: 0,
            hmdNotificationPosition: 'bottom',
            hmdNotificationStyle: 'compact',
            translationAPIType: 'openai',
            translationAPIModel: '',
            translationAPIPrompt: ''
        });
        expect(snapshot.trustColor.basic).toBe('#ABCDEF');
        expect(snapshot.trustColor.known).toBe(TRUST_COLOR_DEFAULTS.known);
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
                hmdNotificationStartMode: 'invalid',
                wristOverlayButton: 'trigger'
            })
        ).toMatchObject({
            wristOverlayStartMode: 'vrchatVrMode',
            hmdNotificationStartMode: 'vrchatVrMode',
            wristOverlayButton: 'grip'
        });
    });
});
