// @ts-nocheck
export function SettingsSystemSection({ system }) {
    const {
        SettingsSystemTab,
        t,
        hostPlatform,
        prefs,
        savePreferenceValue,
        saveBoolPreference,
        setStartAtWindowsStartupPreference,
        setStartAsMinimizedPreference,
        setCloseToTrayPreference,
        promptProxySettings,
        promptAutoLoginDelaySeconds
    } = system;

    return (
        <SettingsSystemTab
            t={t}
            hostPlatform={hostPlatform}
            isStartAtWindowsStartup={prefs.isStartAtWindowsStartup}
            isStartAsMinimizedState={prefs.isStartAsMinimizedState}
            isCloseToTray={prefs.isCloseToTray}
            autoLoginDelayEnabled={prefs.autoLoginDelayEnabled}
            autoLoginDelaySeconds={prefs.autoLoginDelaySeconds}
            onStartAtWindowsStartupChange={(checked) =>
                void savePreferenceValue(
                    'isStartAtWindowsStartup',
                    checked,
                    () => setStartAtWindowsStartupPreference(checked)
                )
            }
            onStartAsMinimizedChange={(checked) =>
                void savePreferenceValue(
                    'isStartAsMinimizedState',
                    checked,
                    () => setStartAsMinimizedPreference(checked)
                )
            }
            onCloseToTrayChange={(checked) =>
                void savePreferenceValue('isCloseToTray', checked, () =>
                    setCloseToTrayPreference(checked)
                )
            }
            onAutoLoginDelayEnabledChange={(checked) =>
                void saveBoolPreference(
                    'autoLoginDelayEnabled',
                    'VRCX_autoLoginDelayEnabled',
                    checked
                )
            }
            onPromptAutoLoginDelaySeconds={() =>
                void promptAutoLoginDelaySeconds()
            }
            onProxySettings={() => void promptProxySettings()}
        />
    );
}
