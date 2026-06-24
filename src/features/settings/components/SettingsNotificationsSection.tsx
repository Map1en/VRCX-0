import { useTranslation } from 'react-i18next';

import { POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY } from '@/services/changelogService';
import { showDesktopNotification } from '@/services/shellIntegrationService';

import { normalizeCheckedState } from '../settingsValues';
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
        setDesktopNotificationsDialogOpen,
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
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'notificationIconDot',
                    'notificationIconDot',
                    enabled
                );
            }}
            onPostUpdateChangelogToastChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'showPostUpdateChangelogToast',
                    POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY,
                    enabled
                );
            }}
            onOpenFeedFilterDialog={() => setFeedFilterDialogOpen(true)}
            onOpenDesktopNotificationFiltersDialog={() =>
                setDesktopNotificationsDialogOpen(true)
            }
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
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'afkDesktopToast',
                    'afkDesktopToast',
                    enabled
                );
            }}
            onDesktopNotificationSoundChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'desktopNotificationSound',
                    'desktopNotificationSound',
                    enabled
                );
            }}
            onNotificationTtsModeChange={(value: any) => {
                saveNotificationTtsMode(value);
            }}
            onNotificationTtsVoiceChange={(value: any) => {
                saveNotificationTtsVoice(value);
            }}
            onNotificationTtsNicknameChange={(checked: any) => {
                const enabled = normalizeCheckedState(checked);
                saveBoolPreference(
                    'notificationTTSNickName',
                    'notificationTTSNickName',
                    enabled
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
