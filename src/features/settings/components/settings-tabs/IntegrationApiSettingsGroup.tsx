import {
    CopyIcon,
    KeyRoundIcon,
    RefreshCwIcon,
    UsersRoundIcon
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { commands, type IntegrationApiStatus } from '@/platform/tauri/bindings';
import { PlatformCommandError } from '@/platform/tauri/errors';
import { copyTextToClipboard } from '@/services/clipboardService';
import { subscribeIntegrationApiStatusRefresh } from '@/services/integrationApiService';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
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

import { Field, SettingsGroup } from '../SettingsField';

function IntegrationApiInformationTypesDialog({
    id,
    'aria-invalid': ariaInvalid
}: {
    id?: string;
    'aria-invalid'?: boolean;
}) {
    const { t } = useTranslation();

    return (
        <Dialog>
            <DialogTrigger
                render={
                    <Button
                        id={id}
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-invalid={ariaInvalid}
                    >
                        {t('common.actions.configure')}
                    </Button>
                }
            />
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            'view.settings.integrations.integration_api.information_types'
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'view.settings.integrations.integration_api.information_types_description'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <div className="border-primary/20 bg-primary/[0.04] flex items-start gap-3 rounded-lg border p-3">
                    <Checkbox
                        checked
                        disabled
                        aria-label={t(
                            'view.settings.integrations.integration_api.room_information'
                        )}
                        className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <UsersRoundIcon className="text-primary size-4" />
                            <span className="text-sm font-medium">
                                {t(
                                    'view.settings.integrations.integration_api.room_information'
                                )}
                            </span>
                            <Badge variant="secondary">
                                {t(
                                    'view.settings.integrations.integration_api.information_type_fixed'
                                )}
                            </Badge>
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                            {t(
                                'view.settings.integrations.integration_api.room_information_description'
                            )}
                        </p>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export function IntegrationApiSettingsGroup() {
    const { t } = useTranslation();
    const [status, setStatus] = useState<IntegrationApiStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [portInput, setPortInput] = useState('8799');
    const statusLabel = t(
        `view.settings.integrations.integration_api.status.${status?.state ?? 'loading'}`
    );

    const applyStatus = useCallback((next: IntegrationApiStatus) => {
        setStatus(next);
        setPortInput(String(next.port));
        setError(next.lastError?.message ?? null);
    }, []);

    const refreshStatus = useCallback(async () => {
        applyStatus(await commands.appIntegrationApiStatus());
    }, [applyStatus]);

    useEffect(() => {
        let active = true;
        commands
            .appIntegrationApiStatus()
            .then((next) => {
                if (active) {
                    applyStatus(next);
                }
            })
            .catch((caught: unknown) => {
                if (active) {
                    setError(errorMessage(caught));
                }
            });
        return () => {
            active = false;
        };
    }, [applyStatus]);

    useEffect(
        () =>
            subscribeIntegrationApiStatusRefresh(() => {
                void refreshStatus().catch((caught: unknown) => {
                    setError(errorMessage(caught));
                });
            }),
        [refreshStatus]
    );

    async function runCommand(
        action: () => Promise<IntegrationApiStatus>
    ): Promise<boolean> {
        setBusy(true);
        try {
            applyStatus(await action());
            return true;
        } catch (caught: unknown) {
            const message = localizedError(caught);
            try {
                await refreshStatus();
            } catch {}
            setError(message);
            toast.error(message);
            return false;
        } finally {
            setBusy(false);
        }
    }

    function localizedError(caught: unknown): string {
        if (caught instanceof PlatformCommandError) {
            if (caught.code === 'integration_api_port_in_use' && caught.port) {
                return t(
                    'view.settings.integrations.integration_api.port_in_use',
                    {
                        port: caught.port
                    }
                );
            }
            if (caught.code === 'integration_api_bind' && caught.port) {
                return t(
                    'view.settings.integrations.integration_api.bind_failed',
                    {
                        port: caught.port
                    }
                );
            }
        }
        return errorMessage(caught);
    }

    function applyPort() {
        const port = Number(portInput);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
            toast.error(
                t('view.settings.integrations.integration_api.port_invalid')
            );
            return;
        }
        void runCommand(() => commands.appIntegrationApiSetPort(port)).then(
            (succeeded) => {
                if (!succeeded) {
                    setPortInput(String(port));
                }
            }
        );
    }

    async function copyToken() {
        if (!status?.token) {
            return;
        }
        await copyTextToClipboard(status.token, {
            successMessage: t(
                'view.settings.integrations.integration_api.token_copied'
            ),
            errorMessage: errorMessage
        });
    }

    return (
        <SettingsGroup
            title={t('view.settings.integrations.integration_api.header')}
            description={t(
                'view.settings.integrations.integration_api.description'
            )}
            action={
                <Badge
                    variant="outline"
                    className={cn(
                        'mt-0.5 gap-1.5',
                        status?.state === 'error' && 'text-destructive'
                    )}
                >
                    <span
                        aria-hidden="true"
                        className={cn(
                            'bg-muted-foreground/40 size-1.5 rounded-full',
                            status?.state === 'running' && 'bg-emerald-500',
                            status?.state === 'error' && 'bg-destructive'
                        )}
                    />
                    {statusLabel}
                </Badge>
            }
        >
            <Field
                label={t('view.settings.integrations.integration_api.enable')}
                description={t(
                    'view.settings.integrations.integration_api.enable_description'
                )}
            >
                <Switch
                    checked={status?.enabled === true}
                    disabled={busy}
                    onCheckedChange={(enabled) => {
                        void runCommand(() =>
                            commands.appIntegrationApiSetEnabled(enabled)
                        );
                    }}
                />
            </Field>

            <Field
                label={t(
                    'view.settings.integrations.integration_api.information_types'
                )}
                description={t(
                    'view.settings.integrations.integration_api.information_types_description'
                )}
            >
                <IntegrationApiInformationTypesDialog />
            </Field>

            <Field
                label={t(
                    'view.settings.integrations.integration_api.allow_lan_connections'
                )}
                description={t(
                    'view.settings.integrations.integration_api.allow_lan_connections_description'
                )}
            >
                <Switch
                    checked={status?.allowLanConnections === true}
                    disabled={busy}
                    onCheckedChange={(enabled) => {
                        void runCommand(() =>
                            commands.appIntegrationApiSetAllowLanConnections(
                                enabled
                            )
                        );
                    }}
                />
            </Field>

            <Field
                label={t(
                    'view.settings.integrations.integration_api.port_label'
                )}
                description={t(
                    'view.settings.integrations.integration_api.port_description'
                )}
                error={error ?? undefined}
            >
                <div className="flex items-center gap-2">
                    <NumberField
                        min={1024}
                        max={65535}
                        allowOutOfRange
                        value={portInput === '' ? null : Number(portInput)}
                        disabled={busy}
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
                        disabled={busy}
                        onClick={applyPort}
                    >
                        {t(
                            'view.settings.integrations.integration_api.port_apply'
                        )}
                    </Button>
                </div>
            </Field>

            <Field
                label={t(
                    'view.settings.integrations.integration_api.status_label'
                )}
                description={t(
                    'view.settings.integrations.integration_api.port_active_connections',
                    {
                        port: status?.port ?? 8799,
                        count: status?.activeConnections ?? 0
                    }
                )}
            >
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="text-muted-foreground text-sm">
                        {statusLabel}
                    </span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                            void runCommand(commands.appIntegrationApiStatus);
                        }}
                    >
                        <RefreshCwIcon data-icon="inline-start" />
                        {t('common.actions.refresh')}
                    </Button>
                </div>
            </Field>

            <Field
                label={t('view.settings.integrations.integration_api.token')}
                description={t(
                    'view.settings.integrations.integration_api.token_description'
                )}
            >
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <Input
                        value={status?.token ?? ''}
                        readOnly
                        className="w-64 font-mono"
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || !status?.token}
                        onClick={() => void copyToken()}
                    >
                        <CopyIcon data-icon="inline-start" />
                        {t('common.actions.copy')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                            void runCommand(
                                commands.appIntegrationApiRotateToken
                            ).then((succeeded) => {
                                if (succeeded) {
                                    toast.success(
                                        t(
                                            'view.settings.integrations.integration_api.token_rotated'
                                        )
                                    );
                                }
                            });
                        }}
                    >
                        <KeyRoundIcon data-icon="inline-start" />
                        {t(
                            'view.settings.integrations.integration_api.rotate_token'
                        )}
                    </Button>
                </div>
            </Field>
        </SettingsGroup>
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
