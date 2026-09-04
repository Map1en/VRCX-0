import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appLanguageChanged: vi.fn(),
    appRestartApplication: vi.fn(),
    appSetStartup: vi.fn(),
    appVrOverlayConfigReload: vi.fn(),
    appFeedPersistenceSetDisabled: vi.fn(),
    appAvatarFeedPersistenceSetDisabled: vi.fn(),
    getBool: vi.fn(),
    getString: vi.fn(),
    getInt: vi.fn(),
    getArray: vi.fn(),
    setBool: vi.fn(),
    setString: vi.fn(),
    setInt: vi.fn(),
    setArray: vi.fn(),
    setMany: vi.fn(),
    setObject: vi.fn(),
    applyServerEntry: vi.fn(),
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
        appVrOverlayConfigReload: mocks.appVrOverlayConfigReload,
        appFeedPersistenceSetDisabled: mocks.appFeedPersistenceSetDisabled,
        appAvatarFeedPersistenceSetDisabled:
            mocks.appAvatarFeedPersistenceSetDisabled
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
        setMany: mocks.setMany,
        setObject: mocks.setObject,
        applyServerEntry: mocks.applyServerEntry
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
    avatarFeedEntry,
    onlineFeedEntry
} from '@/components/feed/feedLiveTestEntries';
import { useFeedLiveStore } from '@/state/feedLiveStore';
import {
    DEFAULT_PREFERENCES,
    usePreferencesStore
} from '@/state/preferencesStore';
import { useShellStore } from '@/state/shellStore';

import {
    addFeedHiddenUserPreference,
    removeFeedHiddenUserPreference,
    setAvatarFeedPersistenceDisabledPreference,
    setBoolConfigPreference,
    setFeedPersistenceDisabledPreference,
    setIntConfigPreference,
    setStartAtWindowsStartupPreference,
    setTableLimitsPreference,
    setTablePageSizesPreference
} from './preferenceGenericSetters';

describe('preferenceGenericSetters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        usePreferencesStore.getState().hydratePreferences(DEFAULT_PREFERENCES);
        useShellStore.setState({
            notificationIconDot: true,
            taskbarIconDot: true,
            notifiedMenus: [],
            trayIconNotify: false,
            taskbarIconNotify: false,
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
        mocks.setMany.mockResolvedValue(undefined);
        mocks.setObject.mockResolvedValue(undefined);
        mocks.storageSetString.mockResolvedValue(undefined);
        mocks.appSetStartup.mockResolvedValue(false);
        mocks.appRestartApplication.mockResolvedValue(undefined);
        mocks.appVrOverlayConfigReload.mockResolvedValue(undefined);
        mocks.appFeedPersistenceSetDisabled.mockResolvedValue(undefined);
        mocks.appAvatarFeedPersistenceSetDisabled.mockResolvedValue(undefined);
        useFeedLiveStore.getState().resetFeedLive();
        mocks.readRecentActionCooldown.mockReturnValue({
            enabled: false,
            minutes: 60
        });
        mocks.isCommunityThemeAppearanceControlled.mockReturnValue(false);
    });

    it('uses the backend autostart transaction result as the committed preference', async () => {
        mocks.appSetStartup.mockResolvedValueOnce(true);

        await expect(
            setStartAtWindowsStartupPreference(true)
        ).resolves.toBeUndefined();

        expect(mocks.appSetStartup).toHaveBeenCalledOnce();
        expect(mocks.appSetStartup).toHaveBeenCalledWith(true);
        expect(mocks.applyServerEntry).toHaveBeenCalledWith(
            'StartAtWindowsStartup',
            'true'
        );
        expect(mocks.setBool).not.toHaveBeenCalledWith(
            'StartAtWindowsStartup',
            expect.anything()
        );
        expect(usePreferencesStore.getState().isStartAtWindowsStartup).toBe(
            true
        );
        expect(mocks.publishPreferenceChanged).toHaveBeenCalledWith(
            'StartAtWindowsStartup',
            true
        );
    });

    it('leaves the frontend mirror unchanged when the backend transaction fails', async () => {
        mocks.appSetStartup.mockRejectedValueOnce(new Error('startup failed'));

        await expect(setStartAtWindowsStartupPreference(true)).rejects.toThrow(
            'startup failed'
        );

        expect(mocks.applyServerEntry).not.toHaveBeenCalled();
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

        expect(mocks.setMany).toHaveBeenCalledWith([
            ['VRCX_tablePageSizes', '[10,25,50]'],
            ['VRCX_tablePageSize', '25']
        ]);
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

    it('persists table limits in one config transaction', async () => {
        await expect(
            setTableLimitsPreference({
                maxTableSize: 750,
                searchLimit: 25000
            })
        ).resolves.toEqual({
            maxTableSize: 750,
            searchLimit: 25000
        });

        expect(mocks.setMany).toHaveBeenCalledWith([
            ['maxTableSize_v2', '750'],
            ['searchLimit', '25000']
        ]);
        expect(usePreferencesStore.getState().tableLimits).toEqual({
            maxTableSize: 750,
            searchLimit: 25000
        });
    });

    it('clears live Feed only after the backend persistence switch succeeds', async () => {
        useFeedLiveStore
            .getState()
            .pushEntries([{ sequence: 1, entry: onlineFeedEntry() }]);

        await setFeedPersistenceDisabledPreference(true);

        expect(mocks.appFeedPersistenceSetDisabled).toHaveBeenCalledWith(true);
        expect(useFeedLiveStore.getState().entries).toEqual([]);
        expect(usePreferencesStore.getState().feedPersistenceDisabled).toBe(
            true
        );
    });

    it('keeps the Feed preference and live entries when the backend switch fails', async () => {
        useFeedLiveStore
            .getState()
            .pushEntries([{ sequence: 1, entry: onlineFeedEntry() }]);
        mocks.appFeedPersistenceSetDisabled.mockRejectedValueOnce(
            new Error('switch failed')
        );

        await expect(
            setFeedPersistenceDisabledPreference(true)
        ).rejects.toThrow('switch failed');

        expect(useFeedLiveStore.getState().entries).toHaveLength(1);
        expect(usePreferencesStore.getState().feedPersistenceDisabled).toBe(
            false
        );
    });

    it('keeps live Feed entries when avatar history persistence changes', async () => {
        useFeedLiveStore.getState().pushEntries([
            {
                sequence: 1,
                entry: avatarFeedEntry()
            }
        ]);

        await setAvatarFeedPersistenceDisabledPreference(true);

        expect(mocks.appAvatarFeedPersistenceSetDisabled).toHaveBeenCalledWith(
            true
        );
        expect(useFeedLiveStore.getState().entries).toHaveLength(1);
        expect(
            usePreferencesStore.getState().avatarFeedPersistenceDisabled
        ).toBe(true);
    });

    it('keeps compound table preferences unchanged when the transaction fails', async () => {
        mocks.setMany.mockRejectedValueOnce(new Error('write failed'));

        await expect(setTablePageSizesPreference([10, 25, 50])).rejects.toThrow(
            'write failed'
        );

        expect(usePreferencesStore.getState()).toMatchObject({
            tablePageSize: DEFAULT_PREFERENCES.tablePageSize,
            tablePageSizes: DEFAULT_PREFERENCES.tablePageSizes
        });
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

    it('clears an existing Friend Log dot when the preference is disabled', async () => {
        useShellStore.setState({ notifiedMenus: ['friend-log'] });

        await setBoolConfigPreference('friendLogNotificationDot', false);

        expect(mocks.setBool).toHaveBeenCalledWith(
            'friendLogNotificationDot',
            false
        );
        expect(useShellStore.getState().notifiedMenus).toEqual([]);
        expect(usePreferencesStore.getState().friendLogNotificationDot).toBe(
            false
        );
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
