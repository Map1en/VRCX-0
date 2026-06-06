import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
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

import { Field } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';

export function SettingsVrTab({
    prefs,
    onXsNotificationsChange,
    onOvrtHudNotificationsChange,
    onOvrtWristNotificationsChange,
    onImageNotificationsChange,
    onNotificationTimeoutSecondsChange,
    onNotificationOpacityChange,
    onOpenVrNotificationFiltersDialog,
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
}: any) {
    const { t } = useTranslation();
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

    return (
        <SettingsTabContent value="vr">
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t(
                            'view.settings.notifications.notifications.vr_notifications.header'
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
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
                        description={t(
                            'view.settings.notifications.notifications.vr_notifications.user_images_description'
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
                                onChange={(event: any) =>
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
                                onValueChange={(value: any) =>
                                    onNotificationOpacityChange(value?.[0])
                                }
                            />
                            <span className="text-muted-foreground w-10 text-right text-sm">
                                {notificationOpacity}%
                            </span>
                        </div>
                    </Field>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.vr.wrist_overlay.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
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
                            disabled={!wristOverlayEnabled}
                            onValueChange={onWristOverlayStartModeChange}
                        >
                            <SelectTrigger
                                id="settings-wrist-overlay-start-mode"
                                className="w-56"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="steamvr">
                                        {t(
                                            'view.settings.vr.wrist_overlay.start_when_steamvr'
                                        )}
                                    </SelectItem>
                                    <SelectItem value="vrchatVrMode">
                                        {t(
                                            'view.settings.vr.wrist_overlay.start_when_vrchat_vr_mode'
                                        )}
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>

                    <Field
                        label={t(
                            'view.settings.vr.wrist_overlay.overlay_button'
                        )}
                        controlId="settings-wrist-overlay-button"
                        disabled={!wristOverlayEnabled}
                    >
                        <Select
                            value={prefs.wristOverlayButton}
                            disabled={!wristOverlayEnabled}
                            onValueChange={onWristOverlayButtonChange}
                        >
                            <SelectTrigger
                                id="settings-wrist-overlay-button"
                                className="w-56"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="grip">
                                        {t(
                                            'view.settings.vr.wrist_overlay.overlay_button_grip'
                                        )}
                                    </SelectItem>
                                    <SelectItem value="menu">
                                        {t(
                                            'view.settings.vr.wrist_overlay.overlay_button_menu'
                                        )}
                                    </SelectItem>
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
                            disabled={!wristOverlayEnabled}
                            onValueChange={onWristOverlayHandChange}
                        >
                            <SelectTrigger
                                id="settings-wrist-overlay-hand"
                                className="w-56"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="left">
                                        {t(
                                            'view.settings.vr.wrist_overlay.display_on_left'
                                        )}
                                    </SelectItem>
                                    <SelectItem value="right">
                                        {t(
                                            'view.settings.vr.wrist_overlay.display_on_right'
                                        )}
                                    </SelectItem>
                                    <SelectItem value="both">
                                        {t(
                                            'view.settings.vr.wrist_overlay.display_on_both'
                                        )}
                                    </SelectItem>
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
                            disabled={!wristOverlayEnabled}
                            onValueChange={onWristOverlaySizeChange}
                        >
                            <SelectTrigger
                                id="settings-wrist-overlay-size"
                                className="w-56"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="compact">
                                        {t(
                                            'view.settings.vr.wrist_overlay.size_compact'
                                        )}
                                    </SelectItem>
                                    <SelectItem value="normal">
                                        {t(
                                            'view.settings.vr.wrist_overlay.size_normal'
                                        )}
                                    </SelectItem>
                                    <SelectItem value="large">
                                        {t(
                                            'view.settings.vr.wrist_overlay.size_large'
                                        )}
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>

                    <Field
                        label={t(
                            'view.settings.vr.wrist_overlay.dark_background'
                        )}
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
                            checked={Boolean(
                                prefs.wristOverlayHidePrivateWorlds
                            )}
                            disabled={!wristOverlayEnabled}
                            onCheckedChange={
                                onWristOverlayHidePrivateWorldsChange
                            }
                        />
                    </Field>

                    <Field
                        label={t(
                            'view.settings.vr.wrist_overlay.vr_device_status'
                        )}
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
                            checked={Boolean(
                                prefs.wristOverlayShowBatteryPercent
                            )}
                            disabled={!vrDeviceStatusEnabled}
                            onCheckedChange={
                                onWristOverlayShowBatteryPercentChange
                            }
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
                            {t(
                                'view.settings.vr.wrist_overlay.wrist_feed_notifications'
                            )}
                        </Button>
                    </Field>
                </CardContent>
            </Card>
        </SettingsTabContent>
    );
}
