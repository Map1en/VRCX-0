import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    commands,
    type AppDataDirState,
    type TtsVoice
} from '@/platform/tauri/bindings';
import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';
import configRepository from '@/repositories/configRepository';
import { getAppDataDirState } from '@/services/shellIntegrationService';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_FONT_DEFAULT_KEY,
    applyAppFontPreferences,
    normalizeAppCjkFontPack,
    normalizeAppFontFamily,
    normalizeZoomLevel
} from '@/services/themeService';

import type { createDefaultSettingsPrefs } from './settingsDefaultPrefs';
import type { AvatarProviderConfig } from './useAvatarProviderConfig';

type SettingsPrefs = ReturnType<typeof createDefaultSettingsPrefs>;
type SettingsPreferenceState = Record<string, unknown> & {
    preferencesHydrated: boolean;
};

type SettingsEffectsDeps = {
    applyAvatarProviderConfig: (config: AvatarProviderConfig) => void;
    applyPreferenceSnapshotToLocalState: (snapshot: unknown) => void;
    preferenceState: SettingsPreferenceState;
    setAppDataDirState: Dispatch<SetStateAction<AppDataDirState | null>>;
    setPrefs: Dispatch<SetStateAction<SettingsPrefs>>;
    setTtsVoices: Dispatch<SetStateAction<TtsVoice[]>>;
    setZoomInput: Dispatch<SetStateAction<string>>;
    sidebarOpen: boolean;
    zoomLevel: unknown;
};

export function useSettingsEffects({
    applyAvatarProviderConfig,
    applyPreferenceSnapshotToLocalState,
    preferenceState,
    setAppDataDirState,
    setPrefs,
    setTtsVoices,
    setZoomInput,
    sidebarOpen,
    zoomLevel
}: SettingsEffectsDeps) {
    const { t } = useTranslation();
    useEffect(() => {
        if (!preferenceState.preferencesHydrated) {
            return;
        }
        applyPreferenceSnapshotToLocalState(preferenceState);
    }, [preferenceState]);
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
    }, []);
    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getString('VRCX_fontFamily', APP_FONT_DEFAULT_KEY),
            configRepository.getString(
                'VRCX_cjkFontPack',
                APP_CJK_FONT_PACK_DEFAULT_KEY
            ),
            configRepository.getString('customFontFamily', ''),
            configRepository.getString('customFontPrimary', ''),
            configRepository.getString('customFontSecondary', ''),
            configRepository.getString('customFontOverride', '')
        ])
            .then(
                ([
                    appFontFamily,
                    appCjkFontPack,
                    customFontFamily,
                    customFontPrimary,
                    customFontSecondary,
                    customFontOverride
                ]) => {
                    if (!active) {
                        return;
                    }
                    const normalizedFont =
                        normalizeAppFontFamily(appFontFamily);
                    const normalizedCjkFont =
                        normalizeAppCjkFontPack(appCjkFontPack);
                    setPrefs((current) => ({
                        ...current,
                        appFontFamily: normalizedFont,
                        appCjkFontPack: normalizedCjkFont,
                        customFontFamily: customFontFamily || '',
                        customFontPrimary: customFontPrimary || '',
                        customFontSecondary: customFontSecondary || '',
                        customFontOverride: customFontOverride || ''
                    }));
                    applyAppFontPreferences({
                        fontFamily: normalizedFont,
                        customFontFamily: customFontFamily || '',
                        cjkFontPack: normalizedCjkFont
                    });
                }
            )
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);
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
    }, []);
    useEffect(() => {
        setZoomInput(String(normalizeZoomLevel(zoomLevel)));
    }, [zoomLevel]);
    useEffect(() => {
        setPrefs((current) => ({
            ...current,
            navIsCollapsed: !sidebarOpen
        }));
    }, [sidebarOpen]);
    useEffect(() => {
        let active = true;
        commands
            .appHostTtsVoices()
            .then((voices) => {
                if (active) {
                    setTtsVoices(voices);
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
    }, []);
}
