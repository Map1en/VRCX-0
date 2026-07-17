import type { SettingsPageStateSections } from '../settingsPageStateSections';
import { normalizeCheckedState } from '../settingsValues';
import { SettingsVrTab } from './settings-tabs/SettingsVrTab';

type SettingsVrSectionProps = {
    vr: SettingsPageStateSections['vr'];
};

function secondsInputToMilliseconds(
    value: unknown,
    min: number,
    max: number,
    fallback: number
): number {
    const seconds = Number.parseInt(String(value), 10);
    return Number.isFinite(seconds)
        ? Math.min(max, Math.max(min, seconds * 1000))
        : fallback;
}

function roundedBoundedNumber(
    value: unknown,
    min: number,
    max: number,
    fallback: number
): number {
    return Number.isFinite(Number(value))
        ? Math.min(max, Math.max(min, Math.round(Number(value))))
        : fallback;
}

export function SettingsVrSection({ vr }: SettingsVrSectionProps) {
    const {
        prefs,
        setHmdNotificationsDialogOpen,
        setVrNotificationsDialogOpen,
        setWristFeedNotificationsDialogOpen,
        savePreferenceValue,
        saveStringPreference,
        saveBoolPreference,
        setIntConfigPreference,
        saveWristOverlayEnabled
    } = vr;

    const saveNotificationTimeoutSeconds = (value: unknown) => {
        const milliseconds = secondsInputToMilliseconds(value, 0, 600000, 3000);
        savePreferenceValue('notificationTimeout', milliseconds, () =>
            setIntConfigPreference('notificationTimeout', milliseconds, {
                min: 0,
                max: 600000,
                fallback: 3000
            })
        );
    };

    const saveNotificationOpacity = (value: unknown) => {
        const opacity = roundedBoundedNumber(value, 0, 100, 100);
        savePreferenceValue('notificationOpacity', opacity, () =>
            setIntConfigPreference('notificationOpacity', opacity, {
                min: 0,
                max: 100,
                fallback: 100
            })
        );
    };

    const saveHmdNotificationTimeoutSeconds = (value: unknown) => {
        const milliseconds = secondsInputToMilliseconds(
            value,
            1000,
            30000,
            5000
        );
        savePreferenceValue('hmdNotificationTimeout', milliseconds, () =>
            setIntConfigPreference('hmdNotificationTimeout', milliseconds, {
                min: 1000,
                max: 30000,
                fallback: 5000
            })
        );
    };

    const saveHmdNotificationOpacity = (value: unknown) => {
        const opacity = roundedBoundedNumber(value, 0, 100, 100);
        savePreferenceValue('hmdNotificationOpacity', opacity, () =>
            setIntConfigPreference('hmdNotificationOpacity', opacity, {
                min: 0,
                max: 100,
                fallback: 100
            })
        );
    };

    return (
        <SettingsVrTab
            prefs={prefs}
            onXsNotificationsChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'xsNotifications',
                    'xsNotifications',
                    enabled
                );
            }}
            onOvrtHudNotificationsChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'ovrtHudNotifications',
                    'ovrtHudNotifications',
                    enabled
                );
            }}
            onOvrtWristNotificationsChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'ovrtWristNotifications',
                    'ovrtWristNotifications',
                    enabled
                );
            }}
            onImageNotificationsChange={(checked: unknown) => {
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
            onHmdNotificationsEnabledChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'hmdNotificationsEnabled',
                    'hmdNotificationsEnabled',
                    enabled
                );
            }}
            onHmdNotificationTimeoutSecondsChange={
                saveHmdNotificationTimeoutSeconds
            }
            onHmdNotificationOpacityChange={saveHmdNotificationOpacity}
            onHmdNotificationStartModeChange={(value: string) => {
                saveStringPreference(
                    'hmdNotificationStartMode',
                    'hmdNotificationStartMode',
                    value
                );
            }}
            onHmdNotificationPositionChange={(value: string) => {
                saveStringPreference(
                    'hmdNotificationPosition',
                    'hmdNotificationPosition',
                    value
                );
            }}
            onOpenHmdNotificationFiltersDialog={() =>
                setHmdNotificationsDialogOpen(true)
            }
            onWristOverlayEnabledChange={(checked: unknown) =>
                saveWristOverlayEnabled(normalizeCheckedState(checked))
            }
            onWristOverlayStartModeChange={(value: string) => {
                saveStringPreference(
                    'wristOverlayStartMode',
                    'wristOverlayStartMode',
                    value
                );
            }}
            onWristOverlayButtonChange={(value: string) => {
                saveStringPreference(
                    'wristOverlayButton',
                    'wristOverlayButton',
                    value
                );
            }}
            onWristOverlayHandChange={(value: string) => {
                saveStringPreference(
                    'wristOverlayHand',
                    'wristOverlayHand',
                    value
                );
            }}
            onWristOverlaySizeChange={(value: string) => {
                saveStringPreference(
                    'wristOverlaySize',
                    'wristOverlaySize',
                    value
                );
            }}
            onWristOverlayDarkBackgroundChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'wristOverlayDarkBackground',
                    'wristOverlayDarkBackground',
                    enabled
                );
            }}
            onWristOverlayHidePrivateWorldsChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'wristOverlayHidePrivateWorlds',
                    'wristOverlayHidePrivateWorlds',
                    enabled
                );
            }}
            onWristOverlayShowDevicesChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'wristOverlayShowDevices',
                    'wristOverlayShowDevices',
                    enabled
                );
            }}
            onWristOverlayShowBatteryPercentChange={(checked: unknown) => {
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
