import { useTranslation } from 'react-i18next';

import { POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY } from '@/services/changelogService';
import { showDesktopNotification } from '@/services/shellIntegrationService';

import { SettingsNotificationsTab } from './settings-tabs/SettingsNotificationsTab';

export function SettingsNotificationsSection({ notifications }: any) {
    const { t } = useTranslation();
    const {
        prefs,
        notificationLayoutOptions,
        desktopToastOptions,
        notificationTtsOptions,
        ttsVoices,
        notificationTtsTestVisible,
        notificationTtsTest,
        commit,
        setNotificationLayoutPreference,
        setPrefs,
        setFeedFilterDialogOpen,
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
            notificationLayoutOptions={notificationLayoutOptions}
            desktopToastOptions={desktopToastOptions}
            notificationTtsOptions={notificationTtsOptions}
            ttsVoices={ttsVoices}
            notificationTtsTestVisible={notificationTtsTestVisible}
            notificationTtsTest={notificationTtsTest}
            onNotificationLayoutChange={(value: any) => {
                commit(
                    async () => {
                        const nextLayout =
                            await setNotificationLayoutPreference(value);
                        setPrefs((current: any) => ({
                            ...current,
                            notificationLayout: nextLayout
                        }));
                    },
                    () => {
                        const previous = prefs.notificationLayout;
                        setPrefs((current: any) => ({
                            ...current,
                            notificationLayout: value
                        }));
                        return () =>
                            setPrefs((current: any) => ({
                                ...current,
                                notificationLayout: previous
                            }));
                    }
                );
            }}
            onNotificationIconDotChange={(checked: any) => {
                saveBoolPreference(
                    'notificationIconDot',
                    'notificationIconDot',
                    checked
                );
            }}
            onPostUpdateChangelogToastChange={(checked: any) => {
                saveBoolPreference(
                    'showPostUpdateChangelogToast',
                    POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY,
                    checked
                );
            }}
            onOpenFeedFilterDialog={() => setFeedFilterDialogOpen(true)}
            onTestDesktopNotification={() => {
                showDesktopNotification(
                    'VRCX-0',
                    t('view.settings.notifications.notifications.test_message'),
                    '',
                    prefs.desktopNotificationSound
                );
            }}
            onDesktopToastChange={(value: any) => {
                saveStringPreference('desktopToast', 'desktopToast', value);
            }}
            onAfkDesktopToastChange={(checked: any) => {
                saveBoolPreference(
                    'afkDesktopToast',
                    'afkDesktopToast',
                    checked
                );
            }}
            onDesktopNotificationSoundChange={(checked: any) => {
                saveBoolPreference(
                    'desktopNotificationSound',
                    'desktopNotificationSound',
                    checked
                );
            }}
            onNotificationTtsModeChange={(value: any) => {
                saveNotificationTtsMode(value);
            }}
            onNotificationTtsVoiceChange={(value: any) => {
                saveNotificationTtsVoice(value);
            }}
            onNotificationTtsNicknameChange={(checked: any) => {
                saveBoolPreference(
                    'notificationTTSNickName',
                    'notificationTTSNickName',
                    checked
                );
            }}
            onNotificationTtsTestVisibleChange={setNotificationTtsTestVisible}
            onNotificationTtsTestChange={setNotificationTtsTest}
            onSpeakNotificationTts={(message: any) =>
                speakNotificationTts(message)
            }
        />
    );
}
