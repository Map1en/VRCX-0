import { useTranslation } from 'react-i18next';

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

import { Field, SettingsGroup } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';
import { useSettingsVrTabState } from '../useSettingsVrTabState';

type SettingsVrPrefs = Pick<
    PreferencesSnapshot,
    | 'hmdNotificationOpacity'
    | 'hmdNotificationPosition'
    | 'hmdNotificationStartMode'
    | 'hmdNotificationTimeout'
    | 'hmdNotificationsEnabled'
    | 'imageNotifications'
    | 'notificationOpacity'
    | 'notificationTimeout'
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
type HmdNotificationStartMode = SettingsVrPrefs['hmdNotificationStartMode'];
type WristOverlayButton = SettingsVrPrefs['wristOverlayButton'];
type WristOverlayHand = SettingsVrPrefs['wristOverlayHand'];
type WristOverlaySize = SettingsVrPrefs['wristOverlaySize'];
type WristOverlayStartMode = SettingsVrPrefs['wristOverlayStartMode'];

type SettingsVrTabContentProps = {
    prefs: SettingsVrPrefs;
    overlayTestMode: boolean;
    overlayTestModeDisabled: boolean;
    onOverlayTestModeChange: (checked: boolean) => void;
    onImageNotificationsChange: (checked: boolean) => void;
    onHmdNotificationOpacityChange: (value: number) => void;
    onHmdNotificationPositionChange: (value: HmdNotificationPosition) => void;
    onHmdNotificationStartModeChange: (value: HmdNotificationStartMode) => void;
    onHmdNotificationTimeoutSecondsChange: (value: string) => void;
    onHmdNotificationsEnabledChange: (checked: boolean) => void;
    onNotificationOpacityChange: (value: number) => void;
    onNotificationTimeoutSecondsChange: (value: string) => void;
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
    ['bottom', 'view.settings.vr.hmd_notifications.position_bottom'],
    ['top', 'view.settings.vr.hmd_notifications.position_top'],
    ['left', 'view.settings.vr.hmd_notifications.position_left'],
    ['right', 'view.settings.vr.hmd_notifications.position_right']
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

export function SettingsVrTabContent({
    prefs,
    overlayTestMode,
    overlayTestModeDisabled,
    onOverlayTestModeChange,
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
    const hmdNotificationsEnabled = prefs.hmdNotificationsEnabled;
    const wristOverlayEnabled = prefs.wristOverlayEnabled;
    const vrDeviceStatusEnabled =
        wristOverlayEnabled && prefs.wristOverlayShowDevices;
    const notificationTimeoutSeconds = Math.max(
        0,
        Math.floor(prefs.notificationTimeout / 1000)
    );
    const notificationOpacity = Math.min(
        100,
        Math.max(0, Math.round(prefs.notificationOpacity))
    );
    const hmdNotificationTimeoutSeconds = Math.max(
        1,
        Math.floor(prefs.hmdNotificationTimeout / 1000)
    );
    const hmdNotificationOpacity = Math.min(
        100,
        Math.max(0, Math.round(prefs.hmdNotificationOpacity))
    );

    return (
        <SettingsTabContent value="vr">
            <SettingsGroup
                title={t(
                    'view.settings.notifications.notifications.vr_notifications.header'
                )}
            >
                <Field
                    label={t(
                        'view.settings.notifications.notifications.vr_notifications.xsoverlay_notifications'
                    )}
                >
                    <Switch
                        checked={prefs.xsNotifications}
                        onCheckedChange={onXsNotificationsChange}
                    />
                </Field>

                <Field
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
                    label={t(
                        'view.settings.notifications.notifications.vr_notifications.ovrtoolkit_wrist_notifications'
                    )}
                >
                    <Switch
                        checked={prefs.ovrtWristNotifications}
                        onCheckedChange={onOvrtWristNotificationsChange}
                    />
                </Field>

                <Field
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
                            onValueChange={(value) =>
                                onNotificationTimeoutSecondsChange(
                                    value === null ? '' : String(value)
                                )
                            }
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
                                onNotificationOpacityChange(
                                    Array.isArray(value) ? value[0] : value
                                )
                            }
                        />
                        <span className="text-muted-foreground w-10 text-right text-sm">
                            {notificationOpacity}%
                        </span>
                    </div>
                </Field>
            </SettingsGroup>

            <SettingsGroup
                title={t('view.settings.vr.hmd_notifications.header')}
            >
                <Field
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
                    label={t('view.settings.vr.hmd_notifications.start_when')}
                    controlId="settings-hmd-notification-start-mode"
                    disabled={!hmdNotificationsEnabled}
                >
                    <Select<HmdNotificationStartMode>
                        value={prefs.hmdNotificationStartMode}
                        items={hmdStartModeOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        disabled={!hmdNotificationsEnabled}
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
                    label={t('view.settings.vr.hmd_notifications.position')}
                    controlId="settings-hmd-notification-position"
                    disabled={!hmdNotificationsEnabled}
                >
                    <Select<HmdNotificationPosition>
                        value={prefs.hmdNotificationPosition}
                        items={hmdPositionOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        disabled={!hmdNotificationsEnabled}
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
                    label={t('view.settings.vr.hmd_notifications.timeout')}
                    controlId="settings-hmd-notification-timeout"
                    disabled={!hmdNotificationsEnabled}
                >
                    <div className="flex items-center justify-end gap-2">
                        <NumberField
                            id="settings-hmd-notification-timeout"
                            min={1}
                            max={30}
                            step={1}
                            value={hmdNotificationTimeoutSeconds}
                            disabled={!hmdNotificationsEnabled}
                            className="w-32"
                            onValueChange={(value) =>
                                onHmdNotificationTimeoutSecondsChange(
                                    value === null ? '' : String(value)
                                )
                            }
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
                    label={t('view.settings.vr.hmd_notifications.opacity')}
                    disabled={!hmdNotificationsEnabled}
                >
                    <div className="flex w-56 max-w-full items-center justify-end gap-3">
                        <Slider
                            value={[hmdNotificationOpacity]}
                            min={0}
                            max={100}
                            step={1}
                            disabled={!hmdNotificationsEnabled}
                            onValueChange={(value) =>
                                onHmdNotificationOpacityChange(
                                    Array.isArray(value) ? value[0] : value
                                )
                            }
                        />
                        <span className="text-muted-foreground w-10 text-right text-sm">
                            {hmdNotificationOpacity}%
                        </span>
                    </div>
                </Field>

                <Field
                    label={t('view.settings.vr.hmd_notifications.filters')}
                    disabled={!hmdNotificationsEnabled}
                >
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!hmdNotificationsEnabled}
                        onClick={onOpenHmdNotificationFiltersDialog}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>
            </SettingsGroup>

            <SettingsGroup title={t('view.settings.vr.wrist_overlay.header')}>
                <Field
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
                    label={t('view.settings.vr.wrist_overlay.start_when')}
                    controlId="settings-wrist-overlay-start-mode"
                    disabled={!wristOverlayEnabled}
                >
                    <Select<WristOverlayStartMode>
                        value={prefs.wristOverlayStartMode}
                        items={wristStartModeOptions.map(
                            ([value, labelKey]) => ({
                                value,
                                label: t(labelKey)
                            })
                        )}
                        disabled={!wristOverlayEnabled}
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
                    label={t('view.settings.vr.wrist_overlay.overlay_button')}
                    controlId="settings-wrist-overlay-button"
                    disabled={!wristOverlayEnabled}
                >
                    <Select<WristOverlayButton>
                        value={prefs.wristOverlayButton}
                        items={wristButtonOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        disabled={!wristOverlayEnabled}
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
                    label={t('view.settings.vr.wrist_overlay.display_on')}
                    controlId="settings-wrist-overlay-hand"
                    disabled={!wristOverlayEnabled}
                >
                    <Select<WristOverlayHand>
                        value={prefs.wristOverlayHand}
                        items={wristHandOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        disabled={!wristOverlayEnabled}
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
                    label={t('view.settings.vr.wrist_overlay.size')}
                    controlId="settings-wrist-overlay-size"
                    disabled={!wristOverlayEnabled}
                >
                    <Select<WristOverlaySize>
                        value={prefs.wristOverlaySize}
                        items={wristSizeOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        disabled={!wristOverlayEnabled}
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
                    label={t('view.settings.vr.wrist_overlay.dark_background')}
                    disabled={!wristOverlayEnabled}
                >
                    <Switch
                        checked={prefs.wristOverlayDarkBackground}
                        disabled={!wristOverlayEnabled}
                        onCheckedChange={onWristOverlayDarkBackgroundChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.vr.wrist_overlay.hide_private_worlds'
                    )}
                    disabled={!wristOverlayEnabled}
                >
                    <Switch
                        checked={prefs.wristOverlayHidePrivateWorlds}
                        disabled={!wristOverlayEnabled}
                        onCheckedChange={onWristOverlayHidePrivateWorldsChange}
                    />
                </Field>

                <Field
                    label={t('view.settings.vr.wrist_overlay.vr_device_status')}
                    disabled={!wristOverlayEnabled}
                >
                    <Switch
                        checked={prefs.wristOverlayShowDevices}
                        disabled={!wristOverlayEnabled}
                        onCheckedChange={onWristOverlayShowDevicesChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.vr.wrist_overlay.battery_percentage'
                    )}
                    disabled={!vrDeviceStatusEnabled}
                >
                    <Switch
                        checked={prefs.wristOverlayShowBatteryPercent}
                        disabled={!vrDeviceStatusEnabled}
                        onCheckedChange={onWristOverlayShowBatteryPercentChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.vr.wrist_overlay.wrist_feed_notifications'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!wristOverlayEnabled}
                        onClick={onOpenWristFeedNotificationsDialog}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>
            </SettingsGroup>

            <SettingsGroup
                title={t('view.settings.vr.test_mode.header')}
                description={t('view.settings.vr.test_mode.description')}
            >
                <Field
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
                        disabled={overlayTestModeDisabled}
                        onCheckedChange={onOverlayTestModeChange}
                    />
                </Field>
            </SettingsGroup>
        </SettingsTabContent>
    );
}
