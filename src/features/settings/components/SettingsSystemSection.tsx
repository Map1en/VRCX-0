import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { handleAutoBackgroundDownloadUpdatesPreferenceChange } from '@/services/backgroundMaintenanceService';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { SettingsPageStateSections } from '../settingsPageStateSections';
import { normalizeCheckedState } from '../settingsValues';
import { SettingsSystemTab } from './settings-tabs/SettingsSystemTab';

type SettingsSystemSectionProps = {
    system: SettingsPageStateSections['system'];
};

export function SettingsSystemSection({ system }: SettingsSystemSectionProps) {
    const { t } = useTranslation();
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const {
        prefs,
        savePreferenceValue,
        saveBoolPreference,
        setProxyEnabledPreference,
        setStartAtWindowsStartupPreference,
        setStartAsMinimizedPreference,
        setCloseToTrayPreference,
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
            proxyEnabled={prefs.proxyEnabled}
            proxyServer={prefs.proxyServer}
            onStartAtWindowsStartupChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('isStartAtWindowsStartup', enabled, () =>
                    setStartAtWindowsStartupPreference(enabled)
                );
            }}
            onStartAsMinimizedChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('isStartAsMinimizedState', enabled, () =>
                    setStartAsMinimizedPreference(enabled)
                );
            }}
            onCloseToTrayChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                savePreferenceValue('isCloseToTray', enabled, () =>
                    setCloseToTrayPreference(enabled)
                );
            }}
            onAutoLoginDelayEnabledChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'autoLoginDelayEnabled',
                    'autoLoginDelayEnabled',
                    enabled
                );
            }}
            onBackgroundModeEnabledChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'backgroundModeEnabled',
                    'backgroundModeEnabled',
                    enabled
                );
            }}
            onAutoInstallUpdatesOnStartupChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'autoInstallUpdatesOnStartup',
                    'autoInstallUpdatesOnStartup',
                    enabled
                );
            }}
            onAutoBackgroundDownloadUpdatesChange={async (checked: unknown) => {
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
            onProxyEnabledChange={async (checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                const saved = await savePreferenceValue(
                    'proxyEnabled',
                    enabled,
                    () => setProxyEnabledPreference(enabled)
                );
                if (saved) {
                    toast.success(
                        t('prompt.proxy_settings.saved_restart_required')
                    );
                }
            }}
            onProxySettings={() => {
                setSystemHostOpen('proxySettingsOpen', true);
            }}
        />
    );
}
