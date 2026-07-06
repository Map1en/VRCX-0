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
import { Switch } from '@/ui/shadcn/switch';

import { Field, SettingsGroup } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';

type SettingsOptionList = ReadonlyArray<readonly [string, string]>;

type SettingsNotificationsPrefs = Record<string, unknown> & {
    afkDesktopToast?: boolean;
    desktopNotificationSound?: boolean;
    desktopToast?: string;
    notificationIconDot?: boolean;
    notificationLayout?: string;
    notificationTTS?: string;
    notificationTTSNickName?: boolean;
    notificationTTSVoice?: string;
    showPostUpdateChangelogToast?: boolean;
};

type SettingsNotificationsTabProps = {
    desktopToastOptions: SettingsOptionList;
    notificationLayoutOptions: SettingsOptionList;
    notificationTtsOptions: SettingsOptionList;
    notificationTtsTest: string;
    notificationTtsTestVisible: boolean;
    onAfkDesktopToastChange: (checked: boolean) => unknown;
    onDesktopNotificationSoundChange: (checked: boolean) => unknown;
    onDesktopToastChange: (value: string) => unknown;
    onNotificationIconDotChange: (checked: boolean) => unknown;
    onNotificationLayoutChange: (value: string) => unknown;
    onNotificationTtsModeChange: (value: string) => unknown;
    onNotificationTtsNicknameChange: (checked: boolean) => unknown;
    onNotificationTtsTestChange: (value: string) => unknown;
    onNotificationTtsTestVisibleChange: (visible: boolean) => unknown;
    onNotificationTtsVoiceChange: (value: string) => unknown;
    onOpenDesktopNotificationFiltersDialog: () => unknown;
    onOpenFeedFilterDialog: () => unknown;
    onPostUpdateChangelogToastChange: (checked: boolean) => unknown;
    onSpeakNotificationTts: (message: string) => unknown;
    onTestDesktopNotification: () => unknown;
    prefs: SettingsNotificationsPrefs;
    ttsVoices: SpeechSynthesisVoice[];
};

export function SettingsNotificationsTab({
    prefs,
    notificationLayoutOptions,
    desktopToastOptions,
    notificationTtsOptions,
    ttsVoices,
    notificationTtsTestVisible,
    notificationTtsTest,
    onNotificationLayoutChange,
    onNotificationIconDotChange,
    onPostUpdateChangelogToastChange,
    onOpenFeedFilterDialog,
    onOpenDesktopNotificationFiltersDialog,
    onTestDesktopNotification,
    onDesktopToastChange,
    onAfkDesktopToastChange,
    onDesktopNotificationSoundChange,
    onNotificationTtsModeChange,
    onNotificationTtsVoiceChange,
    onNotificationTtsNicknameChange,
    onNotificationTtsTestVisibleChange,
    onNotificationTtsTestChange,
    onSpeakNotificationTts
}: SettingsNotificationsTabProps) {
    const { t } = useTranslation();

    return (
        <SettingsTabContent value="notifications">
            <SettingsGroup
                title={t('view.settings.notifications.notifications.header')}
            >
                <Field
                    label={t(
                        'view.settings.notifications.notifications.layout'
                    )}
                    controlId="settings-notification-layout"
                >
                    <Select
                        value={prefs.notificationLayout}
                        items={notificationLayoutOptions.map(
                            ([value, labelKey]) => ({
                                value,
                                label: t(labelKey)
                            })
                        )}
                        onValueChange={(value) =>
                            onNotificationLayoutChange(value ?? '')
                        }
                    >
                        <SelectTrigger
                            id="settings-notification-layout"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {notificationLayoutOptions.map(
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
                    label={t(
                        'view.settings.appearance.appearance.show_notification_icon_dot'
                    )}
                >
                    <Switch
                        checked={prefs.notificationIconDot}
                        onCheckedChange={onNotificationIconDotChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.notifications.notifications.post_update_changelog_prompt'
                    )}
                    description={t(
                        'view.settings.notifications.notifications.post_update_changelog_prompt_description'
                    )}
                >
                    <Switch
                        checked={prefs.showPostUpdateChangelogToast}
                        onCheckedChange={onPostUpdateChangelogToastChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.notifications.notifications.notification_filter'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onOpenFeedFilterDialog}
                    >
                        {t(
                            'view.settings.notifications.notifications.notification_filter'
                        )}
                    </Button>
                </Field>

                <Field
                    label={t(
                        'view.settings.notifications.notifications.test_notification'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onTestDesktopNotification}
                    >
                        {t(
                            'view.settings.notifications.notifications.test_notification'
                        )}
                    </Button>
                </Field>
            </SettingsGroup>
            <SettingsGroup
                title={t(
                    'view.settings.notifications.notifications.desktop_notifications.header'
                )}
            >
                <Field
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
                    label={t(
                        'view.settings.notifications.notifications.desktop_notifications.notification_sound'
                    )}
                >
                    <Switch
                        checked={prefs.desktopNotificationSound}
                        onCheckedChange={onDesktopNotificationSoundChange}
                    />
                </Field>
            </SettingsGroup>
            <SettingsGroup
                title={t(
                    'view.settings.notifications.notifications.text_to_speech.header'
                )}
            >
                <Field
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
                    label={t(
                        'view.settings.notifications.notifications.text_to_speech.tts_voice'
                    )}
                    controlId="settings-notification-tts-voice"
                >
                    <Select
                        value={prefs.notificationTTSVoice}
                        items={ttsVoices.map((voice, index) => ({
                            value: String(index),
                            label: voice.name
                        }))}
                        disabled={
                            prefs.notificationTTS === 'Never' ||
                            !ttsVoices.length
                        }
                        onValueChange={(value) =>
                            onNotificationTtsVoiceChange(value ?? '')
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
                                              'view.settings.notifications.notifications.no_text_to_speech_voices_are_available'
                                          )
                                }
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {ttsVoices.map((voice, index) => (
                                    <SelectItem
                                        key={`${voice.name}-${index}`}
                                        value={String(index)}
                                    >
                                        {voice.name}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    label={t(
                        'view.settings.notifications.notifications.text_to_speech.use_memo_nicknames'
                    )}
                >
                    <Switch
                        checked={prefs.notificationTTSNickName}
                        disabled={prefs.notificationTTS === 'Never'}
                        onCheckedChange={onNotificationTtsNicknameChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.notifications.notifications.text_to_speech.tts_test_placeholder'
                    )}
                >
                    <Switch
                        checked={notificationTtsTestVisible}
                        disabled={prefs.notificationTTS === 'Never'}
                        onCheckedChange={(checked) =>
                            onNotificationTtsTestVisibleChange(checked === true)
                        }
                    />
                </Field>
                {notificationTtsTestVisible ? (
                    <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
                        <Input
                            value={notificationTtsTest}
                            disabled={prefs.notificationTTS === 'Never'}
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
                            disabled={prefs.notificationTTS === 'Never'}
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
            </SettingsGroup>
        </SettingsTabContent>
    );
}
