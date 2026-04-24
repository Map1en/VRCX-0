import { useSettingsSystem } from '../SettingsPageContext.jsx';

export function SettingsSystemSection() {
    const {
        SettingsSystemTab,
        t,
        formatReleaseDisplayVersion,
        prefs,
        openExternalLink,
        savePreferenceValue,
        setStartAtWindowsStartupPreference,
        setStartAsMinimizedPreference,
        setCloseToTrayPreference,
        promptProxySettings,
        setOpenSourceNoticeOpen
    } = useSettingsSystem();

    return (
        <SettingsSystemTab
            t={t}
            versionText={formatReleaseDisplayVersion(VERSION || '') || '-'}
            isStartAtWindowsStartup={prefs.isStartAtWindowsStartup}
            isStartAsMinimizedState={prefs.isStartAsMinimizedState}
            isCloseToTray={prefs.isCloseToTray}
            onOpenRepository={() =>
                void openExternalLink('https://github.com/Map1en/VRCX-0')
            }
            onOpenSupport={() =>
                void openExternalLink('https://github.com/Map1en/VRCX-0/issues')
            }
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
            onProxySettings={() => void promptProxySettings()}
            onOpenSourceNotice={() => setOpenSourceNoticeOpen(true)}
        />
    );
}
