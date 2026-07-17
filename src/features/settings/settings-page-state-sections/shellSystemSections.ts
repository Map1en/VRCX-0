import { settingsTabs } from '../settingsOptions';
import type { BuildSettingsPageStateSectionsInput } from '../settingsPageStateSections';

export function buildShellSection({
    activeSettingsTab,
    setActiveSettingsTab,
    loading
}: BuildSettingsPageStateSectionsInput) {
    return {
        activeSettingsTab,
        setActiveSettingsTab,
        settingsTabs,
        loading
    };
}

export function buildSystemSection({
    prefs,
    savePreferenceValue,
    saveBoolPreference,
    setProxyEnabledPreference,
    setStartAtWindowsStartupPreference,
    setStartAsMinimizedPreference,
    setCloseToTrayPreference,
    promptAutoLoginDelaySeconds,
    promptBackgroundModeDelayMinutes
}: BuildSettingsPageStateSectionsInput) {
    return {
        prefs,
        savePreferenceValue,
        saveBoolPreference,
        setProxyEnabledPreference,
        setStartAtWindowsStartupPreference,
        setStartAsMinimizedPreference,
        setCloseToTrayPreference,
        promptAutoLoginDelaySeconds,
        promptBackgroundModeDelayMinutes
    };
}
