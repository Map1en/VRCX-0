import { NetworkIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ProxySettingsEditor } from '@/components/proxy/ProxySettingsEditor';
import { cn } from '@/lib/utils';
import {
    proxySettingsErrorMessage,
    saveProxySettingsPreferences,
    testProxySettings
} from '@/services/proxySettingsService';
import { toast } from '@/services/toastService';
import { usePreferencesStore } from '@/state/preferencesStore';
import { markRestartPending } from '@/state/restartPendingStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle
} from '@/ui/shadcn/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { resolveProxyIndicatorState } from './statusBarProxy';

export function ProxySegment({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation();
    const anchorRef = useRef<HTMLSpanElement>(null);
    const proxyEnabled = usePreferencesStore((state) => state.proxyEnabled);
    const proxyServer = usePreferencesStore((state) => state.proxyServer);
    const vrcStatusHasError = useRuntimeStore((state) =>
        Boolean(state.vrcStatus.error)
    );
    const [draftEnabled, setDraftEnabled] = useState(proxyEnabled);
    const [draftServer, setDraftServer] = useState(proxyServer);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        if (!open) {
            setDraftEnabled(proxyEnabled);
            setDraftServer(proxyServer);
        }
    }, [open, proxyEnabled, proxyServer]);

    if (!proxyEnabled) {
        return null;
    }

    const indicator = resolveProxyIndicatorState({
        enabled: proxyEnabled,
        server: proxyServer,
        hasNetworkIssue: vrcStatusHasError
    });

    async function save(restart: boolean) {
        setSaving(true);
        try {
            await saveProxySettingsPreferences(
                {
                    enabled: draftEnabled,
                    server: draftServer
                },
                { restart }
            );
            if (!restart) {
                markRestartPending();
                toast.add({
                    type: 'success',
                    title: t('prompt.proxy_settings.saved_restart_required')
                });
                onOpenChange(false);
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    proxySettingsErrorMessage(error) ||
                    t(
                        'component.app_status_bar.toast.failed_to_update_proxy_settings'
                    )
            });
        } finally {
            setSaving(false);
        }
    }

    async function test() {
        setTesting(true);
        try {
            const result = await testProxySettings(draftServer);
            toast.add({
                type: 'success',
                title: t('prompt.proxy_settings.test_success', {
                    status: result.status
                })
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title: t('prompt.proxy_settings.test_failed', {
                    message: proxySettingsErrorMessage(error)
                })
            });
        } finally {
            setTesting(false);
        }
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <span ref={anchorRef} className="inline-flex h-6 shrink-0">
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={t('status_bar.proxy')}
                                className={cn(
                                    'size-6 rounded-none',
                                    indicator.className
                                )}
                                onClick={() => onOpenChange(true)}
                            >
                                <NetworkIcon data-icon="icon" />
                            </Button>
                        }
                    />
                    <TooltipContent className="max-w-xs">
                        {t(indicator.tooltipKey, indicator.tooltipValues)}
                    </TooltipContent>
                </Tooltip>
            </span>
            <PopoverContent
                side="top"
                align="end"
                anchor={anchorRef}
                className="w-96"
            >
                <PopoverHeader>
                    <PopoverTitle>
                        {t('prompt.proxy_settings.header')}
                    </PopoverTitle>
                    <PopoverDescription>
                        {t('prompt.proxy_settings.description')}
                    </PopoverDescription>
                </PopoverHeader>
                <ProxySettingsEditor
                    enabled={draftEnabled}
                    idPrefix="status-bar-proxy-settings"
                    saving={saving}
                    server={draftServer}
                    testing={testing}
                    onEnabledChange={setDraftEnabled}
                    onSave={() => {
                        save(false);
                    }}
                    onSaveAndRestart={() => {
                        save(true);
                    }}
                    onServerChange={setDraftServer}
                    onTest={test}
                />
            </PopoverContent>
        </Popover>
    );
}
