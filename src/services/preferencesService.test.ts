import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appLanguageChanged: vi.fn(),
    appRestartApplication: vi.fn(),
    appNotificationActivityFiltersGet: vi.fn(),
    appNotificationActivityFiltersSet: vi.fn(),
    appVrOverlayEnabledSet: vi.fn(),
    appDisableVrchatRichPresence: vi.fn(),
    appRuntimeDiscordReconcileRequest: vi.fn(),
    appSystemCulture: vi.fn(),
    getRawValue: vi.fn(),
    getBool: vi.fn(),
    getString: vi.fn(),
    getInt: vi.fn(),
    getArray: vi.fn(),
    getObject: vi.fn(),
    setBool: vi.fn(),
    setString: vi.fn(),
    setInt: vi.fn(),
    setArray: vi.fn(),
    setObject: vi.fn(),
    setMany: vi.fn(),
    applyServerEntry: vi.fn(),
    storageGetString: vi.fn(),
    storageSetString: vi.fn(),
    publishPreferenceChanged: vi.fn(),
    configureRecentActionCooldown: vi.fn(),
    readRecentActionCooldown: vi.fn(),
    applyAppFontPreferences: vi.fn(),
    applyThemeColor: vi.fn(),
    applyThemeMode: vi.fn(),
    applyZoomLevel: vi.fn(),
    getCommunityThemeAppearanceThemeMode: vi.fn(),
    isCommunityThemeAppearanceControlled: vi.fn(),
    applyTrustColorClasses: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appLanguageChanged: mocks.appLanguageChanged,
        appRestartApplication: mocks.appRestartApplication,
        appNotificationActivityFiltersGet:
            mocks.appNotificationActivityFiltersGet,
        appNotificationActivityFiltersSet:
            mocks.appNotificationActivityFiltersSet,
        appVrOverlayEnabledSet: mocks.appVrOverlayEnabledSet,
        appDisableVrchatRichPresence: mocks.appDisableVrchatRichPresence,
        appRuntimeDiscordReconcileRequest:
            mocks.appRuntimeDiscordReconcileRequest,
        appSystemCulture: mocks.appSystemCulture
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getRawValue: mocks.getRawValue,
        getBool: mocks.getBool,
        getString: mocks.getString,
        getInt: mocks.getInt,
        getArray: mocks.getArray,
        getObject: mocks.getObject,
        setBool: mocks.setBool,
        setString: mocks.setString,
        setInt: mocks.setInt,
        setArray: mocks.setArray,
        setObject: mocks.setObject,
        setMany: mocks.setMany,
        applyServerEntry: mocks.applyServerEntry
    }
}));

vi.mock('@/repositories/storageRepository', () => ({
    default: {
        getString: mocks.storageGetString,
        setString: mocks.storageSetString
    }
}));

vi.mock('@/shared/events/preferenceEvents', () => ({
    normalizePreferenceKey: (key: unknown) => String(key || '').trim(),
    publishPreferenceChanged: mocks.publishPreferenceChanged
}));

vi.mock('./changelogService', () => ({
    POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY: 'showPostUpdateChangelogToast'
}));

vi.mock('./recentActionService', () => ({
    configureRecentActionCooldown: mocks.configureRecentActionCooldown,
    readRecentActionCooldown: mocks.readRecentActionCooldown
}));

vi.mock('./themeService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./themeService')>();
    return {
        applyAppFontPreferences: mocks.applyAppFontPreferences,
        applyThemeColor: mocks.applyThemeColor,
        applyThemeMode: mocks.applyThemeMode,
        applyZoomLevel: mocks.applyZoomLevel,
        getCommunityThemeAppearanceThemeMode:
            mocks.getCommunityThemeAppearanceThemeMode,
        isCommunityThemeAppearanceControlled:
            mocks.isCommunityThemeAppearanceControlled,
        normalizeAppCjkFontPack: actual.normalizeAppCjkFontPack,
        normalizeAppFontFamily: actual.normalizeAppFontFamily,
        normalizeZoomLevel: actual.normalizeZoomLevel,
        resolveThemeColor: actual.resolveThemeColor,
        resolveThemeMode: actual.resolveThemeMode
    };
});

vi.mock('./trustColorService', () => ({
    applyTrustColorClasses: mocks.applyTrustColorClasses
}));

import type { useSettingsPreferenceActions } from '@/features/settings/useSettingsPreferenceActions';
import {
    DEFAULT_PREFERENCES,
    usePreferencesStore
} from '@/state/preferencesStore';
import { useShellStore } from '@/state/shellStore';

import {
    loadPreferenceSnapshot,
    setAccessibleStatusIndicatorsPreference,
    setAppLanguagePreference,
    setBoolConfigPreference,
    setDataTableStripedPreference,
    setDesktopWidgetActivityFiltersPreference,
    setDiscordBoolPreference,
    setIntConfigPreference,
    setHmdNotificationActivityFiltersPreference,
    setNotificationLayoutPreference,
    setProxyEnabledPreference,
    setProxyServerPreference,
    setRecentActionCooldownMinutesPreference,
    setStringConfigPreference,
    setTableDensityPreference,
    setTableLimitsPreference,
    setTranslationApiConfigPreference,
    setTrustColorPreference
} from './preferencesService';

function assertPreferenceSetterTypes() {
    setBoolConfigPreference('notificationIconDot', true);
    setBoolConfigPreference('VRCX_notificationIconDot', false);
    setBoolConfigPreference('reducedMotionAndBlur', true);
    setStringConfigPreference('desktopToast', 'Always');
    setStringConfigPreference('VRCX_tableDensity', 'compact');
    setIntConfigPreference('notificationTimeout', '3000');
    setIntConfigPreference('VRCX_tablePageSize', 50);

    // @ts-expect-error boolean config values must be boolean.
    setBoolConfigPreference('notificationIconDot', 'false');
    // @ts-expect-error boolean config keys must not use string setters.
    setStringConfigPreference('notificationIconDot', 'false');
    // @ts-expect-error string config keys must not use integer setters.
    setIntConfigPreference('desktopToast', 1);
}

void assertPreferenceSetterTypes;

type SettingsSaveBoolPreference = ReturnType<
    typeof useSettingsPreferenceActions
>['saveBoolPreference'];
type SettingsSaveStringPreference = ReturnType<
    typeof useSettingsPreferenceActions
>['saveStringPreference'];

function assertSettingsPreferenceActionTypes(
    saveBoolPreference: SettingsSaveBoolPreference,
    saveStringPreference: SettingsSaveStringPreference
) {
    saveBoolPreference('notificationIconDot', 'notificationIconDot', true);
    saveStringPreference('desktopToast', 'desktopToast', 'Always');

    // @ts-expect-error settings bool action values must be boolean.
    saveBoolPreference('notificationIconDot', 'notificationIconDot', 'false');
    // @ts-expect-error settings bool action keys must target boolean prefs.
    saveBoolPreference('desktopToast', 'notificationIconDot', true);
    // @ts-expect-error settings string action values must be string.
    saveStringPreference('desktopToast', 'desktopToast', false);
    // @ts-expect-error settings string action keys must target string prefs.
    saveStringPreference('notificationIconDot', 'desktopToast', 'false');
}

void assertSettingsPreferenceActionTypes;

function installDocumentStub() {
    const attributes = new Map<string, string>();
    const classes = new Set<string>();
    vi.stubGlobal('document', {
        documentElement: {
            setAttribute: vi.fn((key: string, value: string) => {
                attributes.set(key, value);
            }),
            getAttribute: vi.fn((key: string) => attributes.get(key) ?? null),
            hasAttribute: vi.fn((key: string) => attributes.has(key)),
            removeAttribute: vi.fn((key: string) => {
                attributes.delete(key);
            }),
            classList: {
                add: vi.fn((name: string) => classes.add(name)),
                remove: vi.fn((name: string) => classes.delete(name)),
                toggle: vi.fn((name: string, enabled?: boolean) => {
                    const nextEnabled =
                        enabled === undefined ? !classes.has(name) : enabled;
                    if (nextEnabled) {
                        classes.add(name);
                    } else {
                        classes.delete(name);
                    }
                    return nextEnabled;
                }),
                contains: vi.fn((name: string) => classes.has(name))
            },
            style: {
                setProperty: vi.fn(),
                removeProperty: vi.fn()
            }
        }
    });

    return { attributes, classes };
}

describe('preferencesService characterization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        installDocumentStub();
        usePreferencesStore.getState().hydratePreferences(DEFAULT_PREFERENCES);
        useShellStore.setState({
            locale: 'en',
            tableDensity: 'standard',
            notificationLayout: 'notification-center',
            navWidth: 240
        });

        mocks.getRawValue.mockResolvedValue(null);
        mocks.getBool.mockImplementation((_key: string, fallback = false) =>
            Promise.resolve(Boolean(fallback))
        );
        mocks.getString.mockImplementation((_key: string, fallback = '') =>
            Promise.resolve(String(fallback ?? ''))
        );
        mocks.getInt.mockImplementation((_key: string, fallback = 0) =>
            Promise.resolve(Number(fallback))
        );
        mocks.getArray.mockImplementation((_key: string, fallback: unknown[]) =>
            Promise.resolve(fallback)
        );
        mocks.getObject.mockImplementation((_key: string, fallback: unknown) =>
            Promise.resolve(fallback)
        );
        mocks.setBool.mockResolvedValue(undefined);
        mocks.setString.mockResolvedValue(undefined);
        mocks.setInt.mockResolvedValue(undefined);
        mocks.setArray.mockResolvedValue(undefined);
        mocks.setObject.mockResolvedValue(undefined);
        mocks.setMany.mockResolvedValue(undefined);
        mocks.storageGetString.mockImplementation(
            (_key: string, fallback = '') =>
                Promise.resolve(String(fallback ?? ''))
        );
        mocks.storageSetString.mockResolvedValue(undefined);
        mocks.appNotificationActivityFiltersGet.mockResolvedValue({
            wrist: { version: 1, types: {} },
            vr: { version: 1, types: {} },
            hmd: { version: 1, types: {} },
            desktop: { version: 1, types: {} },
            webhook: { version: 1, types: {} },
            tts: { version: 1, types: {} },
            widget: { version: 1, types: {} }
        });
        mocks.appLanguageChanged.mockResolvedValue(undefined);
        mocks.appRestartApplication.mockResolvedValue(undefined);
        mocks.appDisableVrchatRichPresence.mockResolvedValue({ changed: true });
        mocks.appRuntimeDiscordReconcileRequest.mockResolvedValue(1);
        mocks.readRecentActionCooldown.mockReturnValue({
            enabled: false,
            minutes: 60
        });
        mocks.isCommunityThemeAppearanceControlled.mockReturnValue(false);
        mocks.getCommunityThemeAppearanceThemeMode.mockReturnValue('dark');
    });

    it('clamps table limits before persistence and store patching', async () => {
        await expect(
            setTableLimitsPreference({
                maxTableSize: 5,
                searchLimit: 999_999
            })
        ).resolves.toEqual({
            maxTableSize: 100,
            searchLimit: 100_000
        });

        expect(mocks.setMany).toHaveBeenCalledWith([
            ['maxTableSize_v2', '100'],
            ['searchLimit', '100000']
        ]);
        expect(usePreferencesStore.getState().tableLimits).toEqual({
            maxTableSize: 100,
            searchLimit: 100_000
        });
    });

    it('loads preference snapshots and syncs shell state', async () => {
        mocks.getBool.mockImplementation((key: string, fallback = false) =>
            Promise.resolve(
                key === 'xsNotifications' || key === 'compactTableMode'
                    ? true
                    : Boolean(fallback)
            )
        );
        mocks.getInt.mockImplementation((key: string, fallback = 0) =>
            Promise.resolve(
                key === 'notificationTimeout' ? 9000 : Number(fallback)
            )
        );
        mocks.appSystemCulture.mockResolvedValue('ja-JP');

        const snapshot = await loadPreferenceSnapshot();

        expect(snapshot).toMatchObject({
            xsNotifications: true,
            notificationTimeout: 9000,
            tableDensity: 'compact',
            dtIsoFormat: false,
            dtHour12: false
        });
        expect(usePreferencesStore.getState()).toMatchObject({
            preferencesHydrated: true,
            xsNotifications: true,
            notificationTimeout: 9000,
            tableDensity: 'compact'
        });
        expect(useShellStore.getState()).toMatchObject({
            tableDensity: 'compact',
            dateCulture: 'ja-JP'
        });
        expect(document.documentElement.setAttribute).toHaveBeenCalledWith(
            'lang',
            'en'
        );
    });

    it('stores notification layout and syncs shell/store state', async () => {
        await expect(
            setNotificationLayoutPreference('notification-center')
        ).resolves.toBe('notification-center');

        expect(mocks.setString).toHaveBeenCalledWith(
            'notificationLayout',
            'notification-center'
        );
        expect(useShellStore.getState().notificationLayout).toBe(
            'notification-center'
        );
        expect(usePreferencesStore.getState().notificationLayout).toBe(
            'notification-center'
        );
    });

    it('persists generic bool and string config preferences with typed values', async () => {
        await setBoolConfigPreference('notificationIconDot', false);
        await setStringConfigPreference('desktopToast', 'Always');

        expect(mocks.setBool).toHaveBeenCalledWith(
            'notificationIconDot',
            false
        );
        expect(mocks.setString).toHaveBeenCalledWith('desktopToast', 'Always');
        expect(usePreferencesStore.getState()).toMatchObject({
            notificationIconDot: false,
            desktopToast: 'Always'
        });
        expect(mocks.publishPreferenceChanged).toHaveBeenCalledWith(
            'notificationIconDot',
            false
        );
        expect(mocks.publishPreferenceChanged).toHaveBeenCalledWith(
            'desktopToast',
            'Always'
        );
    });

    it('stores the activity filters Rust normalized for the saved surface', async () => {
        const normalized = {
            version: 1,
            types: {
                Online: { scope: 'off' as const, favoriteGroupKeys: 'all' },
                VideoPlay: { scope: 'off' as const, favoriteGroupKeys: 'all' }
            }
        };
        mocks.appNotificationActivityFiltersSet.mockResolvedValue(normalized);

        await expect(
            setHmdNotificationActivityFiltersPreference({
                version: 1,
                types: {
                    Online: { scope: 'off', favoriteGroupKeys: 'all' }
                }
            })
        ).resolves.toEqual(normalized);

        expect(mocks.appNotificationActivityFiltersSet).toHaveBeenCalledWith({
            surface: 'hmd',
            filters: {
                version: 1,
                types: {
                    Online: { scope: 'off', favoriteGroupKeys: 'all' }
                }
            }
        });
        expect(mocks.publishPreferenceChanged).toHaveBeenCalledWith(
            'hmdNotificationActivityFilters',
            normalized
        );
        expect(
            usePreferencesStore.getState().hmdNotificationActivityFilters
        ).toEqual(normalized);
    });

    it('saves the activity shown in the desktop overlay as the widget surface', async () => {
        const filters = {
            version: 1,
            types: {
                Online: {
                    scope: 'allFavorites' as const,
                    favoriteGroupKeys: 'all'
                }
            }
        };
        mocks.appNotificationActivityFiltersSet.mockResolvedValue(filters);

        await expect(
            setDesktopWidgetActivityFiltersPreference(filters)
        ).resolves.toEqual(filters);

        expect(mocks.appNotificationActivityFiltersSet).toHaveBeenCalledWith({
            surface: 'widget',
            filters
        });
        expect(
            usePreferencesStore.getState().desktopWidgetActivityFilters
        ).toEqual(filters);
        expect(
            usePreferencesStore.getState().desktopNotificationActivityFilters
        ).not.toEqual(filters);
    });

    it('syncs language, document lang, app fonts, and overlay runtime config', async () => {
        mocks.getString.mockImplementation((key: string, fallback = '') => {
            const values: Record<string, string> = {
                VRCX_fontFamily: 'geist',
                VRCX_cjkFontPack: 'noto',
                customFontFamily: 'Custom Font'
            };
            return Promise.resolve(values[key] ?? String(fallback ?? ''));
        });

        await setAppLanguagePreference('ko-KR');

        expect(useShellStore.getState().locale).toBe('ko');
        expect(document.documentElement.setAttribute).toHaveBeenCalledWith(
            'lang',
            'ko'
        );
        expect(mocks.setString).toHaveBeenCalledWith('appLanguage', 'ko');
        expect(mocks.applyAppFontPreferences).toHaveBeenCalledWith({
            fontFamily: 'geist',
            customFontFamily: 'Custom Font',
            cjkFontPack: 'noto',
            locale: 'ko'
        });
        expect(mocks.appLanguageChanged).toHaveBeenCalledWith('ko');
    });

    it('updates DOM classes for table and accessibility preferences', async () => {
        const { classes } = installDocumentStub();

        await setTableDensityPreference('compact');
        await setDataTableStripedPreference(true);
        await setBoolConfigPreference('reducedMotionAndBlur', true);
        await setAccessibleStatusIndicatorsPreference(true);

        expect(classes.has('is-compact-table')).toBe(true);
        expect(classes.has('is-striped-table')).toBe(true);
        expect(classes.has('reduce-effects')).toBe(true);
        expect(classes.has('accessible-status-indicators')).toBe(true);
        expect(usePreferencesStore.getState()).toMatchObject({
            tableDensity: 'compact',
            dataTableStriped: true,
            reducedMotionAndBlur: true,
            accessibleStatusIndicators: true
        });
    });

    it('clamps recent action cooldown minutes and preserves enabled state', async () => {
        mocks.readRecentActionCooldown.mockReturnValue({
            enabled: true,
            minutes: 30
        });

        await expect(
            setRecentActionCooldownMinutesPreference('9999')
        ).resolves.toBe(1440);

        expect(mocks.setInt).toHaveBeenCalledWith(
            'recentActionCooldownMinutes',
            1440
        );
        expect(mocks.configureRecentActionCooldown).toHaveBeenCalledWith({
            enabled: true,
            minutes: 1440
        });
        expect(usePreferencesStore.getState().recentActionCooldownMinutes).toBe(
            1440
        );
    });

    it('normalizes translation API config fields before writing them together', async () => {
        await expect(
            setTranslationApiConfigPreference({
                bioLanguage: 'ja-JP',
                translationAPIType: 'openai',
                translationAPIKey: '  key  ',
                translationAPIModel: '',
                translationAPIPrompt: null,
                translationAPIReasoningEffort: ''
            })
        ).resolves.toEqual({
            bioLanguage: 'ja',
            translationAPIType: 'openai',
            translationAPIKey: 'key',
            translationEndpointId: '',
            translationAPIModel: '',
            translationAPIPrompt: '',
            translationAPIReasoningEffort: ''
        });

        expect(mocks.setMany).toHaveBeenCalledWith([
            ['bioLanguage', 'ja'],
            ['translationAPIType', 'openai'],
            ['translationAPIKey', 'key'],
            ['translationEndpointId', ''],
            ['translationAPIModel', ''],
            ['translationAPIPrompt', ''],
            ['translationAPIReasoningEffort', '']
        ]);
    });

    it('persists DeepL as a translation API provider', async () => {
        await expect(
            setTranslationApiConfigPreference({
                bioLanguage: 'en',
                translationAPIType: 'deepl',
                translationAPIKey: '  deepl-key  '
            })
        ).resolves.toMatchObject({
            translationAPIType: 'deepl',
            translationAPIKey: 'deepl-key'
        });

        expect(mocks.setMany).toHaveBeenCalledWith(
            expect.arrayContaining([
                ['translationAPIType', 'deepl'],
                ['translationAPIKey', 'deepl-key']
            ])
        );
        expect(usePreferencesStore.getState().translationAPIType).toBe('deepl');
    });

    it('rejects invalid trust colors and unsupported Discord preference keys', async () => {
        await expect(
            setTrustColorPreference('basic', 'not-a-color')
        ).rejects.toThrow('Invalid color. Use #RRGGBB.');
        await expect(
            setDiscordBoolPreference(
                'unknownDiscordKey' as Parameters<
                    typeof setDiscordBoolPreference
                >[0],
                true
            )
        ).rejects.toThrow('Unsupported Discord preference: unknownDiscordKey');

        expect(mocks.setObject).not.toHaveBeenCalled();
        expect(mocks.setBool).not.toHaveBeenCalledWith(
            'unknownDiscordKey',
            true
        );
    });

    it('disables VRChat rich presence when Discord presence is enabled', async () => {
        await expect(
            setDiscordBoolPreference('discordActive', true)
        ).resolves.toBe(true);

        expect(mocks.appDisableVrchatRichPresence).toHaveBeenCalledTimes(1);
        expect(mocks.setBool).toHaveBeenCalledWith('discordActive', true);
        expect(
            mocks.appDisableVrchatRichPresence.mock.invocationCallOrder[0]
        ).toBeLessThan(mocks.setBool.mock.invocationCallOrder[0]);
        expect(mocks.appRuntimeDiscordReconcileRequest).toHaveBeenCalledTimes(
            1
        );
        expect(usePreferencesStore.getState().discordActive).toBe(true);
    });

    it('does not enable Discord presence when the VRChat config patch fails', async () => {
        mocks.appDisableVrchatRichPresence.mockRejectedValueOnce(
            new Error('config is read-only')
        );

        await expect(
            setDiscordBoolPreference('discordActive', true)
        ).rejects.toThrow('config is read-only');

        expect(mocks.setBool).not.toHaveBeenCalledWith('discordActive', true);
        expect(mocks.appRuntimeDiscordReconcileRequest).toHaveBeenCalledTimes(
            0
        );
        expect(usePreferencesStore.getState().discordActive).toBe(false);
    });

    it('honors explicit disabled proxy state even with a configured address', async () => {
        mocks.storageGetString.mockImplementation(
            (key: string, fallback = '') => {
                if (key === 'VRCX_ProxyEnabled') {
                    return Promise.resolve('false');
                }
                if (key === 'VRCX_ProxyServer') {
                    return Promise.resolve('127.0.0.1:7890');
                }
                return Promise.resolve(String(fallback ?? ''));
            }
        );

        const snapshot = await loadPreferenceSnapshot();

        expect(snapshot.proxyEnabled).toBe(false);
        expect(snapshot.proxyServer).toBe('127.0.0.1:7890');
    });

    it('persists proxy enabled separately without restarting by default', async () => {
        await expect(setProxyEnabledPreference(true)).resolves.toBe(true);

        expect(mocks.storageSetString).toHaveBeenCalledWith(
            'VRCX_ProxyEnabled',
            'true'
        );
        expect(mocks.appRestartApplication).not.toHaveBeenCalled();
        expect(usePreferencesStore.getState().proxyEnabled).toBe(true);
    });

    it('persists proxy server without restarting by default', async () => {
        await expect(
            setProxyServerPreference('  http://127.0.0.1:8888  ')
        ).resolves.toBe('http://127.0.0.1:8888');

        expect(mocks.storageSetString).toHaveBeenCalledWith(
            'VRCX_ProxyServer',
            'http://127.0.0.1:8888'
        );
        expect(mocks.appRestartApplication).not.toHaveBeenCalled();
        expect(usePreferencesStore.getState().proxyServer).toBe(
            'http://127.0.0.1:8888'
        );
    });
});
