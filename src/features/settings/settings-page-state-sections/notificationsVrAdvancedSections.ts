import {
    avatarAutoCleanupOptions,
    desktopToastOptions,
    notificationTtsNameModeOptions,
    notificationTtsOptions,
    sqliteTableSizeRows
} from '../settingsOptions';
import type { BuildSettingsPageStateSectionsInput } from '../settingsPageStateSections';
import { normalizeCheckedState } from '../settingsValues';

export function buildNotificationsSection({
    prefs,
    ttsVoices,
    notificationTtsTestVisible,
    notificationTtsTest,
    setDesktopNotificationsDialogOpen,
    setTtsNotificationsDialogOpen,
    saveStringPreference,
    saveBoolPreference,
    saveNotificationTtsMode,
    saveNotificationTtsVoice,
    setNotificationTtsTestVisible,
    setNotificationTtsTest,
    speakNotificationTts
}: BuildSettingsPageStateSectionsInput) {
    return {
        prefs,
        desktopToastOptions,
        notificationTtsOptions,
        notificationTtsNameModeOptions,
        ttsVoices,
        notificationTtsTestVisible,
        notificationTtsTest,
        setDesktopNotificationsDialogOpen,
        setTtsNotificationsDialogOpen,
        saveStringPreference,
        saveBoolPreference,
        saveNotificationTtsMode,
        saveNotificationTtsVoice,
        setNotificationTtsTestVisible,
        setNotificationTtsTest,
        speakNotificationTts
    };
}

export function buildVrSection({
    prefs,
    setVrNotificationsDialogOpen,
    setHmdNotificationsDialogOpen,
    setWristFeedNotificationsDialogOpen,
    savePreferenceValue,
    saveStringPreference,
    saveBoolPreference,
    setIntConfigPreference,
    saveWristOverlayEnabled
}: BuildSettingsPageStateSectionsInput) {
    return {
        prefs,
        setVrNotificationsDialogOpen,
        setHmdNotificationsDialogOpen,
        setWristFeedNotificationsDialogOpen,
        savePreferenceValue,
        saveStringPreference,
        saveBoolPreference,
        setIntConfigPreference,
        saveWristOverlayEnabled
    };
}

export function buildAdvancedSection({
    prefs,
    sqliteTableSizes,
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
    setConfigTreeData,
    migrateLegacyVrcxData
}: BuildSettingsPageStateSectionsInput) {
    return {
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
        setConfigTreeData,
        migrateLegacyVrcxData,
        onAnonymousUsageTelemetryChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveBoolPreference(
                'anonymousUsageTelemetry',
                'anonymousUsageTelemetry',
                enabled
            );
        }
    };
}
