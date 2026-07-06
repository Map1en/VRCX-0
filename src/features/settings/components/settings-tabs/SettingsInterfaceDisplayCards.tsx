import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { Field, SegmentedPreference, SettingsGroup } from '../SettingsField';

const timeFormatOptions = [
    ['12', 'view.settings.appearance.timedate.time_format_12'],
    ['24', 'view.settings.appearance.timedate.time_format_24']
] as const;

const weekStartOptions = [
    ['1', 'common.days.monday'],
    ['0', 'common.days.sunday'],
    ['6', 'common.days.saturday']
] as const;

export function SettingsInterfaceDisplayCards({
    prefs,
    onShowInstanceIdInLocationChange,
    onAgeGatedInstancesVisibleChange,
    onHideNicknamesChange,
    onDisplayVrcPlusIconsAsAvatarChange,
    onShowNewDashboardButtonChange,
    onOpenTablePageSizes,
    onOpenTableLimits,
    onHour12Change,
    onIsoFormatChange,
    onWeekStartsOnChange,
    onFeedTimeDisplayModeChange,
    onHideUserNotesChange,
    onHideUserMemosChange
}: any) {
    const { t } = useTranslation();

    return (
        <>
            <SettingsGroup title={t('view.settings.appearance.display.header')}>
                <Field
                    label={t(
                        'view.settings.appearance.appearance.show_instance_id'
                    )}
                >
                    <Switch
                        checked={prefs.showInstanceIdInLocation}
                        onCheckedChange={onShowInstanceIdInLocationChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.appearance.appearance.age_gated_instances'
                    )}
                    description={t(
                        'view.settings.appearance.appearance.age_gated_instances_description'
                    )}
                >
                    <Switch
                        checked={prefs.isAgeGatedInstancesVisible}
                        onCheckedChange={onAgeGatedInstancesVisibleChange}
                    />
                </Field>

                <Field
                    label={t('view.settings.appearance.appearance.nicknames')}
                    description={t(
                        'view.settings.appearance.appearance.nicknames_description'
                    )}
                >
                    <Switch
                        checked={!prefs.hideNicknames}
                        onCheckedChange={onHideNicknamesChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.appearance.appearance.vrcplus_profile_icons'
                    )}
                    description={t(
                        'view.settings.appearance.appearance.vrcplus_profile_icons_description'
                    )}
                >
                    <Switch
                        checked={prefs.displayVRCPlusIconsAsAvatar}
                        onCheckedChange={onDisplayVrcPlusIconsAsAvatarChange}
                    />
                </Field>
            </SettingsGroup>

            <SettingsGroup
                title={t('view.settings.interface.navigation.header')}
            >
                <Field
                    label={t(
                        'view.settings.interface.navigation.show_new_dashboard_button'
                    )}
                >
                    <Switch
                        checked={prefs.showNewDashboardButton}
                        onCheckedChange={onShowNewDashboardButtonChange}
                    />
                </Field>
            </SettingsGroup>

            <SettingsGroup
                title={t('view.settings.interface.lists_tables.header')}
            >
                <Field
                    label={t(
                        'view.settings.appearance.appearance.table_page_sizes'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onOpenTablePageSizes}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>

                <Field
                    label={t(
                        'view.settings.appearance.appearance.table_entries_settings'
                    )}
                    description={t(
                        'view.settings.appearance.appearance.table_entries_settings_description'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onOpenTableLimits}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>
            </SettingsGroup>

            <SettingsGroup
                title={t('view.settings.appearance.timedate.header')}
            >
                <Field
                    label={t('view.settings.appearance.timedate.time_format')}
                    controlId="settings-time-format"
                >
                    <Select
                        value={prefs.dtHour12 ? '12' : '24'}
                        items={timeFormatOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={onHour12Change}
                    >
                        <SelectTrigger
                            id="settings-time-format"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {timeFormatOptions.map(([value, labelKey]) => (
                                    <SelectItem key={value} value={value}>
                                        {t(labelKey)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    label={t(
                        'view.settings.appearance.timedate.force_iso_date_format'
                    )}
                >
                    <Switch
                        checked={prefs.dtIsoFormat}
                        onCheckedChange={onIsoFormatChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.appearance.timedate.week_starts_on'
                    )}
                    description={t(
                        'view.settings.appearance.timedate.week_starts_on_description'
                    )}
                    controlId="settings-week-starts-on"
                >
                    <Select
                        value={String(prefs.weekStartsOn)}
                        items={weekStartOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={onWeekStartsOnChange}
                    >
                        <SelectTrigger
                            id="settings-week-starts-on"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {weekStartOptions.map(([value, labelKey]) => (
                                    <SelectItem key={value} value={value}>
                                        {t(labelKey)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    label={t(
                        'view.settings.appearance.timedate.feed_time_display'
                    )}
                >
                    <SegmentedPreference
                        value={prefs.feedTimeDisplayMode || 'relative'}
                        onChange={onFeedTimeDisplayModeChange}
                        options={[
                            {
                                value: 'exact',
                                label: t(
                                    'view.settings.appearance.timedate.feed_time_display_exact'
                                )
                            },
                            {
                                value: 'relative',
                                label: t(
                                    'view.settings.appearance.timedate.feed_time_display_relative'
                                )
                            }
                        ]}
                    />
                </Field>
            </SettingsGroup>

            <SettingsGroup
                title={t('view.settings.appearance.user_dialog.header')}
            >
                <Field
                    label={t(
                        'view.settings.appearance.user_dialog.vrchat_notes'
                    )}
                    description={t(
                        'view.settings.appearance.user_dialog.vrchat_notes_description'
                    )}
                >
                    <Switch
                        checked={!prefs.hideUserNotes}
                        onCheckedChange={onHideUserNotesChange}
                    />
                </Field>

                <Field
                    label={t('view.settings.appearance.user_dialog.vrcx_memos')}
                    description={t(
                        'view.settings.appearance.user_dialog.vrcx_memos_description'
                    )}
                >
                    <Switch
                        checked={!prefs.hideUserMemos}
                        onCheckedChange={onHideUserMemosChange}
                    />
                </Field>
            </SettingsGroup>
        </>
    );
}
