import { CopyIcon, KeyRoundIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    commands,
    type ClientConfigSnippets,
    type McpServerStatus
} from '@/platform/tauri/bindings';
import { copyTextToClipboard } from '@/services/clipboardService';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';

import { Field, SettingsGroup } from '../SettingsField';

type McpCommandOptions = {
    successMessage?: string;
    toastError?: boolean;
};

type McpSnippetButton = {
    snippetKey: keyof ClientConfigSnippets;
    labelKey: string;
};

const MCP_SNIPPET_BUTTONS: McpSnippetButton[] = [
    {
        snippetKey: 'claudeCodeCommand',
        labelKey: 'view.settings.integrations.mcp_server.copy_claude_code'
    },
    {
        snippetKey: 'mcpRemoteJson',
        labelKey: 'view.settings.integrations.mcp_server.copy_mcp_remote'
    },
    {
        snippetKey: 'genericJson',
        labelKey: 'view.settings.integrations.mcp_server.copy_generic'
    }
];

export function McpServerSettingsGroup() {
    const { t } = useTranslation();
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
            .catch((error: unknown) => {
                if (!cancelled) {
                    setMcpError(String(error));
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

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
        } catch (error: unknown) {
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

    function setMcpAllowLanConnections(checked: boolean) {
        void runMcpCommand(
            () => commands.appMcpServerSetAllowLanConnections(checked),
            { toastError: true }
        );
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
        await copyTextToClipboard(value, {
            successMessage: t('view.settings.integrations.mcp_server.copied', {
                target: t(labelKey)
            }),
            errorMessage: (error) => String(error)
        });
    }

    return (
        <SettingsGroup
            title={t('view.settings.integrations.mcp_server.header')}
            description={t('view.settings.integrations.mcp_server.description')}
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
                    'view.settings.integrations.mcp_server.allow_lan_connections'
                )}
                description={t(
                    'view.settings.integrations.mcp_server.allow_lan_connections_description'
                )}
            >
                <Switch
                    checked={Boolean(mcpStatus?.allowLanConnections)}
                    disabled={mcpBusy}
                    onCheckedChange={setMcpAllowLanConnections}
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
                label={t('view.settings.integrations.mcp_server.port_label')}
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
                        onChange={(event) => setPortInput(event.target.value)}
                        className="w-28"
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={mcpBusy}
                        onClick={applyMcpPort}
                    >
                        {t('view.settings.integrations.mcp_server.port_apply')}
                    </Button>
                </div>
            </Field>

            <Field
                label={t('view.settings.integrations.mcp_server.status_label')}
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
                label={t('view.settings.integrations.mcp_server.client_config')}
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
                    {MCP_SNIPPET_BUTTONS.map(({ snippetKey, labelKey }) => (
                        <Button
                            key={snippetKey}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!mcpClientConfig}
                            onClick={() => copyMcpSnippet(snippetKey, labelKey)}
                        >
                            <CopyIcon data-icon="inline-start" />
                            {t(labelKey)}
                        </Button>
                    ))}
                </div>
            </Field>

            <Field
                label={t('view.settings.integrations.mcp_server.rotate_token')}
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
                    {t('view.settings.integrations.mcp_server.rotate_token')}
                </Button>
            </Field>
        </SettingsGroup>
    );
}
