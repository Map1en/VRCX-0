import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appSystemLanguage: vi.fn(),
    appStartupBootstrapSnapshotGet: vi.fn(),
    storageGetAll: vi.fn(),
    configInit: vi.fn(),
    configGetRawValue: vi.fn(),
    configGetString: vi.fn(),
    configSetString: vi.fn(),
    refreshSavedAuthSnapshot: vi.fn(),
    runStartupMaintenance: vi.fn(),
    initializeDatabaseUpgradeFlow: vi.fn(),
    initializeHostCapabilities: vi.fn(),
    loadPreferenceSnapshot: vi.fn(),
    showSQLiteErrorDialog: vi.fn(),
    applyAppFontPreferences: vi.fn(),
    applyThemeColor: vi.fn(),
    applyThemeMode: vi.fn(),
    applyZoomLevel: vi.fn(),
    resolveThemeColor: vi.fn(),
    resolveThemeMode: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appSystemLanguage: mocks.appSystemLanguage,
        appStartupBootstrapSnapshotGet: mocks.appStartupBootstrapSnapshotGet,
        storageGetAll: mocks.storageGetAll
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        init: mocks.configInit,
        getRawValue: mocks.configGetRawValue,
        getString: mocks.configGetString,
        setString: mocks.configSetString
    }
}));

vi.mock('./authSnapshotService', () => ({
    refreshSavedAuthSnapshot: mocks.refreshSavedAuthSnapshot
}));

vi.mock('./backgroundMaintenanceService', () => ({
    runStartupMaintenance: mocks.runStartupMaintenance
}));

vi.mock('./browserStorageMigrationService', () => ({
    moveLayoutPreferencesToBrowserStorage: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('./databaseUpgradeService', () => ({
    initializeDatabaseUpgradeFlow: mocks.initializeDatabaseUpgradeFlow
}));

vi.mock('./hostCapabilityService', () => ({
    initializeHostCapabilities: mocks.initializeHostCapabilities
}));

vi.mock('./preferencesService', () => ({
    loadPreferenceSnapshot: mocks.loadPreferenceSnapshot
}));

vi.mock('./sqliteErrorDialogService', () => ({
    showSQLiteErrorDialog: mocks.showSQLiteErrorDialog
}));

vi.mock('@/shared/constants/fonts', () => ({
    APP_CJK_FONT_PACK_DEFAULT_KEY: 'default-cjk',
    APP_FONT_DEFAULT_KEY: 'default-font'
}));

vi.mock('./themeService', () => ({
    applyAppFontPreferences: mocks.applyAppFontPreferences,
    applyThemeColor: mocks.applyThemeColor,
    applyThemeMode: mocks.applyThemeMode,
    applyZoomLevel: mocks.applyZoomLevel,
    resolveThemeColor: mocks.resolveThemeColor,
    resolveThemeMode: mocks.resolveThemeMode
}));

import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';

import { initializeReactRuntime } from './startupService';

const configValues: Record<string, string> = {
    themeMode: 'dark',
    VRCX_ZoomLevel: '125',
    VRCX_themeColor: 'blue',
    VRCX_fontFamily: 'Inter',
    customFontFamily: '',
    VRCX_cjkFontPack: 'noto-sans-cjk'
};

function expectCalledInOrder(
    calls: Array<{ mock: { invocationCallOrder: number[] } }>
): void {
    const callOrder = calls.map((call) => {
        expect(call.mock.invocationCallOrder).not.toHaveLength(0);
        return call.mock.invocationCallOrder[0];
    });
    expect(callOrder).toEqual(
        [...callOrder].sort((left, right) => left - right)
    );
}

describe('startupService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        useSessionStore.getState().resetSessionState();
        useRuntimeStore.getState().resetRuntimeState();
        useShellStore.setState({ locale: 'en' });

        mocks.appSystemLanguage.mockResolvedValue('en-US');
        mocks.appStartupBootstrapSnapshotGet.mockResolvedValue({
            hostCapabilities: undefined,
            configEntries: undefined,
            systemLanguage: 'en-US',
            systemCulture: 'en-US'
        });
        mocks.storageGetAll.mockResolvedValue({});
        mocks.configInit.mockResolvedValue(undefined);
        mocks.configGetRawValue.mockResolvedValue('en');
        mocks.configGetString.mockImplementation(
            async (key: string) => configValues[key] ?? ''
        );
        mocks.configSetString.mockResolvedValue(undefined);
        mocks.refreshSavedAuthSnapshot.mockResolvedValue(undefined);
        mocks.runStartupMaintenance.mockResolvedValue(undefined);
        mocks.initializeDatabaseUpgradeFlow.mockResolvedValue(true);
        mocks.initializeHostCapabilities.mockResolvedValue(undefined);
        mocks.loadPreferenceSnapshot.mockResolvedValue(undefined);
        mocks.showSQLiteErrorDialog.mockResolvedValue(false);
        mocks.applyThemeMode.mockResolvedValue(undefined);
        mocks.applyZoomLevel.mockResolvedValue(undefined);
        mocks.resolveThemeColor.mockImplementation((value: string) => value);
        mocks.resolveThemeMode.mockImplementation((value: string) => value);
    });

    it('runs critical startup owners in order and exposes the ready partial state', async () => {
        await initializeReactRuntime();

        expectCalledInOrder([
            mocks.initializeHostCapabilities,
            mocks.configInit,
            mocks.configGetRawValue,
            mocks.initializeDatabaseUpgradeFlow,
            mocks.loadPreferenceSnapshot,
            mocks.refreshSavedAuthSnapshot,
            mocks.runStartupMaintenance
        ]);
        expect(useSessionStore.getState()).toMatchObject({
            bootStatus: 'partial',
            transportStatus: 'idle',
            databaseReady: true
        });
        expect(useRuntimeStore.getState().startup.config).toMatchObject({
            status: 'completed',
            detail: 'Config, locale, theme and zoom loaded.'
        });
        expect(useRuntimeStore.getState().startup.services).toMatchObject({
            status: 'pending',
            detail: 'Runtime bootstrap is ready. Authenticated session services start after login.'
        });
    });

    it('canonicalizes and persists a saved locale before applying font preferences', async () => {
        mocks.configGetRawValue.mockResolvedValue(' zh_Hant_TW ');

        await initializeReactRuntime();

        expect(useShellStore.getState().locale).toBe('zh-TW');
        expect(mocks.configSetString).toHaveBeenCalledWith(
            'appLanguage',
            'zh-TW'
        );
        expect(mocks.appSystemLanguage).not.toHaveBeenCalled();
        expect(mocks.applyAppFontPreferences).toHaveBeenCalledWith({
            fontFamily: 'Inter',
            customFontFamily: '',
            cjkFontPack: 'noto-sans-cjk',
            locale: 'zh-TW'
        });
        expectCalledInOrder([
            mocks.configSetString,
            mocks.applyAppFontPreferences
        ]);
    });

    it('continues startup when non-critical appearance synchronization fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mocks.applyThemeMode.mockRejectedValue(new Error('theme failed'));
        mocks.applyZoomLevel.mockRejectedValue(new Error('zoom failed'));

        await expect(initializeReactRuntime()).resolves.toBeUndefined();

        expect(mocks.initializeDatabaseUpgradeFlow).toHaveBeenCalledOnce();
        expect(mocks.loadPreferenceSnapshot).toHaveBeenCalledOnce();
        expect(mocks.refreshSavedAuthSnapshot).toHaveBeenCalledOnce();
        expect(useSessionStore.getState()).toMatchObject({
            bootStatus: 'partial',
            transportStatus: 'idle',
            databaseReady: true
        });
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('does not wait for background maintenance before exposing partial readiness', async () => {
        mocks.runStartupMaintenance.mockReturnValue(
            new Promise<void>(() => {})
        );

        await expect(initializeReactRuntime()).resolves.toBeUndefined();

        expect(mocks.runStartupMaintenance).toHaveBeenCalledOnce();
        expect(useSessionStore.getState()).toMatchObject({
            bootStatus: 'partial',
            transportStatus: 'idle'
        });
    });

    it.each(['config', 'database', 'preferences', 'auth'] as const)(
        'marks startup as failed and opens the SQLite error flow when %s initialization fails',
        async (stage) => {
            const error = new Error(`${stage} failed`);
            vi.spyOn(console, 'error').mockImplementation(() => {});
            if (stage === 'config') {
                mocks.configInit.mockRejectedValue(error);
            } else if (stage === 'database') {
                mocks.initializeDatabaseUpgradeFlow.mockRejectedValue(error);
            } else if (stage === 'preferences') {
                mocks.loadPreferenceSnapshot.mockRejectedValue(error);
            } else {
                mocks.refreshSavedAuthSnapshot.mockRejectedValue(error);
            }

            await expect(initializeReactRuntime()).rejects.toBe(error);

            expect(useSessionStore.getState()).toMatchObject({
                bootStatus: 'error',
                transportStatus: 'error'
            });
            expect(useRuntimeStore.getState().startup.config).toMatchObject({
                status: 'error',
                detail: `${stage} failed`
            });
            expect(mocks.showSQLiteErrorDialog).toHaveBeenCalledWith(error);
        }
    );
});
