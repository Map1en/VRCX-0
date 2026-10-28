import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { HostPlatform } from '@/platform/tauri/bindings';
import type { PreferencesSnapshot } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
} from '@/ui/shadcn/number-field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Slider } from '@/ui/shadcn/slider';
import { Switch } from '@/ui/shadcn/switch';

import { SETTINGS_DEFAULT_VALUES } from '../../settingsFieldState';
import { overlayToastOptions } from '../../settingsOptions';
import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';
import { useSettingsVrTabState } from '../useSettingsVrTabState';

type SettingsVrPrefs = Pick<
    PreferencesSnapshot,
    | 'hmdNotificationOpacity'
    | 'hmdNotificationPosition'
    | 'hmdNotificationStyle'
    | 'hmdNotificationAvatars'
    | 'hmdNotificationTrackerDisconnect'
    | 'hmdNotificationStartMode'
    | 'hmdNotificationTimeout'
    | 'hmdNotificationsEnabled'
    | 'imageNotifications'
    | 'notificationOpacity'
    | 'notificationTimeout'
    | 'overlayToast'
    | 'ovrtHudNotifications'
    | 'ovrtWristNotifications'
    | 'wristOverlayButton'
    | 'wristOverlayDarkBackground'
    | 'wristOverlayEnabled'
    | 'wristOverlayHand'
    | 'wristOverlayHidePrivateWorlds'
    | 'wristOverlayShowBatteryPercent'
    | 'wristOverlayShowDevices'
    | 'wristOverlaySize'
    | 'wristOverlayStartMode'
    | 'xsNotifications'
>;

type HmdNotificationPosition = SettingsVrPrefs['hmdNotificationPosition'];
type HmdNotificationStyle = SettingsVrPrefs['hmdNotificationStyle'];
type HmdNotificationStartMode = SettingsVrPrefs['hmdNotificationStartMode'];
type WristOverlayButton = SettingsVrPrefs['wristOverlayButton'];
type WristOverlayHand = SettingsVrPrefs['wristOverlayHand'];
type WristOverlaySize = SettingsVrPrefs['wristOverlaySize'];
type WristOverlayStartMode = SettingsVrPrefs['wristOverlayStartMode'];

type SettingsVrTabContentProps = {
    prefs: SettingsVrPrefs;
    hostPlatform: HostPlatform;
    overlayTestMode: boolean;
    overlayTestModeDisabled: boolean;
    onOverlayTestModeChange: (checked: boolean) => void;
    onImageNotificationsChange: (checked: boolean) => void;
    onHmdNotificationOpacityChange: (value: number) => void;
    onHmdNotificationPositionChange: (value: HmdNotificationPosition) => void;
    onHmdNotificationStyleChange: (value: HmdNotificationStyle) => void;
    onHmdNotificationAvatarsChange: (checked: boolean) => void;
    onHmdNotificationTrackerDisconnectChange: (checked: boolean) => void;
    onHmdNotificationStartModeChange: (value: HmdNotificationStartMode) => void;
    onHmdNotificationTimeoutSecondsChange: (value: string) => void;
    onHmdNotificationsEnabledChange: (checked: boolean) => void;
    onNotificationOpacityChange: (value: number) => void;
    onNotificationTimeoutSecondsChange: (value: string) => void;
    onOverlayToastChange: (value: string) => void;
    onOpenHmdNotificationFiltersDialog: () => void;
    onOpenVrNotificationFiltersDialog: () => void;
    onOpenWristFeedNotificationsDialog: () => void;
    onOvrtHudNotificationsChange: (checked: boolean) => void;
    onOvrtWristNotificationsChange: (checked: boolean) => void;
    onWristOverlayButtonChange: (value: WristOverlayButton) => void;
    onWristOverlayDarkBackgroundChange: (checked: boolean) => void;
    onWristOverlayEnabledChange: (checked: boolean) => void;
    onWristOverlayHandChange: (value: WristOverlayHand) => void;
    onWristOverlayHidePrivateWorldsChange: (checked: boolean) => void;
    onWristOverlayShowBatteryPercentChange: (checked: boolean) => void;
    onWristOverlayShowDevicesChange: (checked: boolean) => void;
    onWristOverlaySizeChange: (value: WristOverlaySize) => void;
    onWristOverlayStartModeChange: (value: WristOverlayStartMode) => void;
    onXsNotificationsChange: (checked: boolean) => void;
};

const hmdStartModeOptions = [
    ['steamvr', 'view.settings.vr.hmd_notifications.start_when_steamvr'],
    [
        'vrchatVrMode',
        'view.settings.vr.hmd_notifications.start_when_vrchat_vr_mode'
    ]
] as const;

const hmdPositionOptions = [
    ['top', 'view.settings.vr.hmd_notifications.position_top'],
    ['center', 'view.settings.vr.hmd_notifications.position_center'],
    ['bottom', 'view.settings.vr.hmd_notifications.position_bottom']
] as const;

const hmdStyleOptions = [
    ['standard', 'view.settings.vr.hmd_notifications.style_standard'],
    ['compact', 'view.settings.vr.hmd_notifications.style_compact']
] as const;

const wristStartModeOptions = [
    ['steamvr', 'view.settings.vr.wrist_overlay.start_when_steamvr'],
    ['vrchatVrMode', 'view.settings.vr.wrist_overlay.start_when_vrchat_vr_mode']
] as const;

const wristButtonOptions = [
    ['grip', 'view.settings.vr.wrist_overlay.overlay_button_grip'],
    ['menu', 'view.settings.vr.wrist_overlay.overlay_button_menu']
] as const;

const wristHandOptions = [
    ['left', 'view.settings.vr.wrist_overlay.display_on_left'],
    ['right', 'view.settings.vr.wrist_overlay.display_on_right'],
    ['both', 'view.settings.vr.wrist_overlay.display_on_both']
] as const;

const wristSizeOptions = [
    ['compact', 'view.settings.vr.wrist_overlay.size_compact'],
    ['normal', 'view.settings.vr.wrist_overlay.size_normal'],
    ['large', 'view.settings.vr.wrist_overlay.size_large']
] as const;

export function SettingsVrTab() {
    const state = useSettingsVrTabState();
    return <SettingsVrTabContent {...state} />;
}

function SettingsVrTabContent({
    prefs,
    hostPlatform,
    overlayTestMode,
    overlayTestModeDisabled,
    onOverlayTestModeChange,
    onOverlayToastChange,
    onXsNotificationsChange,
    onOvrtHudNotificationsChange,
    onOvrtWristNotificationsChange,
    onImageNotificationsChange,
    onNotificationTimeoutSecondsChange,
    onNotificationOpacityChange,
    onOpenVrNotificationFiltersDialog,
    onHmdNotificationsEnabledChange,
    onHmdNotificationTimeoutSecondsChange,
    onHmdNotificationOpacityChange,
    onHmdNotificationPositionChange,
    onHmdNotificationStyleChange,
    onHmdNotificationAvatarsChange,
    onHmdNotificationTrackerDisconnectChange,
    onHmdNotificationStartModeChange,
    onOpenHmdNotificationFiltersDialog,
    onWristOverlayEnabledChange,
    onWristOverlayStartModeChange,
    onWristOverlayButtonChange,
    onWristOverlayHandChange,
    onWristOverlaySizeChange,
    onWristOverlayDarkBackgroundChange,
    onWristOverlayHidePrivateWorldsChange,
    onWristOverlayShowDevicesChange,
    onWristOverlayShowBatteryPercentChange,
    onOpenWristFeedNotificationsDialog
}: SettingsVrTabContentProps) {
    const { t } = useTranslation();
    const [draftNotificationTimeout, setDraftNotificationTimeout] = useState<
        number | null
    >(null);
    const [draftNotificationOpacity, setDraftNotificationOpacity] = useState<
        number | null
    >(null);
    const [draftHmdNotificationTimeout, setDraftHmdNotificationTimeout] =
        useState<number | null>(null);
    const [draftHmdNotificationOpacity, setDraftHmdNotificationOpacity] =
        useState<number | null>(null);
    const isLinux = hostPlatform === 'linux';
    const vrNotificationsEnabled =
        prefs.xsNotifications ||
        (!isLinux &&
            (prefs.ovrtHudNotifications || prefs.ovrtWristNotifications)) ||
        prefs.hmdNotificationsEnabled;
    const hmdNotificationsEnabled = prefs.hmdNotificationsEnabled;
    const wristOverlayEnabled = prefs.wristOverlayEnabled;
    const notificationTimeoutSeconds =
        draftNotificationTimeout ??
        Math.max(0, Math.floor(prefs.notificationTimeout / 1000));
    const notificationOpacity =
        draftNotificationOpacity ??
        Math.min(100, Math.max(0, Math.round(prefs.notificationOpacity)));
    const hmdNotificationTimeoutSeconds =
        draftHmdNotificationTimeout ??
        Math.max(1, Math.floor(prefs.hmdNotificationTimeout / 1000));
    const hmdNotificationOpacity =
        draftHmdNotificationOpacity ??
        Math.min(100, Math.max(0, Math.round(prefs.hmdNotificationOpacity)));

    return (
        <SettingsTabContent value="vr">
            <SettingsCard
                cardId="vr.notifications"
                title={t(
                    'view.settings.notifications.notifications.vr_notifications.header'
                )}
            >
                <Field
                    settingId="vr.notifications.when-to-display"
                    onReset={() =>
                        onOverlayToastChange(
                            SETTINGS_DEFAULT_VALUES.overlayToast
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.vr_notifications.when_to_display'
                    )}
                    description={t(
                        isLinux
                            ? 'view.settings.notifications.notifications.vr_notifications.when_to_display_description_linux'
                            : 'view.settings.notifications.notifications.vr_notifications.when_to_display_description'
                    )}
                    controlId="settings-overlay-toast"
                    disabled={!vrNotificationsEnabled}
                >
                    <Select
                        value={prefs.overlayToast}
                        items={overlayToastOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={(value) =>
                            onOverlayToastChange(value ?? '')
                        }
                    >
                        <SelectTrigger
                            id="settings-overlay-toast"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {overlayToastOptions.map(
                                    ([value, labelKey]) => (
                                        <SelectItem key={value} value={value}>
                                            {t(labelKey)}
                                        </SelectItem>
                                    )
                                )}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    settingId="vr.notifications.xsoverlay"
                    onReset={() =>
                        onXsNotificationsChange(
                            SETTINGS_DEFAULT_VALUES.xsNotifications
                        )
                    }
                    label={t(
                        isLinux
                            ? 'view.settings.notifications.notifications.vr_notifications.wayvr_notifications'
                            : 'view.settings.notifications.notifications.vr_notifications.xsoverlay_notifications'
                    )}
                >
                    <Switch
                        checked={prefs.xsNotifications}
                        onCheckedChange={onXsNotificationsChange}
                    />
                </Field>

                {isLinux ? null : (
                    <>
                        <Field
                            settingId="vr.notifications.ovrtoolkit-hud"
                            onReset={() =>
                                onOvrtHudNotificationsChange(
                                    SETTINGS_DEFAULT_VALUES.ovrtHudNotifications
                                )
                            }
                            label={t(
                                'view.settings.notifications.notifications.vr_notifications.ovrtoolkit_hud_notifications'
                            )}
                        >
                            <Switch
                                checked={prefs.ovrtHudNotifications}
                                onCheckedChange={onOvrtHudNotificationsChange}
                            />
                        </Field>

                        <Field
                            settingId="vr.notifications.ovrtoolkit-wrist"
                            onReset={() =>
                                onOvrtWristNotificationsChange(
                                    SETTINGS_DEFAULT_VALUES.ovrtWristNotifications
                                )
                            }
                            label={t(
                                'view.settings.notifications.notifications.vr_notifications.ovrtoolkit_wrist_notifications'
                            )}
                        >
                            <Switch
                                checked={prefs.ovrtWristNotifications}
                                onCheckedChange={onOvrtWristNotificationsChange}
                            />
                        </Field>
                    </>
                )}

                <Field
                    settingId="vr.notifications.filters"
                    label={t(
                        'view.settings.notifications.notifications.vr_notifications.notification_filters'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onOpenVrNotificationFiltersDialog}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>

                <Field
                    settingId="vr.notifications.user-images"
                    onReset={() =>
                        onImageNotificationsChange(
                            SETTINGS_DEFAULT_VALUES.imageNotifications
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.vr_notifications.user_images'
                    )}
                >
                    <Switch
                        checked={prefs.imageNotifications}
                        onCheckedChange={onImageNotificationsChange}
                    />
                </Field>

                <Field
                    settingId="vr.notifications.timeout"
                    onReset={() =>
                        onNotificationTimeoutSecondsChange(
                            String(
                                SETTINGS_DEFAULT_VALUES.notificationTimeout /
                                    1000
                            )
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.vr_notifications.notification_timeout'
                    )}
                    controlId="settings-notification-timeout"
                >
                    <div className="flex items-center justify-end gap-2">
                        <NumberField
                            id="settings-notification-timeout"
                            min={0}
                            max={600}
                            step={1}
                            value={notificationTimeoutSeconds}
                            className="w-32"
                            onValueChange={setDraftNotificationTimeout}
                            onValueCommitted={(value) => {
                                setDraftNotificationTimeout(null);
                                onNotificationTimeoutSecondsChange(
                                    value === null ? '' : String(value)
                                );
                            }}
                        >
                            <NumberFieldGroup>
                                <NumberFieldDecrement />
                                <NumberFieldInput />
                                <NumberFieldIncrement />
                            </NumberFieldGroup>
                        </NumberField>
                        <span className="text-muted-foreground w-8 text-sm">
                            s
                        </span>
                    </div>
                </Field>

                <Field
                    settingId="vr.notifications.opacity"
                    onReset={() =>
                        onNotificationOpacityChange(
                            SETTINGS_DEFAULT_VALUES.notificationOpacity
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.vr_notifications.notification_opacity'
                    )}
                >
                    <div className="flex w-56 max-w-full items-center justify-end gap-3">
                        <Slider
                            value={[notificationOpacity]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={(value) =>
                                setDraftNotificationOpacity(
                                    Array.isArray(value) ? value[0] : value
                                )
                            }
                            onValueCommitted={(value) => {
                                setDraftNotificationOpacity(null);
                                onNotificationOpacityChange(
                                    Array.isArray(value) ? value[0] : value
                                );
                            }}
                        />
                        <span className="text-muted-foreground w-10 text-right text-sm">
                            {notificationOpacity}%
                        </span>
                    </div>
                </Field>
            </SettingsCard>

            <SettingsCard
                cardId="vr.hmd"
                title={t('view.settings.vr.hmd_notifications.header')}
            >
                <Field
                    settingId="vr.hmd.enabled"
                    onReset={() =>
                        onHmdNotificationsEnabledChange(
                            SETTINGS_DEFAULT_VALUES.hmdNotificationsEnabled
                        )
                    }
                    label={t(
                        'view.settings.vr.hmd_notifications.hmd_notifications'
                    )}
                >
                    <Switch
                        checked={hmdNotificationsEnabled}
                        onCheckedChange={onHmdNotificationsEnabledChange}
                    />
                </Field>

                <Field
                    settingId="vr.hmd.start-mode"
                    onReset={() =>
                        onHmdNotificationStartModeChange(
                            SETTINGS_DEFAULT_VALUES.hmdNotificationStartMode
                        )
                    }
                    label={t('view.settings.vr.hmd_notifications.start_when')}
                    controlId="settings-hmd-notification-start-mode"
                >
                    <Select<HmdNotificationStartMode>
                        value={prefs.hmdNotificationStartMode}
                        items={hmdStartModeOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={(value) => {
                            if (value) {
                                onHmdNotificationStartModeChange(value);
                            }
                        }}
                    >
                        <SelectTrigger
                            id="settings-hmd-notification-start-mode"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {hmdStartModeOptions.map(
                                    ([value, labelKey]) => (
                                        <SelectItem key={value} value={value}>
                                            {t(labelKey)}
                                        </SelectItem>
                                    )
                                )}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    settingId="vr.hmd.position"
                    onReset={() =>
                        onHmdNotificationPositionChange(
                            SETTINGS_DEFAULT_VALUES.hmdNotificationPosition
                        )
                    }
                    label={t('view.settings.vr.hmd_notifications.position')}
                    controlId="settings-hmd-notification-position"
                >
                    <Select<HmdNotificationPosition>
                        value={prefs.hmdNotificationPosition}
                        items={hmdPositionOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={(value) => {
                            if (value) {
                                onHmdNotificationPositionChange(value);
                            }
                        }}
                    >
                        <SelectTrigger
                            id="settings-hmd-notification-position"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {hmdPositionOptions.map(([value, labelKey]) => (
                                    <SelectItem key={value} value={value}>
                                        {t(labelKey)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    settingId="vr.hmd.style"
                    onReset={() =>
                        onHmdNotificationStyleChange(
                            SETTINGS_DEFAULT_VALUES.hmdNotificationStyle
                        )
                    }
                    label={t('view.settings.vr.hmd_notifications.style')}
                    controlId="settings-hmd-notification-style"
                >
                    <Select<HmdNotificationStyle>
                        value={prefs.hmdNotificationStyle}
                        items={hmdStyleOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={(value) => {
                            if (value) {
                                onHmdNotificationStyleChange(value);
                            }
                        }}
                    >
                        <SelectTrigger
                            id="settings-hmd-notification-style"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {hmdStyleOptions.map(([value, labelKey]) => (
                                    <SelectItem key={value} value={value}>
                                        {t(labelKey)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    settingId="vr.hmd.friend-icons"
                    onReset={() =>
                        onHmdNotificationAvatarsChange(
                            SETTINGS_DEFAULT_VALUES.hmdNotificationAvatars
                        )
                    }
                    label={t('view.settings.vr.hmd_notifications.friend_icons')}
                >
                    <Switch
                        checked={prefs.hmdNotificationAvatars}
                        onCheckedChange={onHmdNotificationAvatarsChange}
                    />
                </Field>

                <Field
                    settingId="vr.hmd.tracker-disconnect"
                    onReset={() =>
                        onHmdNotificationTrackerDisconnectChange(
                            SETTINGS_DEFAULT_VALUES.hmdNotificationTrackerDisconnect
                        )
                    }
                    label={t(
                        'view.settings.vr.hmd_notifications.tracker_disconnect'
                    )}
                >
                    <Switch
                        checked={prefs.hmdNotificationTrackerDisconnect}
                        onCheckedChange={
                            onHmdNotificationTrackerDisconnectChange
                        }
                    />
                </Field>

                <Field
                    settingId="vr.hmd.timeout"
                    onReset={() =>
                        onHmdNotificationTimeoutSecondsChange(
                            String(
                                SETTINGS_DEFAULT_VALUES.hmdNotificationTimeout /
                                    1000
                            )
                        )
                    }
                    label={t('view.settings.vr.hmd_notifications.timeout')}
                    controlId="settings-hmd-notification-timeout"
                >
                    <div className="flex items-center justify-end gap-2">
                        <NumberField
                            id="settings-hmd-notification-timeout"
                            min={1}
                            max={30}
                            step={1}
                            value={hmdNotificationTimeoutSeconds}
                            className="w-32"
                            onValueChange={setDraftHmdNotificationTimeout}
                            onValueCommitted={(value) => {
                                setDraftHmdNotificationTimeout(null);
                                onHmdNotificationTimeoutSecondsChange(
                                    value === null ? '' : String(value)
                                );
                            }}
                        >
                            <NumberFieldGroup>
                                <NumberFieldDecrement />
                                <NumberFieldInput />
                                <NumberFieldIncrement />
                            </NumberFieldGroup>
                        </NumberField>
                        <span className="text-muted-foreground w-8 text-sm">
                            s
                        </span>
                    </div>
                </Field>

                <Field
                    settingId="vr.hmd.opacity"
                    onReset={() =>
                        onHmdNotificationOpacityChange(
                            SETTINGS_DEFAULT_VALUES.hmdNotificationOpacity
                        )
                    }
                    label={t('view.settings.vr.hmd_notifications.opacity')}
                >
                    <div className="flex w-56 max-w-full items-center justify-end gap-3">
                        <Slider
                            value={[hmdNotificationOpacity]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={(value) =>
                                setDraftHmdNotificationOpacity(
                                    Array.isArray(value) ? value[0] : value
                                )
                            }
                            onValueCommitted={(value) => {
                                setDraftHmdNotificationOpacity(null);
                                onHmdNotificationOpacityChange(
                                    Array.isArray(value) ? value[0] : value
                                );
                            }}
                        />
                        <span className="text-muted-foreground w-10 text-right text-sm">
                            {hmdNotificationOpacity}%
                        </span>
                    </div>
                </Field>

                <Field
                    settingId="vr.hmd.filters"
                    label={t('view.settings.vr.hmd_notifications.filters')}
                >
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onOpenHmdNotificationFiltersDialog}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>
            </SettingsCard>

            <SettingsCard
                cardId="vr.wrist"
                title={t('view.settings.vr.wrist_overlay.header')}
            >
                <Field
                    settingId="vr.wrist.enabled"
                    onReset={() =>
                        onWristOverlayEnabledChange(
                            SETTINGS_DEFAULT_VALUES.wristOverlayEnabled
                        )
                    }
                    label={t(
                        'view.settings.vr.wrist_overlay.wrist_feed_overlay'
                    )}
                >
                    <Switch
                        checked={wristOverlayEnabled}
                        onCheckedChange={onWristOverlayEnabledChange}
                    />
                </Field>

                <Field
                    settingId="vr.wrist.start-mode"
                    onReset={() =>
                        onWristOverlayStartModeChange(
                            SETTINGS_DEFAULT_VALUES.wristOverlayStartMode
                        )
                    }
                    label={t('view.settings.vr.wrist_overlay.start_when')}
                    controlId="settings-wrist-overlay-start-mode"
                >
                    <Select<WristOverlayStartMode>
                        value={prefs.wristOverlayStartMode}
                        items={wristStartModeOptions.map(
                            ([value, labelKey]) => ({
                                value,
                                label: t(labelKey)
                            })
                        )}
                        onValueChange={(value) => {
                            if (value) {
                                onWristOverlayStartModeChange(value);
                            }
                        }}
                    >
                        <SelectTrigger
                            id="settings-wrist-overlay-start-mode"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {wristStartModeOptions.map(
                                    ([value, labelKey]) => (
                                        <SelectItem key={value} value={value}>
                                            {t(labelKey)}
                                        </SelectItem>
                                    )
                                )}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    settingId="vr.wrist.button"
                    onReset={() =>
                        onWristOverlayButtonChange(
                            SETTINGS_DEFAULT_VALUES.wristOverlayButton
                        )
                    }
                    label={t('view.settings.vr.wrist_overlay.overlay_button')}
                    controlId="settings-wrist-overlay-button"
                >
                    <Select<WristOverlayButton>
                        value={prefs.wristOverlayButton}
                        items={wristButtonOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={(value) => {
                            if (value) {
                                onWristOverlayButtonChange(value);
                            }
                        }}
                    >
                        <SelectTrigger
                            id="settings-wrist-overlay-button"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {wristButtonOptions.map(([value, labelKey]) => (
                                    <SelectItem key={value} value={value}>
                                        {t(labelKey)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    settingId="vr.wrist.hand"
                    onReset={() =>
                        onWristOverlayHandChange(
                            SETTINGS_DEFAULT_VALUES.wristOverlayHand
                        )
                    }
                    label={t('view.settings.vr.wrist_overlay.display_on')}
                    controlId="settings-wrist-overlay-hand"
                >
                    <Select<WristOverlayHand>
                        value={prefs.wristOverlayHand}
                        items={wristHandOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={(value) => {
                            if (value) {
                                onWristOverlayHandChange(value);
                            }
                        }}
                    >
                        <SelectTrigger
                            id="settings-wrist-overlay-hand"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {wristHandOptions.map(([value, labelKey]) => (
                                    <SelectItem key={value} value={value}>
                                        {t(labelKey)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    settingId="vr.wrist.size"
                    onReset={() =>
                        onWristOverlaySizeChange(
                            SETTINGS_DEFAULT_VALUES.wristOverlaySize
                        )
                    }
                    label={t('view.settings.vr.wrist_overlay.size')}
                    controlId="settings-wrist-overlay-size"
                >
                    <Select<WristOverlaySize>
                        value={prefs.wristOverlaySize}
                        items={wristSizeOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={(value) => {
                            if (value) {
                                onWristOverlaySizeChange(value);
                            }
                        }}
                    >
                        <SelectTrigger
                            id="settings-wrist-overlay-size"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {wristSizeOptions.map(([value, labelKey]) => (
                                    <SelectItem key={value} value={value}>
                                        {t(labelKey)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    settingId="vr.wrist.dark-background"
                    onReset={() =>
                        onWristOverlayDarkBackgroundChange(
                            SETTINGS_DEFAULT_VALUES.wristOverlayDarkBackground
                        )
                    }
                    label={t('view.settings.vr.wrist_overlay.dark_background')}
                >
                    <Switch
                        checked={prefs.wristOverlayDarkBackground}
                        onCheckedChange={onWristOverlayDarkBackgroundChange}
                    />
                </Field>

                <Field
                    settingId="vr.wrist.hide-private-worlds"
                    onReset={() =>
                        onWristOverlayHidePrivateWorldsChange(
                            SETTINGS_DEFAULT_VALUES.wristOverlayHidePrivateWorlds
                        )
                    }
                    label={t(
                        'view.settings.vr.wrist_overlay.hide_private_worlds'
                    )}
                >
                    <Switch
                        checked={prefs.wristOverlayHidePrivateWorlds}
                        onCheckedChange={onWristOverlayHidePrivateWorldsChange}
                    />
                </Field>

                <Field
                    settingId="vr.wrist.device-status"
                    onReset={() =>
                        onWristOverlayShowDevicesChange(
                            SETTINGS_DEFAULT_VALUES.wristOverlayShowDevices
                        )
                    }
                    label={t('view.settings.vr.wrist_overlay.vr_device_status')}
                >
                    <Switch
                        checked={prefs.wristOverlayShowDevices}
                        onCheckedChange={onWristOverlayShowDevicesChange}
                    />
                </Field>

                <Field
                    settingId="vr.wrist.battery-percent"
                    onReset={() =>
                        onWristOverlayShowBatteryPercentChange(
                            SETTINGS_DEFAULT_VALUES.wristOverlayShowBatteryPercent
                        )
                    }
                    label={t(
                        'view.settings.vr.wrist_overlay.battery_percentage'
                    )}
                >
                    <Switch
                        checked={prefs.wristOverlayShowBatteryPercent}
                        onCheckedChange={onWristOverlayShowBatteryPercentChange}
                    />
                </Field>

                <Field
                    settingId="vr.wrist.notifications"
                    label={t(
                        'view.settings.vr.wrist_overlay.wrist_feed_notifications'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onOpenWristFeedNotificationsDialog}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>
            </SettingsCard>

            <SettingsCard
                cardId="vr.test"
                title={t('view.settings.vr.test_mode.header')}
                description={t('view.settings.vr.test_mode.description')}
            >
                <Field
                    settingId="vr.test.force-display"
                    label={t('view.settings.vr.test_mode.force_display')}
                    description={
                        overlayTestModeDisabled && !overlayTestMode
                            ? t('view.settings.vr.test_mode.requires_steamvr')
                            : undefined
                    }
                    disabled={overlayTestModeDisabled}
                >
                    <Switch
                        checked={overlayTestMode}
                        onCheckedChange={onOverlayTestModeChange}
                    />
                </Field>
            </SettingsCard>
        </SettingsTabContent>
    );
}
