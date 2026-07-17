import { describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_HMD_NOTIFICATION_ACTIVITY_FILTERS,
    DEFAULT_OVERLAY_ACTIVITY_FILTERS,
    DEFAULT_TTS_NOTIFICATION_ACTIVITY_FILTERS,
    DEFAULT_VR_NOTIFICATION_ACTIVITY_FILTERS,
    DEFAULT_WEBHOOK_ACTIVITY_FILTERS
} from './settingsValues';
import { useSettingsMaintenanceActions } from './useSettingsMaintenanceActions';

function createMaintenanceActions({
    confirm,
    saveBoolPreference
}: {
    confirm: (options: {
        title: string;
        description: string;
    }) => Promise<{ ok: boolean }>;
    saveBoolPreference: (
        preferenceKey: string,
        configKey: string,
        enabled: boolean
    ) => Promise<void>;
}) {
    return useSettingsMaintenanceActions({
        auth: {},
        commit: async () => true,
        confirm,
        databaseMaintenanceRepository: {
            vacuum: async () => undefined
        },
        feedRepository: {
            purgeAvatarFeedData: async () => undefined
        },
        gameState: {
            isGameRunning: false
        },
        mediaRepository: {
            cropAllPrints: async () => undefined,
            getUgcPhotoLocation: async () => ''
        },
        prefs: {
            appCjkFontPack: null,
            appFontFamily: null,
            autoLoginDelaySeconds: 0,
            customFontFamily: null,
            customFontOverride: null,
            customFontPrimary: null,
            customFontSecondary: null,
            desktopNotificationActivityFilters:
                DEFAULT_VR_NOTIFICATION_ACTIVITY_FILTERS,
            hmdNotificationActivityFilters:
                DEFAULT_HMD_NOTIFICATION_ACTIVITY_FILTERS,
            notificationTTS: 'Never',
            notificationTTSNameMode: '',
            notificationTTSVoiceNative: '',
            overlayActivityFilters: DEFAULT_OVERLAY_ACTIVITY_FILTERS,
            proxyServer: '',
            ttsNotificationActivityFilters:
                DEFAULT_TTS_NOTIFICATION_ACTIVITY_FILTERS,
            userGeneratedContentPath: '',
            vrNotificationActivityFilters:
                DEFAULT_VR_NOTIFICATION_ACTIVITY_FILTERS,
            webhookActivityFilters: DEFAULT_WEBHOOK_ACTIVITY_FILTERS,
            wristOverlayEnabled: false
        },
        prompt: async () => ({ ok: false }),
        purgePeriod: '180',
        saveBoolPreference,
        savePreferenceValue: async () => true,
        saveStringPreference: async () => undefined,
        setAppDataDirState: () => undefined,
        setCropInstancePrintsPreference: async () => undefined,
        setIntConfigPreference: async () => undefined,
        setPrefs: () => undefined,
        setPurgeDialogOpen: () => undefined,
        setPurgeInProgress: () => undefined,
        setUserGeneratedContentPathPreference: async () => '',
        speakNotificationTts: async () => undefined,
        t: (key) => key,
        toast: {
            dismiss: () => undefined,
            error: () => undefined,
            success: () => undefined,
            warning: () => undefined
        }
    });
}

describe('handleGameLogDisabledChange', () => {
    it('keeps GameLog enabled when disabling is not confirmed', async () => {
        const confirm = vi.fn(async () => ({ ok: false }));
        const saveBoolPreference = vi.fn(async () => undefined);
        const actions = createMaintenanceActions({
            confirm,
            saveBoolPreference
        });

        await actions.handleGameLogDisabledChange(true);

        expect(confirm).toHaveBeenCalledOnce();
        expect(saveBoolPreference).not.toHaveBeenCalled();
    });

    it('enables GameLog without showing the disable confirmation', async () => {
        const confirm = vi.fn(async () => ({ ok: false }));
        const saveBoolPreference = vi.fn(async () => undefined);
        const actions = createMaintenanceActions({
            confirm,
            saveBoolPreference
        });

        await actions.handleGameLogDisabledChange(false);

        expect(confirm).not.toHaveBeenCalled();
        expect(saveBoolPreference).toHaveBeenCalledWith(
            'gameLogDisabled',
            'VRCX_gameLogDisabled',
            false
        );
    });
});
