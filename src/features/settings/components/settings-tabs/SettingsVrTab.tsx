import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';

export function SettingsVrTab({
    prefs,
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

    return (
        <SettingsTabContent value="vr">
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
