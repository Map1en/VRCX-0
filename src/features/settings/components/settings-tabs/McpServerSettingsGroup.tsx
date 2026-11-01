import { CableIcon, KeyRoundIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HighlightedCodeBlock } from '@/components/HighlightedCodeBlock';
import {
    commands,
    type ClientConfigSnippets,
    type McpInstallClient,
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
import { Switch } from '@/ui/shadcn/switch';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/ui/shadcn/tabs';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

type McpCommandOptions = {
    successMessage?: string;
    toastError?: boolean;
};

type McpClientGuide = {
    id: string;
    label?: string;
    labelKey?: string;
    guideKey: string;
    install?: McpInstallClient;
    snippet?: {
        key: keyof ClientConfigSnippets;
        language: string;
    };
};

const MCP_CLIENT_GUIDES: McpClientGuide[] = [
    {
        id: 'claudeDesktop',
        label: 'Claude Desktop',
        guideKey: 'claude_desktop',
        snippet: { key: 'mcpRemoteJson', language: 'json' }
    },
    {
        id: 'claudeCode',
        label: 'Claude Code',
        guideKey: 'claude_code',
        snippet: { key: 'claudeCodeCommand', language: 'bash' }
    },
    {
        id: 'cherryStudio',
        label: 'Cherry Studio',
        guideKey: 'cherry_studio',
        install: 'cherryStudio'
    },
    {
        id: 'codex',
        label: 'Codex',
        guideKey: 'codex',
        snippet: { key: 'codexToml', language: 'toml' }
    },
    {
        id: 'opencode',
        label: 'opencode',
        guideKey: 'opencode',
        snippet: { key: 'opencodeJson', language: 'json' }
    },
    {
        id: 'cursor',
        label: 'Cursor',
        guideKey: 'cursor',
        install: 'cursor',
        snippet: { key: 'genericJson', language: 'json' }
    },
    {
        id: 'vsCode',
        label: 'VS Code',
        guideKey: 'vscode',
        install: 'vsCode'
    },
    {
        id: 'lmStudio',
        label: 'LM Studio',
        guideKey: 'lm_studio',
        install: 'lmStudio',
        snippet: { key: 'genericJson', language: 'json' }
    },
    {
        id: 'other',
        labelKey: 'view.settings.integrations.mcp_server.client_other',
        guideKey: 'other',
        snippet: { key: 'genericJson', language: 'json' }
    }
];

function openMcpClientInstall(client: McpInstallClient) {
    commands.appMcpServerOpenClientInstall(client).catch((error: unknown) => {
        toast.add({ type: 'error', title: String(error) });
    });
}

function McpConnectDialog({
    open,
    onOpenChange,
    snippets,
    allowLanConnections
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    snippets: ClientConfigSnippets;
    allowLanConnections: boolean;
}) {
    const { t } = useTranslation();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            'view.settings.integrations.mcp_server.connect_client'
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'view.settings.integrations.mcp_server.connect_dialog_description'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <Tabs
                    orientation="vertical"
                    defaultValue={MCP_CLIENT_GUIDES[0].id}
                    className="items-start gap-4"
                >
                    <TabsList className="w-40 shrink-0">
                        {MCP_CLIENT_GUIDES.map((guide) => (
                            <TabsTab key={guide.id} value={guide.id}>
                                {guide.label ??
                                    (guide.labelKey ? t(guide.labelKey) : '')}
                            </TabsTab>
                        ))}
                    </TabsList>
                    {MCP_CLIENT_GUIDES.map(({ install, ...guide }) => (
                        <TabsPanel
                            key={guide.id}
                            value={guide.id}
                            className="flex min-w-0 flex-1 flex-col gap-3"
                        >
                            <p className="text-muted-foreground text-sm">
                                {t(
                                    `view.settings.integrations.mcp_server.guide.${guide.guideKey}`
                                )}
                            </p>
                            {install ? (
                                <div className="flex flex-col items-start gap-1">
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() =>
                                            openMcpClientInstall(install)
                                        }
                                    >
                                        {t(
                                            'view.settings.integrations.mcp_server.install_in_client',
                                            { client: guide.label }
                                        )}
                                    </Button>
                                    <span className="text-muted-foreground text-xs">
                                        {t(
                                            'view.settings.integrations.mcp_server.install_requires_client'
                                        )}
                                    </span>
                                </div>
                            ) : null}
                            {guide.snippet ? (
                                <HighlightedCodeBlock
                                    code={snippets[guide.snippet.key]}
                                    language={guide.snippet.language}
                                    size="sm"
                                    wrap
                                    contentClassName="max-h-[50vh]"
                                />
                            ) : null}
                            {allowLanConnections && guide.snippet ? (
                                <p className="text-muted-foreground text-xs">
                                    {t(
                                        'view.settings.integrations.mcp_server.lan_placeholder_note'
                                    )}
                                </p>
                            ) : null}
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
    const [connectOpen, setConnectOpen] = useState(false);
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
                settingId="ai.mcp.connect"
                label={t(
                    'view.settings.integrations.mcp_server.connect_client'
                )}
                description={t(
                    'view.settings.integrations.mcp_server.connect_client_description'
                )}
                disabled={!mcpClientConfig}
            >
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!mcpClientConfig}
                    onClick={() => setConnectOpen(true)}
                >
                    <CableIcon data-icon="inline-start" />
                    {t(
                        'view.settings.integrations.mcp_server.connect_client_action'
                    )}
                </Button>
                {mcpClientConfig ? (
                    <McpConnectDialog
                        open={connectOpen}
                        onOpenChange={setConnectOpen}
                        snippets={mcpClientConfig}
                        allowLanConnections={
                            mcpStatus?.allowLanConnections ?? false
                        }
                    />
                ) : null}
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
                    <Input
                        value={portInput}
                        inputMode="numeric"
                        maxLength={5}
                        disabled={mcpBusy}
                        onChange={(event) =>
                            setPortInput(event.target.value.replace(/\D/g, ''))
                        }
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                applyMcpPort();
                            }
                        }}
                        className="w-24 font-mono"
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
                settingId="ai.mcp.token"
                label={t('view.settings.integrations.mcp_server.token_label')}
                description={t(
                    'view.settings.integrations.mcp_server.security_note'
                )}
                disabled={!mcpStatus?.token}
                className="lg:grid-cols-1 lg:items-start"
                controlClassName="lg:justify-start"
            >
                <Input
                    value={mcpStatus?.token ?? ''}
                    readOnly
                    className="font-mono"
                />
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
