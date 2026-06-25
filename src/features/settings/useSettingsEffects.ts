import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';
import configRepository from '@/repositories/configRepository';
import { loadPreferenceSnapshot } from '@/services/preferencesService';
import { getAppDataDirState } from '@/services/shellIntegrationService';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_FONT_DEFAULT_KEY,
    applyAppFontPreferences,
    normalizeAppCjkFontPack,
    normalizeAppFontFamily,
    normalizeZoomLevel
} from '@/services/themeService';

export function useSettingsEffects({
    applyAvatarProviderConfig,
    applyPreferenceSnapshotToLocalState,
    preferenceState,
    setLoading,
    setAppDataDirState,
    setPrefs,
    setTtsVoices,
    setZoomInput,
    sidebarOpen,
    zoomLevel
}: any) {
    const { t } = useTranslation();
    useEffect(() => {
        if (!preferenceState.preferencesHydrated) {
            return;
        }
        applyPreferenceSnapshotToLocalState(preferenceState);
    }, [preferenceState]);
    useEffect(() => {
        let active = true;
        Promise.all([
            loadPreferenceSnapshot(),
            avatarSearchProviderRepository.getConfig()
        ])
            .then(([snapshot, avatarConfig]: any) => {
                if (!active) {
                    return;
                }
                applyPreferenceSnapshotToLocalState(snapshot);
                applyAvatarProviderConfig(avatarConfig);
            })
            .catch((error: any) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.settings.toast.failed_to_load_settings')
                );
            })
            .finally(() => {
                if (active) setLoading(false);
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
                ]: any) => {
                    if (!active) {
                        return;
                    }
                    const normalizedFont =
                        normalizeAppFontFamily(appFontFamily);
                    const normalizedCjkFont =
                        normalizeAppCjkFontPack(appCjkFontPack);
                    setPrefs((current: any) => ({
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
            .catch((error: any) => {
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
        setPrefs((current: any) => ({
            ...current,
            navIsCollapsed: !sidebarOpen
        }));
    }, [sidebarOpen]);
    useEffect(() => {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            return undefined;
        }
        const updateVoices = () => {
            setTtsVoices(window.speechSynthesis.getVoices());
        };
        updateVoices();
        window.speechSynthesis.addEventListener?.(
            'voiceschanged',
            updateVoices
        );
        const timeoutId = window.setTimeout(updateVoices, 5000);
        return () => {
            window.speechSynthesis.removeEventListener?.(
                'voiceschanged',
                updateVoices
            );
            window.clearTimeout(timeoutId);
        };
    }, []);
}
