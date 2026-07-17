import type { BuildSettingsPageStateSectionsInput } from '../settingsPageStateSections';
import { normalizeCheckedState } from '../settingsValues';

export function buildIntegrationsSection({
    prefs,
    discordPrefs,
    integrationPrefs,
    avatarProviderConfig,
    saveDiscordBoolPreference,
    setPrefs,
    setWebhookNotificationsDialogOpen,
    saveStringPreference,
    saveBoolPreference,
    commit,
    setTranslationApiEnabledPreference,
    setIntegrationValue,
    openTranslationApiDialog,
    setYoutubeApiEnabledPreference,
    openYoutubeApiDialog,
    saveAvatarProviderConfig,
    avatarProviderConfigRef,
    applyAvatarProviderConfig,
    setAvatarProviderDialogOpen,
    saveIntegrationBoolPreference,
    saveAvatarProviderEnabled
}: BuildSettingsPageStateSectionsInput) {
    return {
        prefs,
        discordPrefs,
        integrationPrefs,
        avatarProviderConfig,
        saveDiscordBoolPreference,
        setPrefs,
        setWebhookNotificationsDialogOpen,
        saveStringPreference,
        saveBoolPreference,
        commit,
        setTranslationApiEnabledPreference,
        setIntegrationValue,
        openTranslationApiDialog,
        setYoutubeApiEnabledPreference,
        openYoutubeApiDialog,
        saveAvatarProviderConfig,
        avatarProviderConfigRef,
        applyAvatarProviderConfig,
        setAvatarProviderDialogOpen,
        onDiscordActiveChange: (checked: unknown) => {
            saveDiscordBoolPreference(
                'discordActive',
                normalizeCheckedState(checked)
            );
        },
        onDiscordWorldIntegrationChange: (checked: unknown) => {
            saveDiscordBoolPreference(
                'discordWorldIntegration',
                normalizeCheckedState(checked)
            );
        },
        onDiscordInstanceChange: (checked: unknown) => {
            saveDiscordBoolPreference(
                'discordInstance',
                normalizeCheckedState(checked)
            );
        },
        onDiscordShowPlatformChange: (checked: unknown) => {
            saveDiscordBoolPreference(
                'discordShowPlatform',
                normalizeCheckedState(checked)
            );
        },
        onDiscordShowPrivateDetailsChange: (checked: unknown) => {
            saveDiscordBoolPreference(
                'discordHideInvite',
                !normalizeCheckedState(checked)
            );
        },
        onDiscordJoinButtonChange: (checked: unknown) => {
            saveDiscordBoolPreference(
                'discordJoinButton',
                normalizeCheckedState(checked)
            );
        },
        onDiscordShowImagesChange: (checked: unknown) => {
            saveDiscordBoolPreference(
                'discordHideImage',
                !normalizeCheckedState(checked)
            );
        },
        onDiscordWorldNameAsStatusChange: (checked: unknown) => {
            saveDiscordBoolPreference(
                'discordWorldNameAsDiscordStatus',
                normalizeCheckedState(checked)
            );
        },
        onTranslationApiEnabledChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveIntegrationBoolPreference('translationAPI', enabled, () =>
                setTranslationApiEnabledPreference(enabled)
            );
        },
        onOpenTranslationApiDialog: () => {
            openTranslationApiDialog();
        },
        onYoutubeApiEnabledChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveIntegrationBoolPreference('youtubeAPI', enabled, () =>
                setYoutubeApiEnabledPreference(enabled)
            );
        },
        onOpenYoutubeApiDialog: () => {
            openYoutubeApiDialog();
        },
        onAvatarProviderEnabledChange: (checked: unknown) => {
            saveAvatarProviderEnabled(normalizeCheckedState(checked));
        },
        onOpenAvatarProviderDialog: () => {
            setAvatarProviderDialogOpen(true);
        }
    };
}
