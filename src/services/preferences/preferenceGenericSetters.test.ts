import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appLanguageChanged: vi.fn(),
    appRestartApplication: vi.fn(),
    appSetStartup: vi.fn(),
    appVrOverlayConfigReload: vi.fn(),
    getBool: vi.fn(),
    getString: vi.fn(),
    getInt: vi.fn(),
    getArray: vi.fn(),
    setBool: vi.fn(),
    setString: vi.fn(),
    setInt: vi.fn(),
    setArray: vi.fn(),
    setObject: vi.fn(),
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
        appSetStartup: mocks.appSetStartup,
        appVrOverlayConfigReload: mocks.appVrOverlayConfigReload
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getBool: mocks.getBool,
        getString: mocks.getString,
        getInt: mocks.getInt,
        getArray: mocks.getArray,
        setBool: mocks.setBool,
        setString: mocks.setString,
        setInt: mocks.setInt,
        setArray: mocks.setArray,
        setObject: mocks.setObject
    }
}));

vi.mock('@/repositories/storageRepository', () => ({
    default: {
        setString: mocks.storageSetString
    }
}));

vi.mock('@/shared/events/preferenceEvents', () => ({
    normalizePreferenceKey: (key: unknown) =>
        String(key || '')
            .replace(/^VRCX_/, '')
            .trim(),
    publishPreferenceChanged: mocks.publishPreferenceChanged
}));

vi.mock('../recentActionService', () => ({
    configureRecentActionCooldown: mocks.configureRecentActionCooldown,
    readRecentActionCooldown: mocks.readRecentActionCooldown
}));

vi.mock('../themeService', () => ({
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
        value === 'light' || value === 'dark' || value === 'system'
            ? value
            : 'system'
}));

vi.mock('../trustColorService', () => ({
    applyTrustColorClasses: mocks.applyTrustColorClasses
}));

import {
    DEFAULT_PREFERENCES,
    usePreferencesStore
} from '@/state/preferencesStore';
import { useShellStore } from '@/state/shellStore';

import {
    addFeedHiddenUserPreference,
    removeFeedHiddenUserPreference,
    setBoolConfigPreference,
    setIntConfigPreference,
    setStartAtWindowsStartupPreference,
    setTablePageSizesPreference
} from './preferenceGenericSetters';

describe('preferenceGenericSetters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        usePreferencesStore.getState().hydratePreferences(DEFAULT_PREFERENCES);
        useShellStore.setState({
            notificationIconDot: true,
            dateCulture: 'en',
            dateIsoFormat: false,
            dateHour12: false
        } as Partial<ReturnType<typeof useShellStore.getState>>);
        mocks.getBool.mockResolvedValue(false);
        mocks.getString.mockImplementation((_key: string, fallback = '') =>
            Promise.resolve(String(fallback ?? ''))
        );
        mocks.getInt.mockImplementation((_key: string, fallback = 0) =>
            Promise.resolve(Number(fallback))
        );
        mocks.getArray.mockImplementation((_key: string, fallback: unknown[]) =>
            Promise.resolve(fallback)
        );
        mocks.setBool.mockResolvedValue(undefined);
        mocks.setString.mockResolvedValue(undefined);
        mocks.setInt.mockResolvedValue(undefined);
        mocks.setArray.mockResolvedValue(undefined);
        mocks.setObject.mockResolvedValue(undefined);
        mocks.storageSetString.mockResolvedValue(undefined);
        mocks.appSetStartup.mockResolvedValue(undefined);
        mocks.appRestartApplication.mockResolvedValue(undefined);
        mocks.appVrOverlayConfigReload.mockResolvedValue(undefined);
        mocks.readRecentActionCooldown.mockReturnValue({
            enabled: false,
            minutes: 60
        });
        mocks.isCommunityThemeAppearanceControlled.mockReturnValue(false);
    });

    it('rolls back the OS startup toggle when persisting the config fails', async () => {
        mocks.getBool.mockResolvedValue(false);
        mocks.setBool.mockRejectedValueOnce(new Error('config write failed'));

        await expect(setStartAtWindowsStartupPreference(true)).rejects.toThrow(
            'config write failed'
        );

        expect(mocks.appSetStartup).toHaveBeenNthCalledWith(1, true);
        expect(mocks.appSetStartup).toHaveBeenNthCalledWith(2, false);
        expect(usePreferencesStore.getState().isStartAtWindowsStartup).toBe(
            false
        );
    });

    it('normalizes table page size options and moves the current page size to the nearest configured value', async () => {
        usePreferencesStore.getState().hydratePreferences({
            ...DEFAULT_PREFERENCES,
            tablePageSize: 20,
            tablePageSizes: [10, 20, 50]
        });

        await expect(
            setTablePageSizesPreference(['50', '10', 'bad', 25, 10])
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
            'VRCX_tablePageSizes',
            [10, 25, 50]
        );
        expect(mocks.publishPreferenceChanged).toHaveBeenCalledWith(
            'VRCX_tablePageSize',
            25
        );
    });

    it('clamps generic integer config values before persistence and publish', async () => {
        await expect(
            setIntConfigPreference('notificationTimeout', '999999', {
                min: 1000,
                max: 10000,
                fallback: 3000
            })
        ).resolves.toBe(10000);

        expect(mocks.setInt).toHaveBeenCalledWith('notificationTimeout', 10000);
        expect(usePreferencesStore.getState().notificationTimeout).toBe(10000);
        expect(mocks.publishPreferenceChanged).toHaveBeenCalledWith(
            'notificationTimeout',
            10000
        );
    });

    it('does not persist the hidden interactive panel switch', async () => {
        await setBoolConfigPreference('vrOverlayPanelEnabled', false);

        expect(mocks.setBool).not.toHaveBeenCalled();
        expect(usePreferencesStore.getState().vrOverlayPanelEnabled).toBe(
            false
        );
        expect(mocks.publishPreferenceChanged).not.toHaveBeenCalledWith(
            'vrOverlayPanelEnabled',
            expect.anything()
        );
        expect(mocks.appVrOverlayConfigReload).not.toHaveBeenCalled();
    });

    it('does not persist the hidden interactive panel all-friends setting', async () => {
        await setBoolConfigPreference(
            'vrOverlayPanelAllFriendsIncludesFavorites',
            false
        );

        expect(mocks.setBool).not.toHaveBeenCalled();
        expect(
            usePreferencesStore.getState()
                .vrOverlayPanelAllFriendsIncludesFavorites
        ).toBe(false);
        expect(mocks.publishPreferenceChanged).not.toHaveBeenCalledWith(
            'vrOverlayPanelAllFriendsIncludesFavorites',
            expect.anything()
        );
        expect(mocks.appVrOverlayConfigReload).not.toHaveBeenCalled();
    });

    it('adds and removes hidden feed users through the normalized JSON preference', async () => {
        usePreferencesStore.getState().hydratePreferences({
            ...DEFAULT_PREFERENCES,
            feedHiddenUsers: ['usr_existing']
        });

        await expect(addFeedHiddenUserPreference(' usr_new ')).resolves.toEqual(
            ['usr_existing', 'usr_new']
        );
        await expect(addFeedHiddenUserPreference('usr_new')).resolves.toEqual([
            'usr_existing',
            'usr_new'
        ]);
        await expect(
            removeFeedHiddenUserPreference('usr_existing')
        ).resolves.toEqual(['usr_new']);

        expect(mocks.setString).toHaveBeenNthCalledWith(
            1,
            'feedHiddenUsers',
            JSON.stringify(['usr_existing', 'usr_new'])
        );
        expect(mocks.setString).toHaveBeenNthCalledWith(
            2,
            'feedHiddenUsers',
            JSON.stringify(['usr_new'])
        );
        expect(usePreferencesStore.getState().feedHiddenUsers).toEqual([
            'usr_new'
        ]);
    });
});
