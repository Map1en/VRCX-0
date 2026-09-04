// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appHostTtsVoices: vi.fn(),
    getAppDataDirState: vi.fn(),
    getAvatarConfig: vi.fn()
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
vi.mock('@/services/shellIntegrationService', () => ({
    getAppDataDirState: mocks.getAppDataDirState
}));
vi.mock('@/services/themeService', () => ({
    normalizeZoomLevel: (value: unknown) => Number(value) || 100
}));

import { useSettingsEffects } from './useSettingsEffects';

describe('useSettingsEffects', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.appHostTtsVoices.mockResolvedValue([]);
        mocks.getAppDataDirState.mockResolvedValue(null);
        mocks.getAvatarConfig.mockResolvedValue({
            enabled: false,
            providerList: [],
            selectedProvider: ''
        });
    });

    it('loads only auxiliary settings data outside the preference store', async () => {
        const applyAvatarProviderConfig = vi.fn();
        const setAppDataDirState = vi.fn();
        const resetNotificationTtsVoice = vi.fn();
        const setTtsVoices = vi.fn();
        const setZoomInput = vi.fn();

        renderHook(() =>
            useSettingsEffects({
                applyAvatarProviderConfig,
                notificationTtsVoiceNative: '',
                resetNotificationTtsVoice,
                setAppDataDirState,
                setTtsVoices,
                setZoomInput,
                zoomLevel: 125
            })
        );

        await waitFor(() => {
            expect(applyAvatarProviderConfig).toHaveBeenCalledWith({
                enabled: false,
                providerList: [],
                selectedProvider: ''
            });
            expect(setAppDataDirState).toHaveBeenCalledWith(null);
            expect(setTtsVoices).toHaveBeenCalledWith([]);
        });
        expect(setZoomInput).toHaveBeenCalledWith('125');
        expect(resetNotificationTtsVoice).not.toHaveBeenCalled();
    });

    it('resets a saved TTS voice that is missing from a successful voice list', async () => {
        mocks.appHostTtsVoices.mockResolvedValue([
            { id: 'new-voice', name: 'New Voice', language: 'en-US' }
        ]);
        const resetNotificationTtsVoice = vi.fn();

        renderHook(() =>
            useSettingsEffects({
                applyAvatarProviderConfig: vi.fn(),
                notificationTtsVoiceNative: 'legacy-voice',
                resetNotificationTtsVoice,
                setAppDataDirState: vi.fn(),
                setTtsVoices: vi.fn(),
                setZoomInput: vi.fn(),
                zoomLevel: 100
            })
        );

        await waitFor(() => {
            expect(resetNotificationTtsVoice).toHaveBeenCalledOnce();
        });
    });

    it('preserves a saved TTS voice when the voice list is empty', async () => {
        mocks.appHostTtsVoices.mockResolvedValue([]);
        const resetNotificationTtsVoice = vi.fn();
        const setTtsVoices = vi.fn();

        renderHook(() =>
            useSettingsEffects({
                applyAvatarProviderConfig: vi.fn(),
                notificationTtsVoiceNative: 'saved-voice',
                resetNotificationTtsVoice,
                setAppDataDirState: vi.fn(),
                setTtsVoices,
                setZoomInput: vi.fn(),
                zoomLevel: 100
            })
        );

        await waitFor(() => {
            expect(setTtsVoices).toHaveBeenCalledWith([]);
        });
        expect(resetNotificationTtsVoice).not.toHaveBeenCalled();
    });

    it('preserves a saved TTS voice when loading the voice list fails', async () => {
        mocks.appHostTtsVoices.mockRejectedValue(new Error('unavailable'));
        const resetNotificationTtsVoice = vi.fn();
        const setTtsVoices = vi.fn();

        renderHook(() =>
            useSettingsEffects({
                applyAvatarProviderConfig: vi.fn(),
                notificationTtsVoiceNative: 'saved-voice',
                resetNotificationTtsVoice,
                setAppDataDirState: vi.fn(),
                setTtsVoices,
                setZoomInput: vi.fn(),
                zoomLevel: 100
            })
        );

        await waitFor(() => {
            expect(setTtsVoices).toHaveBeenCalledWith([]);
        });
        expect(resetNotificationTtsVoice).not.toHaveBeenCalled();
    });

    it('ignores an auxiliary response after unmount', async () => {
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
        const { unmount } = renderHook(() =>
            useSettingsEffects({
                applyAvatarProviderConfig,
                notificationTtsVoiceNative: '',
                resetNotificationTtsVoice: vi.fn(),
                setAppDataDirState: vi.fn(),
                setTtsVoices: vi.fn(),
                setZoomInput: vi.fn(),
                zoomLevel: 100
            })
        );

        unmount();
        await act(async () => {
            resolveAvatarConfig({
                enabled: false,
                providerList: [],
                selectedProvider: ''
            });
        });

        expect(applyAvatarProviderConfig).not.toHaveBeenCalled();
    });
});
