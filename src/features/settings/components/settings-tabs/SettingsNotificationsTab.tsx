import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TtsVoice } from '@/platform/tauri/bindings';
import {
    normalizeNotificationTtsNameMode,
    type PreferencesSnapshot
} from '@/state/preferencesStore';
import type { NotificationLayout } from '@/state/shellStore';
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

import { SETTINGS_DEFAULT_VALUES } from '../../settingsFieldState';
import { desktopWidgetOrderOptions } from '../../settingsOptions';
import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';
import { useSettingsNotificationsTabState } from '../useSettingsNotificationsTabState';
import { NotificationWebhookSettings } from './NotificationWebhookSettings';
import { SettingsNotificationsInAppCard } from './SettingsNotificationsInAppCard';

type SettingsOptionList = ReadonlyArray<readonly [string, string]>;

type SettingsNotificationsPrefs = Pick<
    PreferencesSnapshot,
    | 'afkDesktopToast'
    | 'notificationLayout'
    | 'notificationIconDot'
    | 'taskbarIconDot'
    | 'friendLogNotificationDot'
    | 'desktopNotificationSound'
    | 'desktopNotificationAvatars'
    | 'desktopToast'
    | 'notificationDoNotDisturbEndOnGameStart'
    | 'busyStatusDoNotDisturb'
    | 'hideVideoErrorNotifications'
    | 'notificationTTS'
    | 'notificationTTSNameMode'
    | 'notificationTTSNickName'
    | 'notificationTTSVoiceNative'
    | 'notificationTTSVolume'
    | 'desktopWidgetOpacity'
    | 'desktopWidgetNewestOnTop'
>;

type SettingsNotificationsTabContentProps = {
    notificationLayoutOptions: SettingsOptionList;
    showTaskbarIconDot: boolean;
    showDesktopWidget: boolean;
    onNotificationLayoutChange: (value: NotificationLayout) => void;
    onNotificationIconDotChange: (checked: boolean) => void;
    onTaskbarIconDotChange: (checked: boolean) => void;
    onFriendLogNotificationDotChange: (checked: boolean) => void;
    webhookSettings?: ReactNode;
    desktopToastOptions: SettingsOptionList;
    notificationTtsOptions: SettingsOptionList;
    notificationTtsNameModeOptions: SettingsOptionList;
    notificationTtsTest: string;
    notificationTtsTestVisible: boolean;
    onAfkDesktopToastChange: (checked: boolean) => void;
    onDesktopNotificationSoundChange: (checked: boolean) => void;
    onDesktopNotificationAvatarsChange: (checked: boolean) => void;
    onDesktopToastChange: (value: string) => void;
    onNotificationTtsModeChange: (value: string) => void;
    onNotificationDoNotDisturbEndOnGameStartChange: (checked: boolean) => void;
    onBusyStatusDoNotDisturbChange: (checked: boolean) => void;
    onHideVideoErrorNotificationsChange: (checked: boolean) => void;
    onNotificationTtsNameModeChange: (value: string) => void;
    onNotificationTtsTestChange: (value: string) => void;
    onNotificationTtsTestVisibleChange: (visible: boolean) => void;
    onNotificationTtsVoiceChange: (value: string) => void;
    onNotificationTtsVolumeChange: (value: number) => void;
    onOpenDesktopNotificationFiltersDialog: () => void;
    onOpenDesktopWidgetFiltersDialog: () => void;
    onDesktopWidgetOpacityChange: (value: number) => void;
    onDesktopWidgetOrderChange: (value: string) => void;
    onOpenTtsNotificationFiltersDialog: () => void;
    onSendTestNotification: () => void;
    onSpeakNotificationTts: (message: string) => void;
    prefs: SettingsNotificationsPrefs;
    ttsVoices: TtsVoice[];
};

export function SettingsNotificationsTab() {
    const state = useSettingsNotificationsTabState();
    return (
        <SettingsNotificationsTabContent
            {...state}
            webhookSettings={<NotificationWebhookSettings />}
        />
    );
}

export function SettingsNotificationsTabContent({
    prefs,
    notificationLayoutOptions,
    showTaskbarIconDot,
    showDesktopWidget,
    onNotificationLayoutChange,
    onNotificationIconDotChange,
    onTaskbarIconDotChange,
    onFriendLogNotificationDotChange,
    webhookSettings,
    desktopToastOptions,
    notificationTtsOptions,
    notificationTtsNameModeOptions,
    ttsVoices,
    notificationTtsTestVisible,
    notificationTtsTest,
    onOpenDesktopNotificationFiltersDialog,
    onOpenDesktopWidgetFiltersDialog,
    onOpenTtsNotificationFiltersDialog,
    onDesktopWidgetOpacityChange,
    onDesktopWidgetOrderChange,
    onDesktopToastChange,
    onAfkDesktopToastChange,
    onDesktopNotificationSoundChange,
    onDesktopNotificationAvatarsChange,
    onNotificationTtsModeChange,
    onNotificationDoNotDisturbEndOnGameStartChange,
    onBusyStatusDoNotDisturbChange,
    onHideVideoErrorNotificationsChange,
    onNotificationTtsVoiceChange,
    onNotificationTtsVolumeChange,
    onNotificationTtsNameModeChange,
    onNotificationTtsTestVisibleChange,
    onNotificationTtsTestChange,
    onSendTestNotification,
    onSpeakNotificationTts
}: SettingsNotificationsTabContentProps) {
    const { t } = useTranslation();
    const ttsNameMode = normalizeNotificationTtsNameMode(
        prefs.notificationTTSNameMode,
        prefs.notificationTTSNickName
    );
    const savedTtsVolume = Math.min(
        100,
        Math.max(0, Math.round(prefs.notificationTTSVolume))
    );
    const [draftTtsVolume, setDraftTtsVolume] = useState<number | null>(null);
    const ttsVolume = draftTtsVolume ?? savedTtsVolume;
    const [draftDesktopWidgetOpacity, setDraftDesktopWidgetOpacity] = useState<
        number | null
    >(null);
    const desktopWidgetOpacity =
        draftDesktopWidgetOpacity ??
        Math.min(100, Math.max(0, Math.round(prefs.desktopWidgetOpacity)));

    return (
        <SettingsTabContent value="notifications">
            <SettingsNotificationsInAppCard
                prefs={prefs}
                showTaskbarIconDot={showTaskbarIconDot}
                notificationLayoutOptions={notificationLayoutOptions}
                onNotificationLayoutChange={onNotificationLayoutChange}
                onNotificationIconDotChange={onNotificationIconDotChange}
                onTaskbarIconDotChange={onTaskbarIconDotChange}
                onFriendLogNotificationDotChange={
                    onFriendLogNotificationDotChange
                }
            />
            <SettingsCard
                cardId="notifications.dnd"
                title={t(
                    'view.settings.notifications.notifications.do_not_disturb.header'
                )}
                description={t(
                    'view.settings.notifications.notifications.do_not_disturb.description'
                )}
            >
                <Field
                    settingId="notifications.dnd.end-on-game-start"
                    onReset={() =>
                        onNotificationDoNotDisturbEndOnGameStartChange(
                            SETTINGS_DEFAULT_VALUES.notificationDoNotDisturbEndOnGameStart
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.do_not_disturb.end_on_game_start'
                    )}
                    description={t(
                        'view.settings.notifications.notifications.do_not_disturb.end_on_game_start_description'
                    )}
                >
                    <Switch
                        checked={prefs.notificationDoNotDisturbEndOnGameStart}
                        onCheckedChange={
                            onNotificationDoNotDisturbEndOnGameStartChange
                        }
                    />
                </Field>
                <Field
                    settingId="notifications.dnd.busy-status"
                    onReset={() =>
                        onBusyStatusDoNotDisturbChange(
                            SETTINGS_DEFAULT_VALUES.busyStatusDoNotDisturb
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.do_not_disturb.busy_status'
                    )}
                    description={t(
                        'view.settings.notifications.notifications.do_not_disturb.busy_status_description'
                    )}
                >
                    <Switch
                        checked={prefs.busyStatusDoNotDisturb}
                        onCheckedChange={onBusyStatusDoNotDisturbChange}
                    />
                </Field>
                <Field
                    settingId="notifications.dnd.hide-video-errors"
                    onReset={() =>
                        onHideVideoErrorNotificationsChange(
                            SETTINGS_DEFAULT_VALUES.hideVideoErrorNotifications
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.do_not_disturb.hide_video_errors'
                    )}
                    description={t(
                        'view.settings.notifications.notifications.do_not_disturb.hide_video_errors_description'
                    )}
                >
                    <Switch
                        checked={prefs.hideVideoErrorNotifications}
                        onCheckedChange={onHideVideoErrorNotificationsChange}
                    />
                </Field>
            </SettingsCard>
            <SettingsCard
                cardId="notifications.desktop"
                title={t(
                    'view.settings.notifications.notifications.desktop_notifications.header'
                )}
            >
                <Field
                    settingId="notifications.desktop.when-to-display"
                    onReset={() =>
                        onDesktopToastChange(
                            SETTINGS_DEFAULT_VALUES.desktopToast
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.desktop_notifications.when_to_display'
                    )}
                    controlId="settings-desktop-toast"
                >
                    <Select
                        value={prefs.desktopToast}
                        items={desktopToastOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={(value) =>
                            onDesktopToastChange(value ?? '')
                        }
                    >
                        <SelectTrigger
                            id="settings-desktop-toast"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {desktopToastOptions.map(
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
                    settingId="notifications.desktop.filters"
                    label={t(
                        'view.settings.notifications.notifications.desktop_notifications.notification_filters'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onOpenDesktopNotificationFiltersDialog}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>

                <Field
                    settingId="notifications.desktop.while-afk"
                    onReset={() =>
                        onAfkDesktopToastChange(
                            SETTINGS_DEFAULT_VALUES.afkDesktopToast
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.desktop_notifications.desktop_notification_while_afk'
                    )}
                >
                    <Switch
                        checked={prefs.afkDesktopToast}
                        onCheckedChange={onAfkDesktopToastChange}
                    />
                </Field>

                <Field
                    settingId="notifications.desktop.sound"
                    onReset={() =>
                        onDesktopNotificationSoundChange(
                            SETTINGS_DEFAULT_VALUES.desktopNotificationSound
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.desktop_notifications.notification_sound'
                    )}
                >
                    <Switch
                        checked={prefs.desktopNotificationSound}
                        onCheckedChange={onDesktopNotificationSoundChange}
                    />
                </Field>

                <Field
                    settingId="notifications.desktop.friend-icons"
                    onReset={() =>
                        onDesktopNotificationAvatarsChange(
                            SETTINGS_DEFAULT_VALUES.desktopNotificationAvatars
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.desktop_notifications.friend_icons'
                    )}
                >
                    <Switch
                        checked={prefs.desktopNotificationAvatars}
                        onCheckedChange={onDesktopNotificationAvatarsChange}
                    />
                </Field>
            </SettingsCard>
            {showDesktopWidget ? (
                <SettingsCard
                    cardId="notifications.desktop_widget"
                    title={t(
                        'view.settings.notifications.notifications.desktop_widget.header'
                    )}
                    description={t(
                        'view.settings.notifications.notifications.desktop_widget.description'
                    )}
                >
                    <p className="text-muted-foreground py-2 text-sm">
                        {t(
                            'view.settings.notifications.notifications.desktop_widget.usage_hint'
                        )}
                    </p>
                    <Field
                        settingId="notifications.desktop_widget.opacity"
                        onReset={() =>
                            onDesktopWidgetOpacityChange(
                                SETTINGS_DEFAULT_VALUES.desktopWidgetOpacity
                            )
                        }
                        label={t(
                            'view.settings.notifications.notifications.desktop_widget.background_opacity'
                        )}
                        controlId="settings-desktop-widget-opacity"
                    >
                        <div className="flex w-56 max-w-full items-center justify-end gap-3">
                            <Slider
                                id="settings-desktop-widget-opacity"
                                value={[desktopWidgetOpacity]}
                                min={0}
                                max={100}
                                step={1}
                                onValueChange={(value) =>
                                    setDraftDesktopWidgetOpacity(
                                        Array.isArray(value) ? value[0] : value
                                    )
                                }
                                onValueCommitted={(value) => {
                                    setDraftDesktopWidgetOpacity(null);
                                    onDesktopWidgetOpacityChange(
                                        Array.isArray(value) ? value[0] : value
                                    );
                                }}
                            />
                            <span className="text-muted-foreground w-10 text-right text-sm">
                                {desktopWidgetOpacity}%
                            </span>
                        </div>
                    </Field>
                    <Field
                        settingId="notifications.desktop_widget.order"
                        onReset={() =>
                            onDesktopWidgetOrderChange(
                                SETTINGS_DEFAULT_VALUES.desktopWidgetNewestOnTop
                                    ? 'top'
                                    : 'bottom'
                            )
                        }
                        label={t(
                            'view.settings.notifications.notifications.desktop_widget.order'
                        )}
                        controlId="settings-desktop-widget-order"
                    >
                        <Select
                            value={
                                prefs.desktopWidgetNewestOnTop
                                    ? 'top'
                                    : 'bottom'
                            }
                            items={desktopWidgetOrderOptions.map(
                                ([value, labelKey]) => ({
                                    value,
                                    label: t(labelKey)
                                })
                            )}
                            onValueChange={(value) =>
                                onDesktopWidgetOrderChange(value ?? 'top')
                            }
                        >
                            <SelectTrigger
                                id="settings-desktop-widget-order"
                                className="w-56"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {desktopWidgetOrderOptions.map(
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
                    <Field
                        settingId="notifications.desktop_widget.filters"
                        label={t(
                            'view.settings.notifications.notifications.desktop_widget.activity_filters'
                        )}
                    >
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onOpenDesktopWidgetFiltersDialog}
                        >
                            {t('common.actions.configure')}
                        </Button>
                    </Field>
                </SettingsCard>
            ) : null}
            <SettingsCard
                cardId="notifications.tts"
                title={t(
                    'view.settings.notifications.notifications.text_to_speech.header'
                )}
            >
                <Field
                    settingId="notifications.tts.when-to-play"
                    onReset={() =>
                        onNotificationTtsModeChange(
                            SETTINGS_DEFAULT_VALUES.notificationTTS
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.text_to_speech.when_to_play'
                    )}
                    controlId="settings-notification-tts"
                >
                    <Select
                        value={prefs.notificationTTS}
                        items={notificationTtsOptions.map(
                            ([value, labelKey]) => ({
                                value,
                                label: t(labelKey)
                            })
                        )}
                        onValueChange={(value) =>
                            onNotificationTtsModeChange(value ?? '')
                        }
                    >
                        <SelectTrigger
                            id="settings-notification-tts"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {notificationTtsOptions.map(
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
                    settingId="notifications.tts.voice"
                    label={t(
                        'view.settings.notifications.notifications.text_to_speech.tts_voice'
                    )}
                    controlId="settings-notification-tts-voice"
                    disabled={prefs.notificationTTS === 'Never'}
                >
                    <Select
                        value={prefs.notificationTTSVoiceNative || 'default'}
                        items={[
                            {
                                value: 'default',
                                label: t(
                                    'view.settings.notifications.notifications.text_to_speech.system_default_voice',
                                    { defaultValue: 'System default' }
                                )
                            },
                            ...ttsVoices.map((voice) => ({
                                value: voice.id,
                                label: voice.language
                                    ? `${voice.name} (${voice.language})`
                                    : voice.name
                            }))
                        ]}
                        onValueChange={(value) =>
                            onNotificationTtsVoiceChange(
                                value === 'default' ? '' : (value ?? '')
                            )
                        }
                    >
                        <SelectTrigger
                            id="settings-notification-tts-voice"
                            className="w-72"
                        >
                            <SelectValue
                                placeholder={
                                    ttsVoices.length
                                        ? undefined
                                        : t(
                                              'view.settings.empty.no_text_to_speech_voices_are_available'
                                          )
                                }
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="default">
                                    {t(
                                        'view.settings.notifications.notifications.text_to_speech.system_default_voice',
                                        { defaultValue: 'System default' }
                                    )}
                                </SelectItem>
                                {ttsVoices.map((voice) => (
                                    <SelectItem key={voice.id} value={voice.id}>
                                        {voice.language
                                            ? `${voice.name} (${voice.language})`
                                            : voice.name}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    settingId="notifications.tts.volume"
                    onReset={() =>
                        onNotificationTtsVolumeChange(
                            SETTINGS_DEFAULT_VALUES.notificationTTSVolume
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.text_to_speech.tts_volume'
                    )}
                    controlId="settings-notification-tts-volume"
                >
                    <div className="flex w-72 max-w-full items-center justify-end gap-3">
                        <Slider
                            id="settings-notification-tts-volume"
                            value={[ttsVolume]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={(value) =>
                                setDraftTtsVolume(
                                    Array.isArray(value) ? value[0] : value
                                )
                            }
                            onValueCommitted={(value) => {
                                const nextVolume = Array.isArray(value)
                                    ? value[0]
                                    : value;
                                setDraftTtsVolume(null);
                                onNotificationTtsVolumeChange(nextVolume);
                            }}
                        />
                        <span className="text-muted-foreground w-10 text-right text-sm tabular-nums">
                            {ttsVolume}%
                        </span>
                    </div>
                </Field>

                <Field
                    settingId="notifications.tts.filters"
                    label={t(
                        'view.settings.notifications.notifications.text_to_speech.notification_filters'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onOpenTtsNotificationFiltersDialog}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>

                <Field
                    settingId="notifications.tts.name-mode"
                    onReset={() =>
                        onNotificationTtsNameModeChange(
                            SETTINGS_DEFAULT_VALUES.notificationTTSNameMode
                        )
                    }
                    label={t(
                        'view.settings.notifications.notifications.text_to_speech.name_mode'
                    )}
                    controlId="settings-notification-tts-name-mode"
                    disabled={prefs.notificationTTS === 'Never'}
                >
                    <Select
                        value={ttsNameMode}
                        items={notificationTtsNameModeOptions.map(
                            ([value, labelKey]) => ({
                                value,
                                label: t(labelKey)
                            })
                        )}
                        onValueChange={(value) =>
                            onNotificationTtsNameModeChange(value ?? 'username')
                        }
                    >
                        <SelectTrigger
                            id="settings-notification-tts-name-mode"
                            className="w-72"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {notificationTtsNameModeOptions.map(
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
                    settingId="notifications.tts.test"
                    label={t(
                        'view.settings.notifications.notifications.text_to_speech.tts_test_placeholder'
                    )}
                >
                    <Switch
                        checked={notificationTtsTestVisible}
                        onCheckedChange={(checked) =>
                            onNotificationTtsTestVisibleChange(checked === true)
                        }
                    />
                </Field>
                {notificationTtsTestVisible ? (
                    <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
                        <Input
                            value={notificationTtsTest}
                            placeholder={t(
                                'view.settings.notifications.notifications.text_to_speech.tts_test_placeholder'
                            )}
                            onChange={(event) =>
                                onNotificationTtsTestChange(event.target.value)
                            }
                        />
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                                onSpeakNotificationTts(notificationTtsTest)
                            }
                        >
                            {t(
                                'view.settings.notifications.notifications.text_to_speech.play'
                            )}
                        </Button>
                    </div>
                ) : null}
            </SettingsCard>
            {webhookSettings}
            <SettingsCard
                cardId="notifications.test"
                title={t(
                    'view.settings.notifications.notifications.test_notification.header'
                )}
                description={t(
                    'view.settings.notifications.notifications.test_notification.description'
                )}
            >
                <Field
                    settingId="notifications.test.send"
                    label={t(
                        'view.settings.notifications.notifications.test_notification.send'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onSendTestNotification}
                    >
                        {t(
                            'view.settings.notifications.notifications.test_notification.button'
                        )}
                    </Button>
                </Field>
            </SettingsCard>
        </SettingsTabContent>
    );
}
