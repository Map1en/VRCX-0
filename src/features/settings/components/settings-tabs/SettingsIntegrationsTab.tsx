import { useTranslation } from 'react-i18next';

import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Switch } from '@/ui/shadcn/switch';

import { SETTINGS_DEFAULT_VALUES } from '../../settingsFieldState';
import { useSettingsPageSection } from '../../SettingsPageStateContext';
import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';
import { IntegrationApiSettingsGroup } from './IntegrationApiSettingsGroup';

export function SettingsIntegrationsTab() {
    const integrations = useSettingsPageSection('integrations');
    const {
        discordPrefs,
        integrationPrefs,
        avatarProviderConfig,
        onDiscordActiveChange,
        onDiscordWorldIntegrationChange,
        onDiscordInstanceChange,
        onDiscordShowPlatformChange,
        onDiscordShowPrivateDetailsChange,
        onDiscordJoinButtonChange,
        onDiscordShowImagesChange,
        onDiscordWorldNameAsStatusChange,
        onTranslationApiEnabledChange,
        onOpenTranslationApiDialog,
        onYoutubeApiEnabledChange,
        onOpenYoutubeApiDialog,
        onAvatarProviderEnabledChange,
        onOpenAvatarProviderDialog
    } = integrations;
    const { t } = useTranslation();
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );

    function openVrchatConfig() {
        setSystemHostOpen('vrchatConfigOpen', true);
    }

    return (
        <SettingsTabContent value="integrations">
            <SettingsCard
                cardId="integrations.discord"
                title={t(
                    'view.settings.discord_presence.discord_presence.header'
                )}
            >
                <Field
                    settingId="integrations.discord.enabled"
                    onReset={() =>
                        onDiscordActiveChange(
                            SETTINGS_DEFAULT_VALUES.discordActive
                        )
                    }
                    label={t(
                        'view.settings.discord_presence.discord_presence.enable'
                    )}
                    description={
                        <Button
                            type="button"
                            variant="link"
                            className="text-muted-foreground hover:text-foreground h-auto justify-start p-0 text-left text-xs font-normal hover:bg-transparent hover:no-underline"
                            onClick={openVrchatConfig}
                        >
                            {t(
                                'view.settings.discord_presence.discord_presence.enable_tooltip'
                            )}
                        </Button>
                    }
                >
                    <Switch
                        checked={discordPrefs.discordActive}
                        onCheckedChange={onDiscordActiveChange}
                    />
                </Field>

                <Field
                    settingId="integrations.discord.world-integration"
                    onReset={() =>
                        onDiscordWorldIntegrationChange(
                            SETTINGS_DEFAULT_VALUES.discordWorldIntegration
                        )
                    }
                    label={t(
                        'view.settings.discord_presence.discord_presence.world_integration'
                    )}
                    description={t(
                        'view.settings.discord_presence.discord_presence.world_integration_tooltip'
                    )}
                >
                    <Switch
                        checked={discordPrefs.discordWorldIntegration}
                        onCheckedChange={onDiscordWorldIntegrationChange}
                    />
                </Field>

                <Field
                    settingId="integrations.discord.instance"
                    onReset={() =>
                        onDiscordInstanceChange(
                            SETTINGS_DEFAULT_VALUES.discordInstance
                        )
                    }
                    label={t(
                        'view.settings.discord_presence.discord_presence.instance_type_player_count'
                    )}
                >
                    <Switch
                        checked={discordPrefs.discordInstance}
                        onCheckedChange={onDiscordInstanceChange}
                    />
                </Field>

                <Field
                    settingId="integrations.discord.show-platform"
                    onReset={() =>
                        onDiscordShowPlatformChange(
                            SETTINGS_DEFAULT_VALUES.discordShowPlatform
                        )
                    }
                    label={t(
                        'view.settings.discord_presence.discord_presence.show_current_platform'
                    )}
                >
                    <Switch
                        checked={discordPrefs.discordShowPlatform}
                        onCheckedChange={onDiscordShowPlatformChange}
                    />
                </Field>

                <Field
                    settingId="integrations.discord.show-private-details"
                    onReset={() =>
                        onDiscordShowPrivateDetailsChange(
                            !SETTINGS_DEFAULT_VALUES.discordHideInvite
                        )
                    }
                    label={t(
                        'view.settings.discord_presence.discord_presence.show_details_in_private'
                    )}
                >
                    <Switch
                        checked={!discordPrefs.discordHideInvite}
                        onCheckedChange={onDiscordShowPrivateDetailsChange}
                    />
                </Field>

                <Field
                    settingId="integrations.discord.join-button"
                    onReset={() =>
                        onDiscordJoinButtonChange(
                            SETTINGS_DEFAULT_VALUES.discordJoinButton
                        )
                    }
                    label={t(
                        'view.settings.discord_presence.discord_presence.join_button'
                    )}
                    description={t(
                        'view.settings.discord_presence.discord_presence.join_button_description'
                    )}
                >
                    <Switch
                        checked={discordPrefs.discordJoinButton}
                        onCheckedChange={onDiscordJoinButtonChange}
                    />
                </Field>

                <Field
                    settingId="integrations.discord.show-images"
                    onReset={() =>
                        onDiscordShowImagesChange(
                            !SETTINGS_DEFAULT_VALUES.discordHideImage
                        )
                    }
                    label={t(
                        'view.settings.discord_presence.discord_presence.show_images'
                    )}
                >
                    <Switch
                        checked={!discordPrefs.discordHideImage}
                        onCheckedChange={onDiscordShowImagesChange}
                    />
                </Field>

                <Field
                    settingId="integrations.discord.world-name-as-status"
                    onReset={() =>
                        onDiscordWorldNameAsStatusChange(
                            SETTINGS_DEFAULT_VALUES.discordWorldNameAsDiscordStatus
                        )
                    }
                    label={t(
                        'view.settings.discord_presence.discord_presence.display_world_name_as_discord_status'
                    )}
                >
                    <Switch
                        checked={discordPrefs.discordWorldNameAsDiscordStatus}
                        onCheckedChange={onDiscordWorldNameAsStatusChange}
                    />
                </Field>
            </SettingsCard>

            <SettingsCard
                cardId="integrations.translation"
                title={t(
                    'view.settings.advanced.advanced.translation_api.header'
                )}
                description={t(
                    'view.settings.advanced.advanced.translation_api.enable_tooltip'
                )}
            >
                <Field
                    settingId="integrations.translation.enabled"
                    onReset={() =>
                        onTranslationApiEnabledChange(
                            SETTINGS_DEFAULT_VALUES.translationAPI
                        )
                    }
                    label={t(
                        'view.settings.advanced.advanced.translation_api.enable'
                    )}
                >
                    <Switch
                        checked={integrationPrefs.translationAPI}
                        onCheckedChange={onTranslationApiEnabledChange}
                    />
                </Field>
                <Field
                    settingId="integrations.translation.api-key"
                    label={t(
                        'view.settings.advanced.advanced.translation_api.translation_api_key'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onOpenTranslationApiDialog}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>
            </SettingsCard>

            <SettingsCard
                cardId="integrations.youtube"
                title={t('view.settings.advanced.advanced.youtube_api.header')}
                description={t(
                    'view.settings.advanced.advanced.youtube_api.enable_tooltip'
                )}
            >
                <Field
                    settingId="integrations.youtube.enabled"
                    onReset={() =>
                        onYoutubeApiEnabledChange(
                            SETTINGS_DEFAULT_VALUES.youtubeAPI
                        )
                    }
                    label={t(
                        'view.settings.advanced.advanced.youtube_api.enable'
                    )}
                >
                    <Switch
                        checked={integrationPrefs.youtubeAPI}
                        onCheckedChange={onYoutubeApiEnabledChange}
                    />
                </Field>
                <Field
                    settingId="integrations.youtube.api-key"
                    label={t(
                        'view.settings.advanced.advanced.youtube_api.youtube_api_key'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onOpenYoutubeApiDialog}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>
            </SettingsCard>

            <SettingsCard
                cardId="integrations.remote-database"
                title={t(
                    'view.settings.advanced.advanced.remote_database.header'
                )}
                description={t(
                    'view.settings.advanced.advanced.remote_database.enable_description'
                )}
            >
                <Field
                    settingId="integrations.remote-database.enabled"
                    label={t(
                        'view.settings.advanced.advanced.remote_database.enable'
                    )}
                >
                    <Switch
                        checked={avatarProviderConfig.enabled}
                        onCheckedChange={onAvatarProviderEnabledChange}
                    />
                </Field>

                <Field
                    settingId="integrations.remote-database.providers"
                    label={t(
                        'view.settings.advanced.advanced.remote_database.avatar_database_provider'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onOpenAvatarProviderDialog}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>
            </SettingsCard>

            <IntegrationApiSettingsGroup />
        </SettingsTabContent>
    );
}
