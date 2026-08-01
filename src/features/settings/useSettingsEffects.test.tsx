// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appHostTtsVoices: vi.fn(),
    getAppDataDirState: vi.fn(),
    getAvatarConfig: vi.fn(),
    getString: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: { appHostTtsVoices: mocks.appHostTtsVoices }
}));
vi.mock('@/repositories/avatarSearchProviderRepository', () => ({
    default: { getConfig: mocks.getAvatarConfig }
}));
vi.mock('@/repositories/configRepository', () => ({
    default: { getString: mocks.getString }
}));
vi.mock('@/services/shellIntegrationService', () => ({
    getAppDataDirState: mocks.getAppDataDirState
}));
vi.mock('@/services/themeService', () => ({
    APP_CJK_FONT_PACK_DEFAULT_KEY: 'none',
    APP_FONT_DEFAULT_KEY: 'inter',
    applyAppFontPreferences: vi.fn(),
    normalizeAppCjkFontPack: (value: string) => value,
    normalizeAppFontFamily: (value: string) => value,
    normalizeZoomLevel: (value: unknown) => Number(value) || 100
}));

import { useSettingsEffects } from './useSettingsEffects';

describe('useSettingsEffects', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.appHostTtsVoices.mockResolvedValue([]);
        mocks.getAppDataDirState.mockResolvedValue(null);
        mocks.getString.mockResolvedValue('');
    });

    it('uses the hydrated store as the only preference snapshot owner', async () => {
        let resolveAvatarConfig: (value: {
            enabled: boolean;
            providerList: never[];
            selectedProvider: string;
        }) => void = () => undefined;
        mocks.getAvatarConfig.mockReturnValue(
            new Promise((resolve) => {
                resolveAvatarConfig = resolve;
            })
        );
        const applyAvatarProviderConfig = vi.fn();
        const applyPreferenceSnapshotToLocalState = vi.fn();
        const stableDeps = {
            applyAvatarProviderConfig,
            applyPreferenceSnapshotToLocalState,
            setAppDataDirState: vi.fn(),
            setPrefs: vi.fn(),
            setTtsVoices: vi.fn(),
            setZoomInput: vi.fn(),
            sidebarOpen: true,
            zoomLevel: 100
        };
        const firstState = { preferencesHydrated: true, marker: 'first' };
        const secondState = { preferencesHydrated: true, marker: 'second' };
        const { rerender } = renderHook(
            ({ preferenceState }) =>
                useSettingsEffects({ ...stableDeps, preferenceState }),
            { initialProps: { preferenceState: firstState } }
        );

        expect(applyPreferenceSnapshotToLocalState).toHaveBeenCalledTimes(1);
        expect(applyPreferenceSnapshotToLocalState).toHaveBeenLastCalledWith(
            firstState
        );

        rerender({ preferenceState: secondState });
        expect(applyPreferenceSnapshotToLocalState).toHaveBeenCalledTimes(2);
        expect(applyPreferenceSnapshotToLocalState).toHaveBeenLastCalledWith(
            secondState
        );

        await act(async () => {
            resolveAvatarConfig({
                enabled: false,
                providerList: [],
                selectedProvider: ''
            });
        });
        await waitFor(() =>
            expect(applyAvatarProviderConfig).toHaveBeenCalled()
        );
        expect(applyPreferenceSnapshotToLocalState).toHaveBeenCalledTimes(2);
        expect(mocks.getAvatarConfig).toHaveBeenCalledTimes(1);
    });
});
