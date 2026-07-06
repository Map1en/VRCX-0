import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
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

type SettingsVrPrefs = Record<string, unknown> & {
    hmdNotificationOpacity?: number;
    hmdNotificationPosition?: string;
    hmdNotificationStartMode?: string;
    hmdNotificationTimeout?: number;
    hmdNotificationsEnabled?: boolean;
    imageNotifications?: boolean;
    notificationOpacity?: number;
    notificationTimeout?: number;
    ovrtHudNotifications?: boolean;
    ovrtWristNotifications?: boolean;
    vrOverlayPanelAllFriendsIncludesFavorites?: boolean;
    vrOverlayPanelEnabled?: boolean;
    wristOverlayButton?: string;
    wristOverlayDarkBackground?: boolean;
    wristOverlayEnabled?: boolean;
    wristOverlayHand?: string;
    wristOverlayHidePrivateWorlds?: boolean;
    wristOverlayShowBatteryPercent?: boolean;
    wristOverlayShowDevices?: boolean;
    wristOverlaySize?: string;
    wristOverlayStartMode?: string;
    xsNotifications?: boolean;
};

type SettingsVrTabProps = {
    prefs: SettingsVrPrefs;
    onImageNotificationsChange: (checked: boolean) => unknown;
    onHmdNotificationOpacityChange: (value: unknown) => unknown;
    onHmdNotificationPositionChange: (value: string) => unknown;
    onHmdNotificationStartModeChange: (value: string) => unknown;
    onHmdNotificationTimeoutSecondsChange: (value: unknown) => unknown;
    onHmdNotificationsEnabledChange: (checked: boolean) => unknown;
    onNotificationOpacityChange: (value: unknown) => unknown;
    onNotificationTimeoutSecondsChange: (value: unknown) => unknown;
    onOpenHmdNotificationFiltersDialog: () => unknown;
    onOpenVrNotificationFiltersDialog: () => unknown;
    onOpenWristFeedNotificationsDialog: () => unknown;
    onOvrtHudNotificationsChange: (checked: boolean) => unknown;
    onOvrtWristNotificationsChange: (checked: boolean) => unknown;
    onVrOverlayPanelAllFriendsIncludesFavoritesChange: (
        checked: boolean
    ) => unknown;
    onVrOverlayPanelEnabledChange: (checked: boolean) => unknown;
    onWristOverlayButtonChange: (value: string) => unknown;
    onWristOverlayDarkBackgroundChange: (checked: boolean) => unknown;
    onWristOverlayEnabledChange: (checked: boolean) => unknown;
    onWristOverlayHandChange: (value: string) => unknown;
    onWristOverlayHidePrivateWorldsChange: (checked: boolean) => unknown;
    onWristOverlayShowBatteryPercentChange: (checked: boolean) => unknown;
    onWristOverlayShowDevicesChange: (checked: boolean) => unknown;
    onWristOverlaySizeChange: (value: string) => unknown;
    onWristOverlayStartModeChange: (value: string) => unknown;
    onXsNotificationsChange: (checked: boolean) => unknown;
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

export function SettingsVrTab({
    prefs,
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
    onVrOverlayPanelEnabledChange,
    onVrOverlayPanelAllFriendsIncludesFavoritesChange,
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
}: SettingsVrTabProps) {
    const { t } = useTranslation();
    const hmdNotificationsEnabled = Boolean(prefs.hmdNotificationsEnabled);
    const vrOverlayPanelEnabled = prefs.vrOverlayPanelEnabled !== false;
    const vrOverlayPanelAllFriendsIncludesFavorites =
        prefs.vrOverlayPanelAllFriendsIncludesFavorites !== false;
    const wristOverlayEnabled = Boolean(prefs.wristOverlayEnabled);
    const vrDeviceStatusEnabled =
        wristOverlayEnabled && Boolean(prefs.wristOverlayShowDevices);
    const notificationTimeoutSeconds = Math.max(
        0,
        Math.floor(Number(prefs.notificationTimeout || 0) / 1000)
    );
    const notificationOpacity = Number.isFinite(
        Number(prefs.notificationOpacity)
    )
        ? Math.min(
              100,
              Math.max(0, Math.round(Number(prefs.notificationOpacity)))
          )
        : 100;
    const hmdNotificationTimeoutSeconds = Math.max(
        1,
        Math.floor(Number(prefs.hmdNotificationTimeout || 0) / 1000)
    );
    const hmdNotificationOpacity = Number.isFinite(
        Number(prefs.hmdNotificationOpacity)
    )
        ? Math.min(
              100,
              Math.max(0, Math.round(Number(prefs.hmdNotificationOpacity)))
          )
        : 100;

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
                        checked={Boolean(prefs.xsNotifications)}
                        onCheckedChange={onXsNotificationsChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.notifications.notifications.vr_notifications.ovrtoolkit_hud_notifications'
                    )}
                >
                    <Switch
                        checked={Boolean(prefs.ovrtHudNotifications)}
                        onCheckedChange={onOvrtHudNotificationsChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.notifications.notifications.vr_notifications.ovrtoolkit_wrist_notifications'
                    )}
                >
                    <Switch
                        checked={Boolean(prefs.ovrtWristNotifications)}
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
                        checked={Boolean(prefs.imageNotifications)}
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
                        <Input
                            id="settings-notification-timeout"
                            type="number"
                            min={0}
                            max={600}
                            step={1}
                            value={notificationTimeoutSeconds}
                            className="w-24"
                            onChange={(event) =>
                                onNotificationTimeoutSecondsChange(
                                    event.target.value
                                )
                            }
                        />
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
                    <Select
                        value={String(
                            prefs.hmdNotificationStartMode || 'vrchatVrMode'
                        )}
                        items={hmdStartModeOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        disabled={!hmdNotificationsEnabled}
                        onValueChange={(value) =>
                            onHmdNotificationStartModeChange(value ?? '')
                        }
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
                    <Select
                        value={String(
                            prefs.hmdNotificationPosition || 'bottom'
                        )}
                        items={hmdPositionOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        disabled={!hmdNotificationsEnabled}
                        onValueChange={(value) =>
                            onHmdNotificationPositionChange(value ?? '')
                        }
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
                        <Input
                            id="settings-hmd-notification-timeout"
                            type="number"
                            min={1}
                            max={30}
                            step={1}
                            value={hmdNotificationTimeoutSeconds}
                            disabled={!hmdNotificationsEnabled}
                            className="w-24"
                            onChange={(event) =>
                                onHmdNotificationTimeoutSecondsChange(
                                    event.target.value
                                )
                            }
                        />
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

            <SettingsGroup
                title={t('view.settings.vr.interactive_panel.header')}
            >
                <Field label={t('view.settings.vr.interactive_panel.enabled')}>
                    <Switch
                        checked={vrOverlayPanelEnabled}
                        onCheckedChange={onVrOverlayPanelEnabledChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.vr.interactive_panel.all_friends_include_favorites'
                    )}
                    disabled={!vrOverlayPanelEnabled}
                >
                    <Switch
                        checked={vrOverlayPanelAllFriendsIncludesFavorites}
                        disabled={!vrOverlayPanelEnabled}
                        onCheckedChange={
                            onVrOverlayPanelAllFriendsIncludesFavoritesChange
                        }
                    />
                </Field>

                <Field
                    label={t('view.settings.vr.interactive_panel.summon_hint')}
                >
                    <p className="text-muted-foreground max-w-md text-sm">
                        {t(
                            'view.settings.vr.interactive_panel.openvr_required'
                        )}
                    </p>
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
                    <Select
                        value={prefs.wristOverlayStartMode}
                        items={wristStartModeOptions.map(
                            ([value, labelKey]) => ({
                                value,
                                label: t(labelKey)
                            })
                        )}
                        disabled={!wristOverlayEnabled}
                        onValueChange={(value) =>
                            onWristOverlayStartModeChange(value ?? '')
                        }
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
                    <Select
                        value={prefs.wristOverlayButton}
                        items={wristButtonOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        disabled={!wristOverlayEnabled}
                        onValueChange={(value) =>
                            onWristOverlayButtonChange(value ?? '')
                        }
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
                    <Select
                        value={prefs.wristOverlayHand}
                        items={wristHandOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        disabled={!wristOverlayEnabled}
                        onValueChange={(value) =>
                            onWristOverlayHandChange(value ?? '')
                        }
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
                    <Select
                        value={prefs.wristOverlaySize}
                        items={wristSizeOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        disabled={!wristOverlayEnabled}
                        onValueChange={(value) =>
                            onWristOverlaySizeChange(value ?? '')
                        }
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
                        checked={Boolean(prefs.wristOverlayDarkBackground)}
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
                        checked={Boolean(prefs.wristOverlayHidePrivateWorlds)}
                        disabled={!wristOverlayEnabled}
                        onCheckedChange={onWristOverlayHidePrivateWorldsChange}
                    />
                </Field>

                <Field
                    label={t('view.settings.vr.wrist_overlay.vr_device_status')}
                    disabled={!wristOverlayEnabled}
                >
                    <Switch
                        checked={Boolean(prefs.wristOverlayShowDevices)}
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
                        checked={Boolean(prefs.wristOverlayShowBatteryPercent)}
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
        </SettingsTabContent>
    );
}
