import { FileCodeIcon, KeyRoundIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HighlightedCodeBlock } from '@/components/HighlightedCodeBlock';
import {
    commands,
    type ClientConfigSnippets,
    type McpServerStatus
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
} from '@/ui/shadcn/number-field';
import { Switch } from '@/ui/shadcn/switch';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/ui/shadcn/tabs';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

type McpCommandOptions = {
    successMessage?: string;
    toastError?: boolean;
};

type McpSnippetTab = {
    snippetKey: keyof ClientConfigSnippets;
    language: string;
    label?: string;
    labelKey?: string;
};

const MCP_SNIPPET_TABS: McpSnippetTab[] = [
    {
        snippetKey: 'claudeCodeCommand',
        language: 'bash',
        label: 'Claude Code'
    },
    {
        snippetKey: 'mcpRemoteJson',
        language: 'json',
        labelKey: 'view.settings.integrations.mcp_server.copy_mcp_remote'
    },
    {
        snippetKey: 'genericJson',
        language: 'json',
        labelKey: 'view.settings.integrations.mcp_server.copy_generic'
    }
];

function McpClientConfigDialog({
    open,
    onOpenChange,
    snippets
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    snippets: ClientConfigSnippets;
}) {
    const { t } = useTranslation();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            'view.settings.integrations.mcp_server.client_config'
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'view.settings.integrations.mcp_server.client_config_description'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <Tabs defaultValue={MCP_SNIPPET_TABS[0].snippetKey}>
                    <TabsList>
                        {MCP_SNIPPET_TABS.map((tab) => (
                            <TabsTab
                                key={tab.snippetKey}
                                value={tab.snippetKey}
                            >
                                {tab.label ||
                                    (tab.labelKey ? t(tab.labelKey) : '')}
                            </TabsTab>
                        ))}
                    </TabsList>
                    {MCP_SNIPPET_TABS.map((tab) => (
                        <TabsPanel key={tab.snippetKey} value={tab.snippetKey}>
                            <HighlightedCodeBlock
                                code={snippets[tab.snippetKey]}
                                language={tab.language}
                                size="sm"
                                wrap
                                contentClassName="max-h-[50vh]"
                            />
                        </TabsPanel>
                    ))}
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

export function McpServerSettingsGroup() {
    const { t } = useTranslation();
    const [mcpStatus, setMcpStatus] = useState<McpServerStatus | null>(null);
    const [mcpBusy, setMcpBusy] = useState(false);
    const [mcpError, setMcpError] = useState<string | null>(null);
    const [portInput, setPortInput] = useState('');
    const [clientConfigOpen, setClientConfigOpen] = useState(false);
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
                toast.add({ type: 'success', title: options.successMessage });
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
                toast.add({ type: 'error', title: message });
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
            toast.add({
                type: 'error',
                title: t('view.settings.integrations.mcp_server.port_invalid')
            });
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

    return (
        <SettingsCard
            cardId="ai.mcp"
            title={t('view.settings.integrations.mcp_server.header')}
            description={t('view.settings.integrations.mcp_server.description')}
        >
            <Field
                settingId="ai.mcp.enabled"
                label={t('view.settings.integrations.mcp_server.enable')}
                description={t(
                    'view.settings.integrations.mcp_server.enable_description'
                )}
            >
                <Switch
                    checked={mcpStatus?.enabled ?? false}
                    disabled={mcpBusy}
                    onCheckedChange={setMcpEnabled}
                />
            </Field>

            <Field
                settingId="ai.mcp.allow-lan"
                label={t(
                    'view.settings.integrations.mcp_server.allow_lan_connections'
                )}
                description={t(
                    'view.settings.integrations.mcp_server.allow_lan_connections_description'
                )}
            >
                <Switch
                    checked={mcpStatus?.allowLanConnections ?? false}
                    disabled={mcpBusy}
                    onCheckedChange={setMcpAllowLanConnections}
                />
            </Field>

            <Field
                settingId="ai.mcp.allow-vrchat-writes"
                label={t(
                    'view.settings.integrations.mcp_server.allow_vrchat_writes'
                )}
                description={t(
                    'view.settings.integrations.mcp_server.allow_vrchat_writes_description'
                )}
            >
                <Switch
                    checked={mcpStatus?.allowVrchatWrites ?? false}
                    disabled={mcpBusy || !mcpStatus?.enabled}
                    onCheckedChange={setMcpAllowVrchatWrites}
                />
            </Field>

            <Field
                settingId="ai.mcp.port"
                label={t('view.settings.integrations.mcp_server.port_label')}
                description={t(
                    'view.settings.integrations.mcp_server.port_description'
                )}
            >
                <div className="flex items-center gap-2">
                    <NumberField
                        min={1024}
                        max={65535}
                        allowOutOfRange
                        value={portInput === '' ? null : Number(portInput)}
                        disabled={mcpBusy}
                        onValueChange={(value) =>
                            setPortInput(value === null ? '' : String(value))
                        }
                        className="w-40"
                    >
                        <NumberFieldGroup>
                            <NumberFieldDecrement />
                            <NumberFieldInput />
                            <NumberFieldIncrement />
                        </NumberFieldGroup>
                    </NumberField>
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
                settingId="ai.mcp.status"
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
                settingId="ai.mcp.client-config"
                label={t('view.settings.integrations.mcp_server.client_config')}
                description={t(
                    'view.settings.integrations.mcp_server.security_note'
                )}
                disabled={!mcpStatus?.token && !mcpClientConfig}
                className="lg:grid-cols-1 lg:items-start"
                controlClassName="lg:justify-start"
            >
                <div className="flex w-full gap-2">
                    <Input
                        value={mcpStatus?.token ?? ''}
                        readOnly
                        className="font-mono"
                    />
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!mcpClientConfig}
                        onClick={() => setClientConfigOpen(true)}
                    >
                        <FileCodeIcon data-icon="inline-start" />
                        {t(
                            'view.settings.integrations.mcp_server.view_client_config'
                        )}
                    </Button>
                </div>
                {mcpClientConfig ? (
                    <McpClientConfigDialog
                        open={clientConfigOpen}
                        onOpenChange={setClientConfigOpen}
                        snippets={mcpClientConfig}
                    />
                ) : null}
            </Field>

            <Field
                settingId="ai.mcp.rotate-token"
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
        </SettingsCard>
    );
}
