import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { Field, SegmentedPreference } from '../SettingsField.jsx';

const weekStartOptions = [
    ['1', 'common.days.monday'],
    ['0', 'common.days.sunday'],
    ['6', 'common.days.saturday']
];

export function SettingsInterfaceDisplayCards({
    t,
    prefs,
    onShowInstanceIdInLocationChange,
    onAgeGatedInstancesVisibleChange,
    onHideNicknamesChange,
    onDisplayVrcPlusIconsAsAvatarChange,
    onShowNewDashboardButtonChange,
    onSortFavoritesChange,
    onOpenTablePageSizes,
    onOpenTableLimits,
    onHour12Change,
    onIsoFormatChange,
    onWeekStartsOnChange,
    onHideUserNotesChange,
    onHideUserMemosChange,
    onHideUnfriendsChange
}) {
    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.appearance.display.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
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
                        label={t(
                            'view.settings.appearance.appearance.nicknames'
                        )}
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
                            onCheckedChange={
                                onDisplayVrcPlusIconsAsAvatarChange
                            }
                        />
                    </Field>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.interface.navigation.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
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
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.interface.lists_tables.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.appearance.appearance.sort_favorite_by'
                        )}
                    >
                        <SegmentedPreference
                            value={prefs.sortFavorites ? 'date' : 'name'}
                            onChange={onSortFavoritesChange}
                            options={[
                                {
                                    value: 'name',
                                    label: t(
                                        'view.settings.appearance.appearance.sort_favorite_by_name'
                                    )
                                },
                                {
                                    value: 'date',
                                    label: t(
                                        'view.settings.appearance.appearance.sort_favorite_by_date'
                                    )
                                }
                            ]}
                        />
                    </Field>

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
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.appearance.timedate.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.appearance.timedate.time_format'
                        )}
                        controlId="settings-time-format"
                    >
                        <Select
                            value={prefs.dtHour12 ? '12' : '24'}
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
                                    <SelectItem value="12">
                                        {t(
                                            'view.settings.appearance.timedate.time_format_12'
                                        )}
                                    </SelectItem>
                                    <SelectItem value="24">
                                        {t(
                                            'view.settings.appearance.timedate.time_format_24'
                                        )}
                                    </SelectItem>
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
                                    {weekStartOptions.map(
                                        ([value, labelKey]) => (
                                            <SelectItem
                                                key={value}
                                                value={value}
                                            >
                                                {t(labelKey)}
                                            </SelectItem>
                                        )
                                    )}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.appearance.user_dialog.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
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
                        label={t(
                            'view.settings.appearance.user_dialog.vrcx_memos'
                        )}
                        description={t(
                            'view.settings.appearance.user_dialog.vrcx_memos_description'
                        )}
                    >
                        <Switch
                            checked={!prefs.hideUserMemos}
                            onCheckedChange={onHideUserMemosChange}
                        />
                    </Field>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.appearance.friend_log.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.appearance.friend_log.hide_unfriends'
                        )}
                    >
                        <Switch
                            checked={prefs.hideUnfriends}
                            onCheckedChange={onHideUnfriendsChange}
                        />
                    </Field>
                </CardContent>
            </Card>
        </>
    );
}
