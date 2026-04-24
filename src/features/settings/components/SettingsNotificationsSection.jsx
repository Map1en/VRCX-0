export function SettingsNotificationsSection({ notifications }) {
    const {
        SettingsNotificationsTab,
        t,
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
        backend,
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
            t={t}
            prefs={prefs}
            notificationLayoutOptions={notificationLayoutOptions}
            desktopToastOptions={desktopToastOptions}
            notificationTtsOptions={notificationTtsOptions}
            ttsVoices={ttsVoices}
            notificationTtsTestVisible={notificationTtsTestVisible}
            notificationTtsTest={notificationTtsTest}
            onNotificationLayoutChange={(value) =>
                void commit(
                    async () => {
                        const nextLayout =
                            await setNotificationLayoutPreference(value);
                        setPrefs((current) => ({
                            ...current,
                            notificationLayout: nextLayout
                        }));
                    },
                    () => {
                        const previous = prefs.notificationLayout;
                        setPrefs((current) => ({
                            ...current,
                            notificationLayout: value
                        }));
                        return () =>
                            setPrefs((current) => ({
                                ...current,
                                notificationLayout: previous
                            }));
                    }
                )
            }
            onOpenFeedFilterDialog={() => setFeedFilterDialogOpen(true)}
            onTestDesktopNotification={() =>
                void backend.app.DesktopNotification(
                    'VRCX-0',
                    t('view.settings.notifications.notifications.test_message')
                )
            }
            onDesktopToastChange={(value) =>
                void saveStringPreference('desktopToast', 'desktopToast', value)
            }
            onAfkDesktopToastChange={(checked) =>
                void saveBoolPreference(
                    'afkDesktopToast',
                    'afkDesktopToast',
                    checked
                )
            }
            onNotificationTtsModeChange={(value) =>
                void saveNotificationTtsMode(value)
            }
            onNotificationTtsVoiceChange={(value) =>
                void saveNotificationTtsVoice(value)
            }
            onNotificationTtsNicknameChange={(checked) =>
                void saveBoolPreference(
                    'notificationTTSNickName',
                    'notificationTTSNickName',
                    checked
                )
            }
            onNotificationTtsTestVisibleChange={setNotificationTtsTestVisible}
            onNotificationTtsTestChange={setNotificationTtsTest}
            onSpeakNotificationTts={(message) => speakNotificationTts(message)}
        />
    );
}
