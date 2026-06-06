import { SettingsVrTab } from './settings-tabs/SettingsVrTab';

export function SettingsVrSection({ vr }: any) {
    const {
        prefs,
        setVrNotificationsDialogOpen,
        setWristFeedNotificationsDialogOpen,
        savePreferenceValue,
        saveStringPreference,
        saveBoolPreference,
        setIntConfigPreference,
        saveWristOverlayEnabled
    } = vr;

    const saveNotificationTimeoutSeconds = (value: any) => {
        const seconds = Number.parseInt(String(value), 10);
        const milliseconds = Number.isFinite(seconds)
            ? Math.min(600000, Math.max(0, seconds * 1000))
            : 3000;
        savePreferenceValue('notificationTimeout', milliseconds, () =>
            setIntConfigPreference('notificationTimeout', milliseconds, {
                min: 0,
                max: 600000,
                fallback: 3000
            })
        );
    };

    const saveNotificationOpacity = (value: any) => {
        const opacity = Number.isFinite(Number(value))
            ? Math.min(100, Math.max(0, Math.round(Number(value))))
            : 100;
        savePreferenceValue('notificationOpacity', opacity, () =>
            setIntConfigPreference('notificationOpacity', opacity, {
                min: 0,
                max: 100,
                fallback: 100
            })
        );
    };

    return (
        <SettingsVrTab
            prefs={prefs}
            onXsNotificationsChange={(checked: any) => {
                saveBoolPreference(
                    'xsNotifications',
                    'xsNotifications',
                    checked
                );
            }}
            onOvrtHudNotificationsChange={(checked: any) => {
                saveBoolPreference(
                    'ovrtHudNotifications',
                    'ovrtHudNotifications',
                    checked
                );
            }}
            onOvrtWristNotificationsChange={(checked: any) => {
                saveBoolPreference(
                    'ovrtWristNotifications',
                    'ovrtWristNotifications',
                    checked
                );
            }}
            onImageNotificationsChange={(checked: any) => {
                saveBoolPreference(
                    'imageNotifications',
                    'imageNotifications',
                    checked
                );
            }}
            onNotificationTimeoutSecondsChange={saveNotificationTimeoutSeconds}
            onNotificationOpacityChange={saveNotificationOpacity}
            onOpenVrNotificationFiltersDialog={() =>
                setVrNotificationsDialogOpen(true)
            }
            onWristOverlayEnabledChange={saveWristOverlayEnabled}
            onWristOverlayStartModeChange={(value: any) => {
                saveStringPreference(
                    'wristOverlayStartMode',
                    'wristOverlayStartMode',
                    value
                );
            }}
            onWristOverlayButtonChange={(value: any) => {
                saveStringPreference(
                    'wristOverlayButton',
                    'wristOverlayButton',
                    value
                );
            }}
            onWristOverlayHandChange={(value: any) => {
                saveStringPreference(
                    'wristOverlayHand',
                    'wristOverlayHand',
                    value
                );
            }}
            onWristOverlaySizeChange={(value: any) => {
                saveStringPreference(
                    'wristOverlaySize',
                    'wristOverlaySize',
                    value
                );
            }}
            onWristOverlayDarkBackgroundChange={(checked: any) => {
                saveBoolPreference(
                    'wristOverlayDarkBackground',
                    'wristOverlayDarkBackground',
                    checked
                );
            }}
            onWristOverlayHidePrivateWorldsChange={(checked: any) => {
                saveBoolPreference(
                    'wristOverlayHidePrivateWorlds',
                    'wristOverlayHidePrivateWorlds',
                    checked
                );
            }}
            onWristOverlayShowDevicesChange={(checked: any) => {
                saveBoolPreference(
                    'wristOverlayShowDevices',
                    'wristOverlayShowDevices',
                    checked
                );
            }}
            onWristOverlayShowBatteryPercentChange={(checked: any) => {
                saveBoolPreference(
                    'wristOverlayShowBatteryPercent',
                    'wristOverlayShowBatteryPercent',
                    checked
                );
            }}
            onOpenWristFeedNotificationsDialog={() =>
                setWristFeedNotificationsDialogOpen(true)
            }
        />
    );
}
