import { useTranslation } from 'react-i18next';

import type { NotificationLayout } from '@/state/shellStore';
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
import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

type SettingsNotificationsInAppCardProps = {
    prefs: {
        notificationLayout: string;
        notificationIconDot: boolean;
        taskbarIconDot: boolean;
        friendLogNotificationDot: boolean;
    };
    showTaskbarIconDot: boolean;
    notificationLayoutOptions: ReadonlyArray<readonly [string, string]>;
    onNotificationLayoutChange: (value: NotificationLayout) => void;
    onNotificationIconDotChange: (value: boolean) => void;
    onTaskbarIconDotChange: (value: boolean) => void;
    onFriendLogNotificationDotChange: (value: boolean) => void;
};

export function SettingsNotificationsInAppCard({
    prefs,
    showTaskbarIconDot,
    notificationLayoutOptions,
    onNotificationLayoutChange,
    onNotificationIconDotChange,
    onTaskbarIconDotChange,
    onFriendLogNotificationDotChange
}: SettingsNotificationsInAppCardProps) {
    const { t } = useTranslation();
    const notificationLayoutItems = notificationLayoutOptions.map(
        ([value, labelKey]) => ({
            value,
            label: t(labelKey)
        })
    );

    function changeNotificationLayout(value: string | null) {
        if (value === 'notification-center' || value === 'table') {
            onNotificationLayoutChange(value);
        }
    }

    return (
        <SettingsCard
            cardId="notifications.in-app"
            title={t('view.settings.notifications.notifications.in_app.header')}
        >
            <Field
                settingId="notifications.in-app.layout"
                onReset={() =>
                    changeNotificationLayout(
                        SETTINGS_DEFAULT_VALUES.notificationLayout
                    )
                }
                label={t('view.settings.notifications.notifications.layout')}
                controlId="settings-notification-layout"
            >
                <Select
                    value={prefs.notificationLayout}
                    items={notificationLayoutItems}
                    onValueChange={changeNotificationLayout}
                >
                    <SelectTrigger
                        id="settings-notification-layout"
                        className="w-56"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {notificationLayoutItems.map(({ value, label }) => (
                                <SelectItem key={value} value={value}>
                                    {label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>

            <Field
                settingId="notifications.in-app.icon-dot"
                onReset={() =>
                    onNotificationIconDotChange(
                        SETTINGS_DEFAULT_VALUES.notificationIconDot
                    )
                }
                label={t(
                    'view.settings.appearance.appearance.show_notification_icon_dot'
                )}
            >
                <Switch
                    checked={prefs.notificationIconDot}
                    onCheckedChange={onNotificationIconDotChange}
                />
            </Field>

            {showTaskbarIconDot ? (
                <Field
                    settingId="notifications.in-app.taskbar-dot"
                    onReset={() =>
                        onTaskbarIconDotChange(
                            SETTINGS_DEFAULT_VALUES.taskbarIconDot
                        )
                    }
                    label={t(
                        'view.settings.appearance.appearance.show_taskbar_icon_dot'
                    )}
                    description={t(
                        'view.settings.appearance.appearance.show_taskbar_icon_dot_description'
                    )}
                >
                    <Switch
                        checked={prefs.taskbarIconDot}
                        onCheckedChange={onTaskbarIconDotChange}
                    />
                </Field>
            ) : null}

            <Field
                settingId="notifications.in-app.friend-log-dot"
                onReset={() =>
                    onFriendLogNotificationDotChange(
                        SETTINGS_DEFAULT_VALUES.friendLogNotificationDot
                    )
                }
                label={t(
                    'view.settings.appearance.friend_log.show_notification_dot'
                )}
            >
                <Switch
                    checked={prefs.friendLogNotificationDot}
                    onCheckedChange={onFriendLogNotificationDotChange}
                />
            </Field>
        </SettingsCard>
    );
}
