import { handleAutoBackgroundDownloadUpdatesPreferenceChange } from '@/services/backgroundMaintenanceService';
import { useRuntimeStore } from '@/state/runtimeStore';

import { normalizeCheckedState } from '../settingsValues';
import { SettingsSystemTab } from './settings-tabs/SettingsSystemTab';

export function SettingsSystemSection({ system }: any) {
    const hostPlatform = useRuntimeStore(
        (state: any) => state.hostCapabilities.platform
    );
    const {
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
            hostPlatform={hostPlatform}
            isStartAtWindowsStartup={prefs.isStartAtWindowsStartup}
            isStartAsMinimizedState={prefs.isStartAsMinimizedState}
            isCloseToTray={prefs.isCloseToTray}
            autoLoginDelayEnabled={prefs.autoLoginDelayEnabled}
            autoLoginDelaySeconds={prefs.autoLoginDelaySeconds}
            autoInstallUpdatesOnStartup={prefs.autoInstallUpdatesOnStartup}
            autoBackgroundDownloadUpdates={prefs.autoBackgroundDownloadUpdates}
            backgroundModeEnabled={prefs.backgroundModeEnabled}
            onStartAtWindowsStartupChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('isStartAtWindowsStartup', enabled, () =>
                    setStartAtWindowsStartupPreference(enabled)
                );
            }}
            onStartAsMinimizedChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('isStartAsMinimizedState', enabled, () =>
                    setStartAsMinimizedPreference(enabled)
                );
            }}
            onCloseToTrayChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('isCloseToTray', enabled, () =>
                    setCloseToTrayPreference(enabled)
                );
            }}
            onAutoLoginDelayEnabledChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'autoLoginDelayEnabled',
                    'autoLoginDelayEnabled',
                    enabled
                );
            }}
            onBackgroundModeEnabledChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'backgroundModeEnabled',
                    'backgroundModeEnabled',
                    enabled
                );
            }}
            onAutoInstallUpdatesOnStartupChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'autoInstallUpdatesOnStartup',
                    'autoInstallUpdatesOnStartup',
                    enabled
                );
            }}
            onAutoBackgroundDownloadUpdatesChange={async (checked: any) => {
                const enabled = normalizeCheckedState(checked);
                await saveBoolPreference(
                    'autoBackgroundDownloadUpdates',
                    'autoBackgroundDownloadUpdates',
                    enabled
                );
                await handleAutoBackgroundDownloadUpdatesPreferenceChange(
                    enabled
                );
            }}
            onPromptAutoLoginDelaySeconds={() => {
                promptAutoLoginDelaySeconds();
            }}
            onProxySettings={() => {
                promptProxySettings();
            }}
        />
    );
}
