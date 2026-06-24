import { normalizeCheckedState } from '../settingsValues';
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
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'xsNotifications',
                    'xsNotifications',
                    enabled
                );
            }}
            onOvrtHudNotificationsChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'ovrtHudNotifications',
                    'ovrtHudNotifications',
                    enabled
                );
            }}
            onOvrtWristNotificationsChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'ovrtWristNotifications',
                    'ovrtWristNotifications',
                    enabled
                );
            }}
            onImageNotificationsChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'imageNotifications',
                    'imageNotifications',
                    enabled
                );
            }}
            onNotificationTimeoutSecondsChange={saveNotificationTimeoutSeconds}
            onNotificationOpacityChange={saveNotificationOpacity}
            onOpenVrNotificationFiltersDialog={() =>
                setVrNotificationsDialogOpen(true)
            }
            onWristOverlayEnabledChange={(checked: any) =>
                saveWristOverlayEnabled(normalizeCheckedState(checked))
            }
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
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'wristOverlayDarkBackground',
                    'wristOverlayDarkBackground',
                    enabled
                );
            }}
            onWristOverlayHidePrivateWorldsChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'wristOverlayHidePrivateWorlds',
                    'wristOverlayHidePrivateWorlds',
                    enabled
                );
            }}
            onWristOverlayShowDevicesChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'wristOverlayShowDevices',
                    'wristOverlayShowDevices',
                    enabled
                );
            }}
            onWristOverlayShowBatteryPercentChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'wristOverlayShowBatteryPercent',
                    'wristOverlayShowBatteryPercent',
                    enabled
                );
            }}
            onOpenWristFeedNotificationsDialog={() =>
                setWristFeedNotificationsDialogOpen(true)
            }
        />
    );
}
