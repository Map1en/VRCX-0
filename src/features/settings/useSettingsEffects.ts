import {
    useEffect,
    useEffectEvent,
    type Dispatch,
    type SetStateAction
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    commands,
    type AppDataDirState,
    type TtsVoice
} from '@/platform/tauri/bindings';
import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';
import { getAppDataDirState } from '@/services/shellIntegrationService';
import { normalizeZoomLevel } from '@/services/themeService';

import type { AvatarProviderConfig } from './useAvatarProviderConfig';

type SettingsEffectsDeps = {
    applyAvatarProviderConfig: (config: AvatarProviderConfig) => void;
    notificationTtsVoiceNative: string;
    resetNotificationTtsVoice: () => void;
    setAppDataDirState: Dispatch<SetStateAction<AppDataDirState | null>>;
    setTtsVoices: Dispatch<SetStateAction<TtsVoice[]>>;
    setZoomInput: Dispatch<SetStateAction<string>>;
    zoomLevel: number | null;
};

export function useSettingsEffects({
    applyAvatarProviderConfig,
    notificationTtsVoiceNative,
    resetNotificationTtsVoice,
    setAppDataDirState,
    setTtsVoices,
    setZoomInput,
    zoomLevel
}: SettingsEffectsDeps) {
    const { t } = useTranslation();
    const resetMissingNotificationTtsVoice = useEffectEvent(
        (voices: TtsVoice[]) => {
            if (
                voices.length > 0 &&
                notificationTtsVoiceNative &&
                !voices.some((voice) => voice.id === notificationTtsVoiceNative)
            ) {
                resetNotificationTtsVoice();
            }
        }
    );
    useEffect(() => {
        let active = true;
        avatarSearchProviderRepository
            .getConfig()
            .then((avatarConfig) => {
                if (!active) {
                    return;
                }
                applyAvatarProviderConfig(avatarConfig);
            })
            .catch((error: unknown) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.settings.toast.failed_to_load_settings')
                );
            });
        return () => {
            active = false;
        };
    }, [applyAvatarProviderConfig, t]);
    useEffect(() => {
        let active = true;
        getAppDataDirState()
            .then((state) => {
                if (active) {
                    setAppDataDirState(state);
                }
            })
            .catch((error: unknown) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.settings.advanced.advanced.data_directory.failed_to_load'
                          )
                );
            });
        return () => {
            active = false;
        };
    }, [setAppDataDirState, t]);
    useEffect(() => {
        setZoomInput(String(normalizeZoomLevel(zoomLevel)));
    }, [setZoomInput, zoomLevel]);
    useEffect(() => {
        let active = true;
        commands
            .appHostTtsVoices()
            .then((voices) => {
                if (active) {
                    setTtsVoices(voices);
                    resetMissingNotificationTtsVoice(voices);
                }
            })
            .catch(() => {
                if (active) {
                    setTtsVoices([]);
                }
            });
        return () => {
            active = false;
        };
    }, [setTtsVoices]);
}
