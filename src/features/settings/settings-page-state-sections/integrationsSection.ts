import type { SettingsSectionInput } from '../settingsPageStateSectionTypes';

type IntegrationsSectionInput = SettingsSectionInput<
    | 'discordPrefs'
    | 'integrationPrefs'
    | 'avatarProviderConfig'
    | 'saveDiscordBoolPreference'
    | 'setPrefs'
    | 'commit'
    | 'setTranslationApiEnabledPreference'
    | 'setIntegrationValue'
    | 'openTranslationApiDialog'
    | 'setYoutubeApiEnabledPreference'
    | 'openYoutubeApiDialog'
    | 'saveAvatarProviderConfig'
    | 'applyAvatarProviderConfig'
    | 'setAvatarProviderDialogOpen'
    | 'saveIntegrationBoolPreference'
    | 'saveAvatarProviderEnabled'
>;

export function buildIntegrationsSection({
    discordPrefs,
    integrationPrefs,
    avatarProviderConfig,
    saveDiscordBoolPreference,
    setPrefs,
    commit,
    setTranslationApiEnabledPreference,
    setIntegrationValue,
    openTranslationApiDialog,
    setYoutubeApiEnabledPreference,
    openYoutubeApiDialog,
    saveAvatarProviderConfig,
    applyAvatarProviderConfig,
    setAvatarProviderDialogOpen,
    saveIntegrationBoolPreference,
    saveAvatarProviderEnabled
}: IntegrationsSectionInput) {
    return {
        discordPrefs,
        integrationPrefs,
        avatarProviderConfig,
        saveDiscordBoolPreference,
        setPrefs,
        commit,
        setTranslationApiEnabledPreference,
        setIntegrationValue,
        openTranslationApiDialog,
        setYoutubeApiEnabledPreference,
        openYoutubeApiDialog,
        saveAvatarProviderConfig,
        applyAvatarProviderConfig,
        setAvatarProviderDialogOpen,
        onDiscordActiveChange: (checked: boolean) => {
            saveDiscordBoolPreference('discordActive', checked);
        },
        onDiscordWorldIntegrationChange: (checked: boolean) => {
            saveDiscordBoolPreference('discordWorldIntegration', checked);
        },
        onDiscordInstanceChange: (checked: boolean) => {
            saveDiscordBoolPreference('discordInstance', checked);
        },
        onDiscordShowPlatformChange: (checked: boolean) => {
            saveDiscordBoolPreference('discordShowPlatform', checked);
        },
        onDiscordShowPrivateDetailsChange: (checked: boolean) => {
            saveDiscordBoolPreference('discordHideInvite', !checked);
        },
        onDiscordJoinButtonChange: (checked: boolean) => {
            saveDiscordBoolPreference('discordJoinButton', checked);
        },
        onDiscordShowImagesChange: (checked: boolean) => {
            saveDiscordBoolPreference('discordHideImage', !checked);
        },
        onDiscordWorldNameAsStatusChange: (checked: boolean) => {
            saveDiscordBoolPreference(
                'discordWorldNameAsDiscordStatus',
                checked
            );
        },
        onTranslationApiEnabledChange: (checked: boolean) => {
            saveIntegrationBoolPreference('translationAPI', checked, () =>
                setTranslationApiEnabledPreference(checked)
            );
        },
        onOpenTranslationApiDialog: () => {
            openTranslationApiDialog();
        },
        onYoutubeApiEnabledChange: (checked: boolean) => {
            saveIntegrationBoolPreference('youtubeAPI', checked, () =>
                setYoutubeApiEnabledPreference(checked)
            );
        },
        onOpenYoutubeApiDialog: () => {
            openYoutubeApiDialog();
        },
        onAvatarProviderEnabledChange: (checked: boolean) => {
            saveAvatarProviderEnabled(checked);
        },
        onOpenAvatarProviderDialog: () => {
            setAvatarProviderDialogOpen(true);
        }
    };
}
