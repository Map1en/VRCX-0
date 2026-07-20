import type { SettingsPageStateSections } from '../settingsPageStateSections';
import { normalizeCheckedState } from '../settingsValues';
import { SettingsAdvancedTab } from './settings-tabs/SettingsAdvancedTab';

type SettingsAdvancedSectionProps = {
    advanced: SettingsPageStateSections['advanced'];
};

export function SettingsAdvancedSection({
    advanced
}: SettingsAdvancedSectionProps) {
    const {
        prefs,
        avatarAutoCleanupOptions,
        sqliteTableSizes,
        sqliteTableSizeRows,
        onlineVisitCount,
        configTreeData,
        appDataDirState,
        saveBoolPreference,
        handleGameLogDisabledChange,
        saveStringPreference,
        setPurgeDialogOpen,
        refreshSqliteTableSizes,
        refreshOnlineVisits,
        refreshConfigTreeData,
        openAppDataDirSelector,
        resetAppDataDir,
        cleanupAppDataDir,
        dismissAppDataDirCleanup,
        setConfigTreeData,
        migrateLegacyVrcxData
    } = advanced;

    const advancedTab = {
        prefs,
        avatarAutoCleanupOptions,
        sqliteTableSizes,
        sqliteTableSizeRows,
        onlineVisitCount,
        configTreeData,
        appDataDirState,
        onRelaunchVRChatAfterCrashChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveBoolPreference(
                'relaunchVRChatAfterCrash',
                'VRCX_relaunchVRChatAfterCrash',
                enabled
            );
        },
        onVrcQuitFixChange: (checked: unknown) => {
            saveBoolPreference(
                'vrcQuitFix',
                'vrcQuitFix',
                normalizeCheckedState(checked)
            );
        },
        onAutoSweepVRChatCacheChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveBoolPreference(
                'autoSweepVRChatCache',
                'VRCX_autoSweepVRChatCache',
                enabled
            );
        },
        onUdonExceptionLoggingChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveBoolPreference(
                'udonExceptionLogging',
                'VRCX_udonExceptionLogging',
                enabled
            );
        },
        onLogResourceLoadChange: (checked: unknown) => {
            saveBoolPreference(
                'logResourceLoad',
                'logResourceLoad',
                normalizeCheckedState(checked)
            );
        },
        onAnonymousUsageTelemetryChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveBoolPreference(
                'anonymousUsageTelemetry',
                'anonymousUsageTelemetry',
                enabled
            );
        },
        onDefaultLaunchModeChange: (value: string) => {
            saveStringPreference(
                'defaultLaunchMode',
                'defaultLaunchMode',
                value
            );
        },
        onGameLogDisabledChange: (checked: unknown) => {
            handleGameLogDisabledChange(normalizeCheckedState(checked));
        },
        onAvatarAutoCleanupChange: (value: string) => {
            saveStringPreference(
                'avatarAutoCleanup',
                'avatarAutoCleanup',
                value
            );
        },
        onOpenPurgeDialog: () => setPurgeDialogOpen(true),
        onMigrateLegacyVrcxData: migrateLegacyVrcxData,
        onRefreshSqliteTableSizes: refreshSqliteTableSizes,
        onRefreshOnlineVisits: refreshOnlineVisits,
        onRefreshConfigTreeData: refreshConfigTreeData,
        onOpenAppDataDirSelector: openAppDataDirSelector,
        onResetAppDataDir: resetAppDataDir,
        onCleanupAppDataDir: cleanupAppDataDir,
        onDismissAppDataDirCleanup: dismissAppDataDirCleanup,
        onClearConfigTreeData: () => setConfigTreeData({})
    };

    return <SettingsAdvancedTab advanced={advancedTab} />;
}
