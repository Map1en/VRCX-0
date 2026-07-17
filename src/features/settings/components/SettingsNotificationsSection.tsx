import { useTranslation } from 'react-i18next';

import type { SettingsPageStateSections } from '../settingsPageStateSections';
import { normalizeCheckedState } from '../settingsValues';
import { SettingsNotificationsTab } from './settings-tabs/SettingsNotificationsTab';

type SettingsNotificationsSectionProps = {
    notifications: SettingsPageStateSections['notifications'];
};

export function SettingsNotificationsSection({
    notifications
}: SettingsNotificationsSectionProps) {
    const { t } = useTranslation();
    const {
        prefs,
        desktopToastOptions,
        notificationTtsOptions,
        notificationTtsNameModeOptions,
        ttsVoices,
        notificationTtsTestVisible,
        notificationTtsTest,
        setDesktopNotificationsDialogOpen,
        setTtsNotificationsDialogOpen,
        saveStringPreference,
        saveBoolPreference,
        saveNotificationTtsMode,
        saveNotificationTtsVoice,
        setNotificationTtsTestVisible,
        setNotificationTtsTest,
        speakNotificationTts
    } = notifications;

    return (
        <SettingsNotificationsTab
            prefs={prefs}
            desktopToastOptions={desktopToastOptions}
            notificationTtsOptions={notificationTtsOptions}
            notificationTtsNameModeOptions={notificationTtsNameModeOptions}
            ttsVoices={ttsVoices}
            notificationTtsTestVisible={notificationTtsTestVisible}
            notificationTtsTest={notificationTtsTest}
            onOpenDesktopNotificationFiltersDialog={() =>
                setDesktopNotificationsDialogOpen(true)
            }
            onOpenTtsNotificationFiltersDialog={() =>
                setTtsNotificationsDialogOpen(true)
            }
            onDesktopToastChange={(value: string) => {
                saveStringPreference('desktopToast', 'desktopToast', value);
            }}
            onAfkDesktopToastChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'afkDesktopToast',
                    'afkDesktopToast',
                    enabled
                );
            }}
            onDesktopNotificationSoundChange={(checked: unknown) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'desktopNotificationSound',
                    'desktopNotificationSound',
                    enabled
                );
            }}
            onNotificationTtsModeChange={(value: string) => {
                saveNotificationTtsMode(value);
            }}
            onNotificationTtsVoiceChange={(value: string) => {
                saveNotificationTtsVoice(value);
            }}
            onNotificationTtsNameModeChange={(value: string) => {
                saveStringPreference(
                    'notificationTTSNameMode',
                    'notificationTTSNameMode',
                    value
                );
            }}
            onNotificationTtsTestVisibleChange={setNotificationTtsTestVisible}
            onNotificationTtsTestChange={setNotificationTtsTest}
            onSpeakNotificationTts={(message: unknown) =>
                speakNotificationTts(
                    String(
                        message ||
                            t(
                                'view.settings.notifications.notifications.text_to_speech.tts_test_placeholder'
                            )
                    )
                )
            }
        />
    );
}
