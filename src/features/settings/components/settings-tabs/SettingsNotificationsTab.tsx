import { useTranslation } from 'react-i18next';

import type { TtsVoice } from '@/platform/tauri/bindings';
import { normalizeNotificationTtsNameMode } from '@/state/preferencesStore';
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
    notificationTTS?: string;
    notificationTTSNameMode?: string;
    notificationTTSNickName?: boolean;
    notificationTTSVoiceNative?: string;
};

type SettingsNotificationsTabProps = {
    desktopToastOptions: SettingsOptionList;
    notificationTtsOptions: SettingsOptionList;
    notificationTtsNameModeOptions: SettingsOptionList;
    notificationTtsTest: string;
    notificationTtsTestVisible: boolean;
    onAfkDesktopToastChange: (checked: boolean) => unknown;
    onDesktopNotificationSoundChange: (checked: boolean) => unknown;
    onDesktopToastChange: (value: string) => unknown;
    onNotificationTtsModeChange: (value: string) => unknown;
    onNotificationTtsNameModeChange: (value: string) => unknown;
    onNotificationTtsTestChange: (value: string) => unknown;
    onNotificationTtsTestVisibleChange: (visible: boolean) => unknown;
    onNotificationTtsVoiceChange: (value: string) => unknown;
    onOpenDesktopNotificationFiltersDialog: () => unknown;
    onOpenTtsNotificationFiltersDialog: () => unknown;
    onSpeakNotificationTts: (message: string) => unknown;
    prefs: SettingsNotificationsPrefs;
    ttsVoices: TtsVoice[];
};

export function SettingsNotificationsTab({
    prefs,
    desktopToastOptions,
    notificationTtsOptions,
    notificationTtsNameModeOptions,
    ttsVoices,
    notificationTtsTestVisible,
    notificationTtsTest,
    onOpenDesktopNotificationFiltersDialog,
    onOpenTtsNotificationFiltersDialog,
    onDesktopToastChange,
    onAfkDesktopToastChange,
    onDesktopNotificationSoundChange,
    onNotificationTtsModeChange,
    onNotificationTtsVoiceChange,
    onNotificationTtsNameModeChange,
    onNotificationTtsTestVisibleChange,
    onNotificationTtsTestChange,
    onSpeakNotificationTts
}: SettingsNotificationsTabProps) {
    const { t } = useTranslation();
    const ttsNameMode = normalizeNotificationTtsNameMode(
        prefs.notificationTTSNameMode,
        prefs.notificationTTSNickName
    );

    return (
        <SettingsTabContent value="notifications">
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
                        disabled={prefs.notificationTTS === 'Never'}
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
                    label={t(
                        'view.settings.notifications.notifications.text_to_speech.name_mode'
                    )}
                    controlId="settings-notification-tts-name-mode"
                >
                    <Select
                        value={ttsNameMode}
                        items={notificationTtsNameModeOptions.map(
                            ([value, labelKey]) => ({
                                value,
                                label: t(labelKey)
                            })
                        )}
                        disabled={prefs.notificationTTS === 'Never'}
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
