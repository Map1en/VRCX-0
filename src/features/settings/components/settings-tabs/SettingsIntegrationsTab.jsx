import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from '../SettingsField.jsx';
import { SettingsTabContent } from '../SettingsViewParts.jsx';

export function SettingsIntegrationsTab({
    t,
    discordPrefs,
    integrationPrefs,
    avatarProviderConfig,
    onOpenVrchatConfig,
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
}) {
    return (
        <SettingsTabContent value="integrations">
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t(
                            'view.settings.discord_presence.discord_presence.header'
                        )}
                    </CardTitle>
                    <CardDescription className="flex flex-col gap-2">
                        <div>
                            {t(
                                'view.settings.discord_presence.discord_presence.description'
                            )}
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            className="text-muted-foreground hover:text-primary h-auto justify-start p-0 text-left text-xs font-normal"
                            onClick={onOpenVrchatConfig}
                        >
                            {t(
                                'view.settings.discord_presence.discord_presence.enable_tooltip'
                            )}
                        </Button>
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.discord_presence.discord_presence.enable'
                        )}
                    >
                        <Switch
                            checked={discordPrefs.discordActive}
                            onCheckedChange={onDiscordActiveChange}
                        />
                    </Field>

                    <Field
                        label={t(
                            'view.settings.discord_presence.discord_presence.world_integration'
                        )}
                        description={t(
                            'view.settings.discord_presence.discord_presence.world_integration_tooltip'
                        )}
                    >
                        <Switch
                            checked={discordPrefs.discordWorldIntegration}
                            disabled={!discordPrefs.discordActive}
                            onCheckedChange={onDiscordWorldIntegrationChange}
                        />
                    </Field>

                    <Field
                        label={t(
                            'view.settings.discord_presence.discord_presence.instance_type_player_count'
                        )}
                    >
                        <Switch
                            checked={discordPrefs.discordInstance}
                            disabled={!discordPrefs.discordActive}
                            onCheckedChange={onDiscordInstanceChange}
                        />
                    </Field>

                    <Field
                        label={t(
                            'view.settings.discord_presence.discord_presence.show_current_platform'
                        )}
                    >
                        <Switch
                            checked={discordPrefs.discordShowPlatform}
                            disabled={
                                !discordPrefs.discordActive ||
                                !discordPrefs.discordInstance
                            }
                            onCheckedChange={onDiscordShowPlatformChange}
                        />
                    </Field>

                    <Field
                        label={t(
                            'view.settings.discord_presence.discord_presence.show_details_in_private'
                        )}
                    >
                        <Switch
                            checked={!discordPrefs.discordHideInvite}
                            disabled={!discordPrefs.discordActive}
                            onCheckedChange={onDiscordShowPrivateDetailsChange}
                        />
                    </Field>

                    <Field
                        label={t(
                            'view.settings.discord_presence.discord_presence.join_button'
                        )}
                    >
                        <Switch
                            checked={discordPrefs.discordJoinButton}
                            disabled={!discordPrefs.discordActive}
                            onCheckedChange={onDiscordJoinButtonChange}
                        />
                    </Field>

                    <Field
                        label={t(
                            'view.settings.discord_presence.discord_presence.show_images'
                        )}
                    >
                        <Switch
                            checked={!discordPrefs.discordHideImage}
                            disabled={!discordPrefs.discordActive}
                            onCheckedChange={onDiscordShowImagesChange}
                        />
                    </Field>

                    <Field
                        label={t(
                            'view.settings.discord_presence.discord_presence.display_world_name_as_discord_status'
                        )}
                    >
                        <Switch
                            checked={
                                discordPrefs.discordWorldNameAsDiscordStatus
                            }
                            disabled={!discordPrefs.discordActive}
                            onCheckedChange={onDiscordWorldNameAsStatusChange}
                        />
                    </Field>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {t(
                            'view.settings.advanced.advanced.translation_api.header'
                        )}
                    </CardTitle>
                    <CardDescription>
                        {t(
                            'view.settings.advanced.advanced.translation_api.enable_tooltip'
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.advanced.advanced.translation_api.enable'
                        )}
                        description={t(
                            'view.settings.advanced.advanced.translation_api.enable_tooltip'
                        )}
                    >
                        <Switch
                            checked={integrationPrefs.translationAPI}
                            onCheckedChange={onTranslationApiEnabledChange}
                        />
                    </Field>
                    <Field
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
                            {t(
                                'view.settings.advanced.advanced.translation_api.translation_api_key'
                            )}
                        </Button>
                    </Field>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {t(
                            'view.settings.advanced.advanced.youtube_api.header'
                        )}
                    </CardTitle>
                    <CardDescription>
                        {t(
                            'view.settings.advanced.advanced.youtube_api.enable_tooltip'
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.advanced.advanced.youtube_api.enable'
                        )}
                        description={t(
                            'view.settings.advanced.advanced.youtube_api.enable_tooltip'
                        )}
                    >
                        <Switch
                            checked={integrationPrefs.youtubeAPI}
                            onCheckedChange={onYoutubeApiEnabledChange}
                        />
                    </Field>
                    <Field
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
                            {t(
                                'view.settings.advanced.advanced.youtube_api.youtube_api_key'
                            )}
                        </Button>
                    </Field>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {t(
                            'view.settings.advanced.advanced.remote_database.header'
                        )}
                    </CardTitle>
                    <CardDescription>
                        {t(
                            'view.settings.advanced.advanced.remote_database.enable_description'
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.advanced.advanced.remote_database.enable'
                        )}
                        description={t(
                            'view.settings.advanced.advanced.remote_database.enable_description'
                        )}
                    >
                        <Switch
                            checked={avatarProviderConfig.enabled}
                            onCheckedChange={onAvatarProviderEnabledChange}
                        />
                    </Field>

                    <Field
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
                            {t(
                                'view.settings.advanced.advanced.remote_database.avatar_database_provider'
                            )}
                        </Button>
                    </Field>
                </CardContent>
            </Card>
        </SettingsTabContent>
    );
}
