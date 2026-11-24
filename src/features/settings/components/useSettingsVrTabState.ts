import { useShallow } from 'zustand/react/shallow';

import { setVrOverlayTestMode } from '@/services/vrOverlayTestService';
import {
    type PreferencesSnapshot,
    usePreferencesStore
} from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useVrOverlayTestStore } from '@/state/vrOverlayTestStore';

import { useSettingsPageSection } from '../SettingsPageStateContext';

function secondsInputToMilliseconds(
    value: string,
    min: number,
    max: number,
    fallback: number
): number {
    const seconds = Number.parseInt(value, 10);
    return Number.isFinite(seconds)
        ? Math.min(max, Math.max(min, seconds * 1000))
        : fallback;
}

function roundedBoundedNumber(
    value: number,
    min: number,
    max: number,
    fallback: number
): number {
    return Number.isFinite(value)
        ? Math.min(max, Math.max(min, Math.round(value)))
        : fallback;
}

export function useSettingsVrTabState() {
    const vr = useSettingsPageSection('vr');
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            overlayToast: state.overlayToast,
            xsNotifications: state.xsNotifications,
            ovrtHudNotifications: state.ovrtHudNotifications,
            ovrtWristNotifications: state.ovrtWristNotifications,
            imageNotifications: state.imageNotifications,
            notificationTimeout: state.notificationTimeout,
            notificationOpacity: state.notificationOpacity,
            hmdNotificationsEnabled: state.hmdNotificationsEnabled,
            hmdNotificationTimeout: state.hmdNotificationTimeout,
            hmdNotificationOpacity: state.hmdNotificationOpacity,
            hmdNotificationStartMode: state.hmdNotificationStartMode,
            hmdNotificationPosition: state.hmdNotificationPosition,
            hmdNotificationStyle: state.hmdNotificationStyle,
            hmdNotificationAvatars: state.hmdNotificationAvatars,
            hmdNotificationTrackerDisconnect:
                state.hmdNotificationTrackerDisconnect,
            wristOverlayEnabled: state.wristOverlayEnabled,
            wristOverlayStartMode: state.wristOverlayStartMode,
            wristOverlayButton: state.wristOverlayButton,
            wristOverlayHand: state.wristOverlayHand,
            wristOverlaySize: state.wristOverlaySize,
            wristOverlayDarkBackground: state.wristOverlayDarkBackground,
            wristOverlayHidePrivateWorlds: state.wristOverlayHidePrivateWorlds,
            wristOverlayShowDevices: state.wristOverlayShowDevices,
            wristOverlayShowBatteryPercent:
                state.wristOverlayShowBatteryPercent,
            wristOverlayShowSeconds: state.wristOverlayShowSeconds
        }))
    );
    const isSteamVRRunning = useRuntimeStore(
        (state) => state.gameState.isSteamVRRunning
    );
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const overlayTestMode = useVrOverlayTestStore((state) => state.testMode);
    const overlayTestPending = useVrOverlayTestStore((state) => state.pending);
    const {
        setHmdNotificationsDialogOpen,
        setVrNotificationsDialogOpen,
        setWristFeedNotificationsDialogOpen,
        savePreferenceValue,
        saveStringPreference,
        saveBoolPreference,
        setIntConfigPreference,
        saveWristOverlayEnabled
    } = vr;

    const saveNotificationTimeoutSeconds = (value: string) => {
        const milliseconds = secondsInputToMilliseconds(value, 0, 600000, 3000);
        savePreferenceValue('notificationTimeout', milliseconds, () =>
            setIntConfigPreference('notificationTimeout', milliseconds, {
                min: 0,
                max: 600000,
                fallback: 3000
            })
        );
    };

    const saveNotificationOpacity = (value: number) => {
        const opacity = roundedBoundedNumber(value, 0, 100, 100);
        savePreferenceValue('notificationOpacity', opacity, () =>
            setIntConfigPreference('notificationOpacity', opacity, {
                min: 0,
                max: 100,
                fallback: 100
            })
        );
    };

    const saveHmdNotificationTimeoutSeconds = (value: string) => {
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

    const saveHmdNotificationOpacity = (value: number) => {
        const opacity = roundedBoundedNumber(value, 0, 100, 90);
        savePreferenceValue('hmdNotificationOpacity', opacity, () =>
            setIntConfigPreference('hmdNotificationOpacity', opacity, {
                min: 0,
                max: 100,
                fallback: 90
            })
        );
    };

    return {
        prefs,
        hostPlatform,
        overlayTestMode,
        overlayTestModeDisabled:
            overlayTestPending ||
            (!overlayTestMode && isSteamVRRunning !== true),
        onOverlayTestModeChange: (enabled: boolean) => {
            void setVrOverlayTestMode(enabled);
        },
        onOverlayToastChange: (value: string) => {
            saveStringPreference('overlayToast', 'overlayToast', value);
        },
        onXsNotificationsChange: (enabled: boolean) => {
            saveBoolPreference('xsNotifications', 'xsNotifications', enabled);
        },
        onOvrtHudNotificationsChange: (enabled: boolean) => {
            saveBoolPreference(
                'ovrtHudNotifications',
                'ovrtHudNotifications',
                enabled
            );
        },
        onOvrtWristNotificationsChange: (enabled: boolean) => {
            saveBoolPreference(
                'ovrtWristNotifications',
                'ovrtWristNotifications',
                enabled
            );
        },
        onImageNotificationsChange: (enabled: boolean) => {
            saveBoolPreference(
                'imageNotifications',
                'imageNotifications',
                enabled
            );
        },
        onNotificationTimeoutSecondsChange: saveNotificationTimeoutSeconds,
        onNotificationOpacityChange: saveNotificationOpacity,
        onOpenVrNotificationFiltersDialog: () =>
            setVrNotificationsDialogOpen(true),
        onHmdNotificationsEnabledChange: (enabled: boolean) => {
            saveBoolPreference(
                'hmdNotificationsEnabled',
                'hmdNotificationsEnabled',
                enabled
            );
        },
        onHmdNotificationAvatarsChange: (enabled: boolean) => {
            saveBoolPreference(
                'hmdNotificationAvatars',
                'hmdNotificationAvatars',
                enabled
            );
        },
        onHmdNotificationTrackerDisconnectChange: (enabled: boolean) => {
            saveBoolPreference(
                'hmdNotificationTrackerDisconnect',
                'hmdNotificationTrackerDisconnect',
                enabled
            );
        },
        onHmdNotificationTimeoutSecondsChange:
            saveHmdNotificationTimeoutSeconds,
        onHmdNotificationOpacityChange: saveHmdNotificationOpacity,
        onHmdNotificationStartModeChange: (
            value: PreferencesSnapshot['hmdNotificationStartMode']
        ) => {
            saveStringPreference(
                'hmdNotificationStartMode',
                'hmdNotificationStartMode',
                value
            );
        },
        onHmdNotificationPositionChange: (
            value: PreferencesSnapshot['hmdNotificationPosition']
        ) => {
            saveStringPreference(
                'hmdNotificationPosition',
                'hmdNotificationPosition',
                value
            );
        },
        onHmdNotificationStyleChange: (
            value: PreferencesSnapshot['hmdNotificationStyle']
        ) => {
            saveStringPreference(
                'hmdNotificationStyle',
                'hmdNotificationStyle',
                value
            );
        },
        onOpenHmdNotificationFiltersDialog: () =>
            setHmdNotificationsDialogOpen(true),
        onWristOverlayEnabledChange: saveWristOverlayEnabled,
        onWristOverlayStartModeChange: (
            value: PreferencesSnapshot['wristOverlayStartMode']
        ) => {
            saveStringPreference(
                'wristOverlayStartMode',
                'wristOverlayStartMode',
                value
            );
        },
        onWristOverlayButtonChange: (
            value: PreferencesSnapshot['wristOverlayButton']
        ) => {
            saveStringPreference(
                'wristOverlayButton',
                'wristOverlayButton',
                value
            );
        },
        onWristOverlayHandChange: (
            value: PreferencesSnapshot['wristOverlayHand']
        ) => {
            saveStringPreference('wristOverlayHand', 'wristOverlayHand', value);
        },
        onWristOverlaySizeChange: (
            value: PreferencesSnapshot['wristOverlaySize']
        ) => {
            saveStringPreference('wristOverlaySize', 'wristOverlaySize', value);
        },
        onWristOverlayDarkBackgroundChange: (enabled: boolean) => {
            saveBoolPreference(
                'wristOverlayDarkBackground',
                'wristOverlayDarkBackground',
                enabled
            );
        },
        onWristOverlayHidePrivateWorldsChange: (enabled: boolean) => {
            saveBoolPreference(
                'wristOverlayHidePrivateWorlds',
                'wristOverlayHidePrivateWorlds',
                enabled
            );
        },
        onWristOverlayShowDevicesChange: (enabled: boolean) => {
            saveBoolPreference(
                'wristOverlayShowDevices',
                'wristOverlayShowDevices',
                enabled
            );
        },
        onWristOverlayShowBatteryPercentChange: (enabled: boolean) => {
            saveBoolPreference(
                'wristOverlayShowBatteryPercent',
                'wristOverlayShowBatteryPercent',
                enabled
            );
        },
        onWristOverlayShowSecondsChange: (enabled: boolean) => {
            saveBoolPreference(
                'wristOverlayShowSeconds',
                'wristOverlayShowSeconds',
                enabled
            );
        },
        onOpenWristFeedNotificationsDialog: () =>
            setWristFeedNotificationsDialogOpen(true)
    };
}
