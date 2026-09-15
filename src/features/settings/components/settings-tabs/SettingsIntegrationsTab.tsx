import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import {
    commands,
    type NotificationWebhookFormat,
    type WebhookDeliverySnapshot
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Switch } from '@/ui/shadcn/switch';

import { useSettingsPageSection } from '../../SettingsPageStateContext';
import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';
import { IntegrationApiSettingsGroup } from './IntegrationApiSettingsGroup';
import { McpServerSettingsGroup } from './McpServerSettingsGroup';
import { WebhookSettingsGroup } from './WebhookSettingsGroup';

export function SettingsIntegrationsTab() {
    const integrations = useSettingsPageSection('integrations');
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            webhookEnabled: state.webhookEnabled,
            webhookAuthEventsEnabled: state.webhookAuthEventsEnabled,
            webhookUrl: state.webhookUrl,
            webhookFormat: state.webhookFormat,
            webhookFields: state.webhookFields
        }))
    );
    const {
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
    const [webhookDeliverySnapshot, setWebhookDeliverySnapshot] =
        useState<WebhookDeliverySnapshot | null>(null);
    const [webhookDeliveryLoading, setWebhookDeliveryLoading] = useState(true);
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );

    const refreshWebhookDeliveryStatus = useCallback(
        async (showError: boolean) => {
            setWebhookDeliveryLoading(true);
            try {
                setWebhookDeliverySnapshot(
                    await commands.appWebhookDeliverySnapshotGet()
                );
            } catch (error: unknown) {
                if (showError) {
                    toast.add({
                        type: 'error',
                        title:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    });
                }
            } finally {
                setWebhookDeliveryLoading(false);
            }
        },
        []
    );

    useEffect(() => {
        void refreshWebhookDeliveryStatus(false);
    }, [refreshWebhookDeliveryStatus]);

    function openVrchatConfig() {
        setSystemHostOpen('vrchatConfigOpen', true);
    }

    function saveWebhookEnabled(checked: boolean) {
        saveBoolPreference('webhookEnabled', 'webhookEnabled', checked);
    }

    function saveWebhookAuthEventsEnabled(checked: boolean) {
        saveBoolPreference(
            'webhookAuthEventsEnabled',
            'webhookAuthEventsEnabled',
            checked
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

    function saveWebhookFormat(value: NotificationWebhookFormat) {
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
            .then((outcome) => {
                toast.add({
                    type: 'success',
                    title: t(
                        'view.settings.notifications.notifications.webhook.test_sent',
                        { status: outcome.status }
                    )
                });
            })
            .catch((error: unknown) => {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error ? error.message : String(error)
                });
            });
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
                    label={t(
                        'view.settings.discord_presence.discord_presence.enable'
                    )}
                    description={
                        <Button
                            type="button"
                            variant="link"
                            className="text-muted-foreground hover:text-primary h-auto justify-start p-0 text-left text-xs font-normal hover:bg-transparent"
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
                    description={t(
                        'view.settings.discord_presence.discord_presence.join_button_description'
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
            </SettingsCard>

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
                deliverySnapshot={webhookDeliverySnapshot}
                deliveryStatusLoading={webhookDeliveryLoading}
                onRefreshDeliveryStatus={() => {
                    void refreshWebhookDeliveryStatus(true);
                }}
            />

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

            <McpServerSettingsGroup />
            <IntegrationApiSettingsGroup />
        </SettingsTabContent>
    );
}
