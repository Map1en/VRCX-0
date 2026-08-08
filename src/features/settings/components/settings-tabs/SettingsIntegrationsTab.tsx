import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { commands } from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Switch } from '@/ui/shadcn/switch';

import type { SettingsPageStateSections } from '../../settingsPageStateSections';
import { normalizeCheckedState } from '../../settingsValues';
import { Field, SettingsGroup } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';
import { WebhookSettingsGroup } from './WebhookSettingsGroup';

type SettingsIntegrationsTabProps = {
    integrations: SettingsPageStateSections['integrations'];
};

export function SettingsIntegrationsTab({
    integrations
}: SettingsIntegrationsTabProps) {
    const {
        prefs,
        discordPrefs,
        integrationPrefs,
        avatarProviderConfig,
        setPrefs,
        setWebhookNotificationsDialogOpen,
        saveStringPreference,
        saveBoolPreference,
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

    function saveWebhookEnabled(checked: boolean) {
        saveBoolPreference(
            'webhookEnabled',
            'webhookEnabled',
            normalizeCheckedState(checked)
        );
    }

    function saveWebhookAuthEventsEnabled(checked: boolean) {
        saveBoolPreference(
            'webhookAuthEventsEnabled',
            'webhookAuthEventsEnabled',
            normalizeCheckedState(checked)
        );
    }

    function setWebhookUrlDraft(value: string) {
        setPrefs((current) => ({
            ...current,
            webhookUrl: String(value ?? '')
        }));
    }

    function saveWebhookUrl(value: string) {
        saveStringPreference('webhookUrl', 'webhookUrl', value);
    }

    function saveWebhookFormat(value: string) {
        saveStringPreference('webhookFormat', 'webhookFormat', value);
    }

    function saveWebhookFields(value: string) {
        saveStringPreference('webhookFields', 'webhookFields', value);
    }

    function openWebhookNotificationFilters() {
        setWebhookNotificationsDialogOpen(true);
    }

    function sendTestWebhook() {
        const webhookFormat =
            prefs.webhookFormat === 'discord' ? 'discord' : 'generic';
        commands
            .appWebhookSendTest(
                String(prefs.webhookUrl || ''),
                webhookFormat,
                String(prefs.webhookFields || '')
            )
            .then((status) => {
                toast.success(
                    t(
                        'view.settings.notifications.notifications.webhook.test_sent',
                        { status }
                    )
                );
            })
            .catch((error: unknown) => {
                toast.error(
                    error instanceof Error ? error.message : String(error)
                );
            });
    }

    return (
        <SettingsTabContent value="integrations">
            <SettingsGroup
                title={t(
                    'view.settings.discord_presence.discord_presence.header'
                )}
                description={
                    <div className="flex flex-col gap-2">
                        <div>
                            {t(
                                'view.settings.discord_presence.discord_presence.description'
                            )}
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            className="text-muted-foreground hover:text-primary h-auto justify-start p-0 text-left text-xs font-normal"
                            onClick={openVrchatConfig}
                        >
                            {t(
                                'view.settings.discord_presence.discord_presence.enable_tooltip'
                            )}
                        </Button>
                    </div>
                }
            >
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
                        checked={discordPrefs.discordWorldNameAsDiscordStatus}
                        disabled={!discordPrefs.discordActive}
                        onCheckedChange={onDiscordWorldNameAsStatusChange}
                    />
                </Field>
            </SettingsGroup>

            <WebhookSettingsGroup
                prefs={prefs}
                onWebhookEnabledChange={saveWebhookEnabled}
                onWebhookAuthEventsEnabledChange={saveWebhookAuthEventsEnabled}
                onWebhookUrlDraftChange={setWebhookUrlDraft}
                onWebhookUrlBlur={saveWebhookUrl}
                onWebhookFormatChange={saveWebhookFormat}
                onWebhookFieldsChange={saveWebhookFields}
                onOpenWebhookNotificationFiltersDialog={
                    openWebhookNotificationFilters
                }
                onTestWebhook={sendTestWebhook}
            />

            <SettingsGroup
                title={t(
                    'view.settings.advanced.advanced.translation_api.header'
                )}
                description={t(
                    'view.settings.advanced.advanced.translation_api.enable_tooltip'
                )}
            >
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
            </SettingsGroup>

            <SettingsGroup
                title={t('view.settings.advanced.advanced.youtube_api.header')}
                description={t(
                    'view.settings.advanced.advanced.youtube_api.enable_tooltip'
                )}
            >
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
            </SettingsGroup>

            <SettingsGroup
                title={t(
                    'view.settings.advanced.advanced.remote_database.header'
                )}
                description={t(
                    'view.settings.advanced.advanced.remote_database.enable_description'
                )}
            >
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
            </SettingsGroup>
        </SettingsTabContent>
    );
}
