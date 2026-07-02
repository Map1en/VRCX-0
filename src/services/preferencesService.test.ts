import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appVrOverlayConfigReload: vi.fn(),
    appLanguageChanged: vi.fn(),
    appRestartApplication: vi.fn(),
    appOverlayActivityDefinitionsGet: vi.fn(),
    appOverlayActivityFiltersReload: vi.fn(),
    appVrOverlayEnabledSet: vi.fn(),
    appReadConfigFile: vi.fn(),
    appWriteConfigFile: vi.fn(),
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
    storageGetString: vi.fn(),
    storageSetString: vi.fn(),
    publishPreferenceChanged: vi.fn(),
    refreshDiscordPresence: vi.fn(),
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
        appVrOverlayConfigReload: mocks.appVrOverlayConfigReload,
        appLanguageChanged: mocks.appLanguageChanged,
        appRestartApplication: mocks.appRestartApplication,
        appOverlayActivityDefinitionsGet:
            mocks.appOverlayActivityDefinitionsGet,
        appOverlayActivityFiltersReload: mocks.appOverlayActivityFiltersReload,
        appVrOverlayEnabledSet: mocks.appVrOverlayEnabledSet,
        appReadConfigFile: mocks.appReadConfigFile,
        appWriteConfigFile: mocks.appWriteConfigFile,
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
        setMany: mocks.setMany
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

vi.mock('./discordPresenceService', () => ({
    refreshDiscordPresence: mocks.refreshDiscordPresence
}));

vi.mock('./recentActionService', () => ({
    configureRecentActionCooldown: mocks.configureRecentActionCooldown,
    readRecentActionCooldown: mocks.readRecentActionCooldown
}));

vi.mock('./themeService', () => ({
    APP_CJK_FONT_PACK_DEFAULT_KEY: 'system',
    APP_FONT_DEFAULT_KEY: 'default',
    applyAppFontPreferences: mocks.applyAppFontPreferences,
    applyThemeColor: mocks.applyThemeColor,
    applyThemeMode: mocks.applyThemeMode,
    applyZoomLevel: mocks.applyZoomLevel,
    getCommunityThemeAppearanceThemeMode:
        mocks.getCommunityThemeAppearanceThemeMode,
    isCommunityThemeAppearanceControlled:
        mocks.isCommunityThemeAppearanceControlled,
    normalizeZoomLevel: (value: unknown) => {
        const parsed = Number(value);
        return Number.isFinite(parsed)
            ? Math.min(500, Math.max(25, Math.trunc(parsed)))
            : 100;
    },
    resolveThemeColor: (value: unknown) =>
        String(value || '').trim() || 'default',
    resolveThemeMode: (value: unknown) =>
        ['system', 'light', 'dark'].includes(String(value))
            ? String(value)
            : 'system'
}));

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
    setDiscordBoolPreference,
    setIntConfigPreference,
    setNotificationLayoutPreference,
    setProxyServerPreference,
    setRecentActionCooldownMinutesPreference,
    setStringConfigPreference,
    setTableDensityPreference,
    setTableLimitsPreference,
    setTablePageSizesPreference,
    setTranslationApiConfigPreference,
    setTrustColorPreference
} from './preferencesService';

function assertPreferenceSetterTypes() {
    setBoolConfigPreference('notificationIconDot', true);
    setBoolConfigPreference('VRCX_notificationIconDot', false);
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
    globalThis.document = {
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
    } as any;

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
        } as any);

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
        mocks.appVrOverlayConfigReload.mockResolvedValue(undefined);
        mocks.appLanguageChanged.mockResolvedValue(undefined);
        mocks.appRestartApplication.mockResolvedValue(undefined);
        mocks.refreshDiscordPresence.mockResolvedValue(undefined);
        mocks.readRecentActionCooldown.mockReturnValue({
            enabled: false,
            minutes: 60
        });
        mocks.isCommunityThemeAppearanceControlled.mockReturnValue(false);
        mocks.getCommunityThemeAppearanceThemeMode.mockReturnValue('dark');
    });

    it('normalizes table page sizes and adjusts the current page size', async () => {
        usePreferencesStore.getState().hydratePreferences({
            ...DEFAULT_PREFERENCES,
            tablePageSize: 20,
            tablePageSizes: [10, 20, 50]
        });

        await expect(
            setTablePageSizesPreference(['50', 10, 'bad', 25, 10])
        ).resolves.toEqual([10, 25, 50]);

        expect(mocks.setArray).toHaveBeenCalledWith(
            'VRCX_tablePageSizes',
            [10, 25, 50]
        );
        expect(mocks.setInt).toHaveBeenCalledWith('VRCX_tablePageSize', 25);
        expect(usePreferencesStore.getState()).toMatchObject({
            tablePageSize: 25,
            tablePageSizes: [10, 25, 50]
        });
        expect(mocks.publishPreferenceChanged).toHaveBeenCalledWith(
            'VRCX_tablePageSize',
            25
        );
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

        expect(mocks.setInt).toHaveBeenCalledWith('maxTableSize_v2', 100);
        expect(mocks.setInt).toHaveBeenCalledWith('searchLimit', 100_000);
        expect(usePreferencesStore.getState().tableLimits).toEqual({
            maxTableSize: 100,
            searchLimit: 100_000
        });
    });

    it('loads preference snapshots with legacy overlay notification keys', async () => {
        mocks.getRawValue.mockImplementation((key: string) =>
            Promise.resolve(
                key === 'VRCX-0_xsNotifications' ||
                    key === 'VRCX-0_notificationTimeout'
                    ? 'legacy'
                    : null
            )
        );
        mocks.getBool.mockImplementation((key: string, fallback = false) =>
            Promise.resolve(
                key === 'VRCX-0_xsNotifications'
                    ? false
                    : key === 'compactTableMode'
                      ? true
                      : Boolean(fallback)
            )
        );
        mocks.getInt.mockImplementation((key: string, fallback = 0) =>
            Promise.resolve(
                key === 'VRCX-0_notificationTimeout' ? 9000 : Number(fallback)
            )
        );
        mocks.appSystemCulture.mockResolvedValue('ja-JP');

        const snapshot = await loadPreferenceSnapshot();

        expect(snapshot).toMatchObject({
            xsNotifications: false,
            notificationTimeout: 9000,
            tableDensity: 'compact',
            dtIsoFormat: false,
            dtHour12: false
        });
        expect(usePreferencesStore.getState()).toMatchObject({
            preferencesHydrated: true,
            xsNotifications: false,
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

    it('normalizes notification layout and syncs shell/store state', async () => {
        await expect(setNotificationLayoutPreference('unknown')).resolves.toBe(
            'notification-center'
        );

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

    it('persists generic bool, string, and int config preferences with typed values', async () => {
        await setBoolConfigPreference('notificationIconDot', false);
        await setStringConfigPreference('desktopToast', 'Always');
        await expect(
            setIntConfigPreference('notificationTimeout', '999999', {
                min: 1000,
                max: 10000,
                fallback: 3000
            })
        ).resolves.toBe(10000);

        expect(mocks.setBool).toHaveBeenCalledWith(
            'notificationIconDot',
            false
        );
        expect(mocks.setString).toHaveBeenCalledWith('desktopToast', 'Always');
        expect(mocks.setInt).toHaveBeenCalledWith('notificationTimeout', 10000);
        expect(usePreferencesStore.getState()).toMatchObject({
            notificationIconDot: false,
            desktopToast: 'Always',
            notificationTimeout: 10000
        });
        expect(mocks.publishPreferenceChanged).toHaveBeenCalledWith(
            'notificationIconDot',
            false
        );
        expect(mocks.publishPreferenceChanged).toHaveBeenCalledWith(
            'desktopToast',
            'Always'
        );
        expect(mocks.publishPreferenceChanged).toHaveBeenCalledWith(
            'notificationTimeout',
            10000
        );
    });

    it('syncs language, document lang, app fonts, and overlay runtime config', async () => {
        mocks.getString.mockImplementation((key: string, fallback = '') => {
            const values: Record<string, string> = {
                VRCX_fontFamily: 'geist',
                VRCX_cjkFontPack: 'noto-sans-sc',
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
            cjkFontPack: 'noto-sans-sc',
            locale: 'ko'
        });
        expect(mocks.appVrOverlayConfigReload).toHaveBeenCalledTimes(1);
        expect(mocks.appLanguageChanged).toHaveBeenCalledWith('ko');
    });

    it('updates DOM classes for table and accessibility preferences', async () => {
        const { classes } = installDocumentStub();

        await setTableDensityPreference('compact');
        await setDataTableStripedPreference(true);
        await setAccessibleStatusIndicatorsPreference(true);

        expect(classes.has('is-compact-table')).toBe(true);
        expect(classes.has('is-striped-table')).toBe(true);
        expect(classes.has('accessible-status-indicators')).toBe(true);
        expect(usePreferencesStore.getState()).toMatchObject({
            tableDensity: 'compact',
            dataTableStriped: true,
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

    it('falls back translation API config fields before writing them together', async () => {
        await expect(
            setTranslationApiConfigPreference({
                bioLanguage: 'ja-JP',
                translationAPIType: 'openai',
                translationAPIKey: '  key  ',
                translationAPIEndpoint: '',
                translationAPIModel: '',
                translationAPIPrompt: null
            })
        ).resolves.toEqual({
            bioLanguage: 'ja',
            translationAPIType: 'openai',
            translationAPIKey: 'key',
            translationEndpointId: '',
            translationAPIEndpoint:
                'https://api.openai.com/v1/chat/completions',
            translationAPIModel: 'gpt-4o-mini',
            translationAPIPrompt: ''
        });

        expect(mocks.setMany).toHaveBeenCalledWith([
            ['bioLanguage', 'ja'],
            ['translationAPIType', 'openai'],
            ['translationAPIKey', 'key'],
            ['translationEndpointId', ''],
            [
                'translationAPIEndpoint',
                'https://api.openai.com/v1/chat/completions'
            ],
            ['translationAPIModel', 'gpt-4o-mini'],
            ['translationAPIPrompt', '']
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
            setDiscordBoolPreference('unknownDiscordKey' as any, true)
        ).rejects.toThrow('Unsupported Discord preference: unknownDiscordKey');

        expect(mocks.setObject).not.toHaveBeenCalled();
        expect(mocks.setBool).not.toHaveBeenCalledWith(
            'unknownDiscordKey',
            true
        );
    });

    it('disables VRChat rich presence when Discord presence is enabled', async () => {
        mocks.appReadConfigFile.mockResolvedValue(
            JSON.stringify({ existing: true })
        );

        await expect(
            setDiscordBoolPreference('discordActive', true)
        ).resolves.toBe(true);

        expect(mocks.setBool).toHaveBeenCalledWith('discordActive', true);
        expect(mocks.appWriteConfigFile).toHaveBeenCalledWith(
            JSON.stringify(
                {
                    existing: true,
                    disableRichPresence: true
                },
                null,
                2
            )
        );
        expect(mocks.refreshDiscordPresence).toHaveBeenCalledWith({
            force: true
        });
        expect(usePreferencesStore.getState().discordActive).toBe(true);
    });

    it('persists proxy server without restarting when requested', async () => {
        await expect(
            setProxyServerPreference('  http://127.0.0.1:8888  ', {
                restart: false
            })
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
