import { useTranslation } from 'react-i18next';

import type { PreferencesSnapshot } from '@/state/preferencesStore';
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

import { SETTINGS_DEFAULT_VALUES } from '../../settingsFieldState';
import type { SettingsPageStateSections } from '../../settingsPageStateSections';
import { SettingsCard } from '../SettingsCard';
import { Field, SegmentedPreference } from '../SettingsField';
import { SettingsInterfaceProfileAppearanceCard } from './SettingsInterfaceProfileAppearanceCard';
import { SettingsInterfaceUserDialogCard } from './SettingsInterfaceUserDialogCard';

type InterfaceState = SettingsPageStateSections['interface'];
type SettingsInterfaceDisplayPrefs = Pick<
    PreferencesSnapshot,
    | 'showInstanceIdInLocation'
    | 'isAgeGatedInstancesVisible'
    | 'showNewDashboardButton'
    | 'dtHour12'
    | 'dtIsoFormat'
    | 'weekStartsOn'
    | 'feedTimeDisplayMode'
>;
type SettingsInterfaceDisplayCardsProps = {
    prefs: SettingsInterfaceDisplayPrefs;
} & Pick<
    InterfaceState,
    | 'onShowInstanceIdInLocationChange'
    | 'onAgeGatedInstancesVisibleChange'
    | 'onShowNewDashboardButtonChange'
    | 'onOpenTablePageSizes'
    | 'onOpenTableLimits'
    | 'onHour12Change'
    | 'onIsoFormatChange'
    | 'onWeekStartsOnChange'
    | 'onFeedTimeDisplayModeChange'
>;

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
    onShowNewDashboardButtonChange,
    onOpenTablePageSizes,
    onOpenTableLimits,
    onHour12Change,
    onIsoFormatChange,
    onWeekStartsOnChange,
    onFeedTimeDisplayModeChange
}: SettingsInterfaceDisplayCardsProps) {
    const { t } = useTranslation();

    return (
        <>
            <SettingsCard
                cardId="interface.display"
                title={t('view.settings.appearance.display.header')}
            >
                <Field
                    settingId="interface.display.show-instance-id"
                    onReset={() =>
                        onShowInstanceIdInLocationChange(
                            SETTINGS_DEFAULT_VALUES.showInstanceIdInLocation
                        )
                    }
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
                    settingId="interface.display.age-gated-instances"
                    onReset={() =>
                        onAgeGatedInstancesVisibleChange(
                            SETTINGS_DEFAULT_VALUES.isAgeGatedInstancesVisible
                        )
                    }
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
            </SettingsCard>

            <SettingsInterfaceProfileAppearanceCard />

            <SettingsInterfaceUserDialogCard />

            <SettingsCard
                cardId="interface.navigation"
                title={t('view.settings.interface.navigation.header')}
            >
                <Field
                    settingId="interface.navigation.new-dashboard-button"
                    onReset={() =>
                        onShowNewDashboardButtonChange(
                            SETTINGS_DEFAULT_VALUES.showNewDashboardButton
                        )
                    }
                    label={t(
                        'view.settings.interface.navigation.show_new_dashboard_button'
                    )}
                >
                    <Switch
                        checked={prefs.showNewDashboardButton}
                        onCheckedChange={onShowNewDashboardButtonChange}
                    />
                </Field>
            </SettingsCard>

            <SettingsCard
                cardId="interface.tables"
                title={t('view.settings.interface.lists_tables.header')}
            >
                <Field
                    settingId="interface.tables.page-sizes"
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
                    settingId="interface.tables.entry-limits"
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
            </SettingsCard>

            <SettingsCard
                cardId="interface.time-date"
                title={t('view.settings.appearance.timedate.header')}
            >
                <Field
                    settingId="interface.time-date.time-format"
                    onReset={() =>
                        onHour12Change(
                            SETTINGS_DEFAULT_VALUES.dtHour12 ? '12' : '24'
                        )
                    }
                    label={t('view.settings.appearance.timedate.time_format')}
                    controlId="settings-time-format"
                >
                    <Select
                        value={prefs.dtHour12 ? '12' : '24'}
                        items={timeFormatOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={(value) => {
                            if (value !== null) {
                                onHour12Change(value);
                            }
                        }}
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
                    settingId="interface.time-date.iso-date"
                    onReset={() =>
                        onIsoFormatChange(SETTINGS_DEFAULT_VALUES.dtIsoFormat)
                    }
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
                    settingId="interface.time-date.week-start"
                    onReset={() =>
                        onWeekStartsOnChange(
                            String(SETTINGS_DEFAULT_VALUES.weekStartsOn)
                        )
                    }
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
                        onValueChange={(value) => {
                            if (value !== null) {
                                onWeekStartsOnChange(value);
                            }
                        }}
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
                    settingId="interface.time-date.feed-time-display"
                    onReset={() =>
                        onFeedTimeDisplayModeChange(
                            SETTINGS_DEFAULT_VALUES.feedTimeDisplayMode
                        )
                    }
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
            </SettingsCard>
        </>
    );
}
