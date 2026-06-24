import { CopyIcon, KeyRoundIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    commands,
    type ClientConfigSnippets,
    type McpServerStatus
} from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';

import { normalizeCheckedState } from '../../settingsValues';
import { Field, SettingsGroup } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';
import { AssistantSettingsGroup } from './AssistantSettingsGroup';
import { WebhookSettingsGroup } from './WebhookSettingsGroup';

type McpCommandOptions = {
    successMessage?: string;
    toastError?: boolean;
};

export function SettingsIntegrationsTab({ integrations }: any) {
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
    const [mcpStatus, setMcpStatus] = useState<McpServerStatus | null>(null);
    const [mcpBusy, setMcpBusy] = useState(false);
    const [mcpError, setMcpError] = useState<string | null>(null);
    const [portInput, setPortInput] = useState('');
    const mcpClientConfig = mcpStatus?.clientConfig;
    const mcpStatusLabel = mcpStatus
        ? t(`view.settings.integrations.mcp_server.status.${mcpStatus.state}`)
        : t('view.settings.integrations.mcp_server.status.loading');

    function applyMcpStatus(status: McpServerStatus) {
        setMcpStatus(status);
        setMcpError(status.lastError);
        if (status.port != null) {
            setPortInput(String(status.port));
        }
    }

    useEffect(() => {
        let cancelled = false;
        commands
            .appMcpServerStatus()
            .then((status) => {
                if (!cancelled) {
                    applyMcpStatus(status);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setMcpError(String(error));
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    function openVrchatConfig() {
        setSystemHostOpen('vrchatConfigOpen', true);
    }

    async function runMcpCommand(
        action: () => Promise<McpServerStatus>,
        options: McpCommandOptions = {}
    ) {
        setMcpBusy(true);
        try {
            applyMcpStatus(await action());
            if (options.successMessage) {
                toast.success(options.successMessage);
            }
        } catch (error) {
            const message = String(error);
            try {
                const status = await commands.appMcpServerStatus();
                applyMcpStatus({
                    ...status,
                    lastError: status.lastError ?? message
                });
            } catch {
                setMcpError(message);
            }
            if (options.toastError) {
                toast.error(message);
            }
        } finally {
            setMcpBusy(false);
        }
    }

    function refreshMcpStatus() {
        void runMcpCommand(commands.appMcpServerStatus);
    }

    function setMcpEnabled(checked: boolean) {
        void runMcpCommand(() => commands.appMcpServerSetEnabled(checked), {
            toastError: true
        });
    }

    function setMcpAllowVrchatWrites(checked: boolean) {
        void runMcpCommand(
            () => commands.appMcpServerSetAllowVrchatWrites(checked),
            { toastError: true }
        );
    }

    function applyMcpPort() {
        const port = Number(portInput);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
            toast.error(
                t('view.settings.integrations.mcp_server.port_invalid')
            );
            return;
        }
        void runMcpCommand(() => commands.appMcpServerSetPort(port), {
            toastError: true
        });
    }

    function rotateMcpToken() {
        void runMcpCommand(commands.appMcpServerRotateToken, {
            successMessage: t(
                'view.settings.integrations.mcp_server.token_rotated'
            ),
            toastError: true
        });
    }

    async function copyMcpSnippet(
        key: keyof ClientConfigSnippets,
        labelKey: string
    ) {
        const value = mcpClientConfig?.[key];
        if (!value) {
            return;
        }
        try {
            await navigator.clipboard.writeText(value);
            toast.success(
                t('view.settings.integrations.mcp_server.copied', {
                    target: t(labelKey)
                })
            );
        } catch (error) {
            toast.error(String(error));
        }
    }

    function saveWebhookEnabled(checked: boolean) {
        saveBoolPreference(
            'webhookEnabled',
            'webhookEnabled',
            normalizeCheckedState(checked)
        );
    }

    function setWebhookUrlDraft(value: string) {
        setPrefs((current: any) => ({
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
        commands
            .appWebhookSendTest(
                String(prefs.webhookUrl || ''),
                String(prefs.webhookFormat || 'generic'),
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

            <AssistantSettingsGroup />

            <WebhookSettingsGroup
                prefs={prefs}
                onWebhookEnabledChange={saveWebhookEnabled}
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
                title={t('view.settings.integrations.mcp_server.header')}
                description={t(
                    'view.settings.integrations.mcp_server.description'
                )}
            >
                <Field
                    label={t('view.settings.integrations.mcp_server.enable')}
                    description={t(
                        'view.settings.integrations.mcp_server.enable_description'
                    )}
                >
                    <Switch
                        checked={Boolean(mcpStatus?.enabled)}
                        disabled={mcpBusy}
                        onCheckedChange={setMcpEnabled}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.integrations.mcp_server.allow_vrchat_writes'
                    )}
                    description={t(
                        'view.settings.integrations.mcp_server.allow_vrchat_writes_description'
                    )}
                >
                    <Switch
                        checked={Boolean(mcpStatus?.allowVrchatWrites)}
                        disabled={mcpBusy || !mcpStatus?.enabled}
                        onCheckedChange={setMcpAllowVrchatWrites}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.integrations.mcp_server.port_label'
                    )}
                    description={t(
                        'view.settings.integrations.mcp_server.port_description'
                    )}
                >
                    <div className="flex items-center gap-2">
                        <Input
                            type="number"
                            min={1024}
                            max={65535}
                            value={portInput}
                            disabled={mcpBusy}
                            onChange={(event) =>
                                setPortInput(event.target.value)
                            }
                            className="w-28"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={mcpBusy}
                            onClick={applyMcpPort}
                        >
                            {t(
                                'view.settings.integrations.mcp_server.port_apply'
                            )}
                        </Button>
                    </div>
                </Field>

                <Field
                    label={t(
                        'view.settings.integrations.mcp_server.status_label'
                    )}
                    description={
                        mcpStatus?.port
                            ? t(
                                  'view.settings.integrations.mcp_server.port_active_connections',
                                  {
                                      port: mcpStatus.port,
                                      count: mcpStatus.activeConnections
                                  }
                              )
                            : undefined
                    }
                    error={mcpError || undefined}
                >
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="text-muted-foreground text-sm">
                            {mcpStatusLabel}
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={mcpBusy}
                            onClick={refreshMcpStatus}
                        >
                            <RefreshCwIcon data-icon="inline-start" />
                            {t('common.actions.refresh')}
                        </Button>
                    </div>
                </Field>

                <Field
                    label={t(
                        'view.settings.integrations.mcp_server.client_config'
                    )}
                    description={
                        <>
                            {t(
                                'view.settings.integrations.mcp_server.client_config_description'
                            )}{' '}
                            {t(
                                'view.settings.integrations.mcp_server.security_note'
                            )}
                        </>
                    }
                    disabled={!mcpClientConfig}
                    className="lg:grid-cols-1 lg:items-start"
                    controlClassName="lg:justify-start"
                >
                    <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!mcpClientConfig}
                            onClick={() =>
                                copyMcpSnippet(
                                    'claudeCodeCommand',
                                    'view.settings.integrations.mcp_server.copy_claude_code'
                                )
                            }
                        >
                            <CopyIcon data-icon="inline-start" />
                            {t(
                                'view.settings.integrations.mcp_server.copy_claude_code'
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!mcpClientConfig}
                            onClick={() =>
                                copyMcpSnippet(
                                    'mcpRemoteJson',
                                    'view.settings.integrations.mcp_server.copy_mcp_remote'
                                )
                            }
                        >
                            <CopyIcon data-icon="inline-start" />
                            {t(
                                'view.settings.integrations.mcp_server.copy_mcp_remote'
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!mcpClientConfig}
                            onClick={() =>
                                copyMcpSnippet(
                                    'genericJson',
                                    'view.settings.integrations.mcp_server.copy_generic'
                                )
                            }
                        >
                            <CopyIcon data-icon="inline-start" />
                            {t(
                                'view.settings.integrations.mcp_server.copy_generic'
                            )}
                        </Button>
                    </div>
                </Field>

                <Field
                    label={t(
                        'view.settings.integrations.mcp_server.rotate_token'
                    )}
                    description={t(
                        'view.settings.integrations.mcp_server.rotate_token_description'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={mcpBusy}
                        onClick={rotateMcpToken}
                    >
                        <KeyRoundIcon data-icon="inline-start" />
                        {t(
                            'view.settings.integrations.mcp_server.rotate_token'
                        )}
                    </Button>
                </Field>
            </SettingsGroup>

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
