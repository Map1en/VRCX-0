import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
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

import { Field } from '../SettingsField.jsx';
import { SettingsTabContent } from '../SettingsViewParts.jsx';

export function SettingsNotificationsTab({
    t,
    prefs,
    notificationLayoutOptions,
    desktopToastOptions,
    notificationTtsOptions,
    ttsVoices,
    notificationTtsTestVisible,
    notificationTtsTest,
    onNotificationLayoutChange,
    onOpenFeedFilterDialog,
    onTestDesktopNotification,
    onDesktopToastChange,
    onAfkDesktopToastChange,
    onNotificationTtsModeChange,
    onNotificationTtsVoiceChange,
    onNotificationTtsNicknameChange,
    onNotificationTtsTestVisibleChange,
    onNotificationTtsTestChange,
    onSpeakNotificationTts
}) {
    return (
        <SettingsTabContent value="notifications">
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.notifications.notifications.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.notifications.notifications.layout'
                        )}
                        controlId="settings-notification-layout"
                    >
                        <Select
                            value={prefs.notificationLayout}
                            onValueChange={onNotificationLayoutChange}
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
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t(
                            'view.settings.notifications.notifications.desktop_notifications.header'
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.notifications.notifications.desktop_notifications.when_to_display'
                        )}
                        controlId="settings-desktop-toast"
                    >
                        <Select
                            value={prefs.desktopToast}
                            onValueChange={onDesktopToastChange}
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
                        label={t(
                            'view.settings.notifications.notifications.desktop_notifications.desktop_notification_while_afk'
                        )}
                    >
                        <Switch
                            checked={prefs.afkDesktopToast}
                            onCheckedChange={onAfkDesktopToastChange}
                        />
                    </Field>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t(
                            'view.settings.notifications.notifications.text_to_speech.header'
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.notifications.notifications.text_to_speech.when_to_play'
                        )}
                        controlId="settings-notification-tts"
                    >
                        <Select
                            value={prefs.notificationTTS}
                            onValueChange={onNotificationTtsModeChange}
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
                        label={t(
                            'view.settings.notifications.notifications.text_to_speech.tts_voice'
                        )}
                        controlId="settings-notification-tts-voice"
                    >
                        <Select
                            value={prefs.notificationTTSVoice}
                            disabled={
                                prefs.notificationTTS === 'Never' ||
                                !ttsVoices.length
                            }
                            onValueChange={onNotificationTtsVoiceChange}
                        >
                            <SelectTrigger
                                id="settings-notification-tts-voice"
                                className="w-72"
                            >
                                <SelectValue
                                    placeholder={
                                        ttsVoices.length
                                            ? undefined
                                            : 'No voices'
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
                                onNotificationTtsTestVisibleChange(
                                    checked === true
                                )
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
                                    onNotificationTtsTestChange(
                                        event.target.value
                                    )
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
                </CardContent>
            </Card>
        </SettingsTabContent>
    );
}
