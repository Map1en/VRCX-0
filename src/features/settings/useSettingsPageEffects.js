import { useEffect } from 'react';
export function useSettingsPageEffects({
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_FONT_DEFAULT_KEY,
    applyAppFontPreferences,
    applyAvatarProviderConfig,
    applyPreferenceSnapshotToLocalState,
    avatarSearchProviderRepository,
    configRepository,
    loadPreferenceSnapshot,
    normalizeAppCjkFontPack,
    normalizeAppFontFamily,
    normalizeZoomLevel,
    preferenceState,
    setLoading,
    setPrefs,
    setTtsVoices,
    setZoomInput,
    sidebarOpen,
    t,
    toast,
    zoomLevel
}) {
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
            .then(([snapshot, avatarConfig]) => {
                if (!active) {
                    return;
                }
                applyPreferenceSnapshotToLocalState(snapshot);
                applyAvatarProviderConfig(avatarConfig);
            })
            .catch((error) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.settings.generated_toast.failed_to_load_settings'
                          )
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
            configRepository.getString('customFontFamily', '')
        ])
            .then(([appFontFamily, appCjkFontPack, customFontFamily]) => {
                if (!active) {
                    return;
                }
                const normalizedFont = normalizeAppFontFamily(appFontFamily);
                const normalizedCjkFont =
                    normalizeAppCjkFontPack(appCjkFontPack);
                setPrefs((current) => ({
                    ...current,
                    appFontFamily: normalizedFont,
                    appCjkFontPack: normalizedCjkFont,
                    customFontFamily: customFontFamily || ''
                }));
                applyAppFontPreferences({
                    fontFamily: normalizedFont,
                    customFontFamily: customFontFamily || '',
                    cjkFontPack: normalizedCjkFont
                });
            })
            .catch(() => {});
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
