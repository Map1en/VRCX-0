import type { TFunction } from 'i18next';
import { HeartPulseIcon, Settings2Icon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsCard } from '@/components/layout/SettingsCard';
import { cn } from '@/lib/utils';
import { commands, type HeartRateStatus } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useChatboxStore } from '@/state/chatboxStore';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldLabel
} from '@/ui/shadcn/field';
import { Switch } from '@/ui/shadcn/switch';

import { ChatboxHeartRateParametersDialog } from './ChatboxHeartRateParametersDialog';

export function ChatboxHeartRateCard() {
    const { t } = useTranslation();
    const status = useChatboxStore((state) => state.heartRate);
    const [pending, setPending] = useState(false);
    const [parametersOpen, setParametersOpen] = useState(false);
    const sendParametersId = useId();

    useEffect(() => {
        commands.appHeartRateStatusGet().then(
            (loaded) => useChatboxStore.getState().setHeartRate(loaded),
            (error: unknown) =>
                console.warn('Failed to load heart rate status:', error)
        );
    }, []);

    const phase = status?.phase ?? 'off';
    const active = status?.enabled ?? false;
    const unavailable = phase === 'unavailable' && !active;
    const sendParameters = status?.sendParameters ?? true;
    const bpm = phase === 'connected' ? (status?.bpm ?? null) : null;

    function save(request: () => Promise<HeartRateStatus>) {
        setPending(true);
        request()
            .then(
                (saved) => useChatboxStore.getState().setHeartRate(saved),
                () =>
                    toast.add({
                        type: 'error',
                        title: t('view.tools.chatbox.heart_rate.save_failed')
                    })
            )
            .finally(() => setPending(false));
    }

    return (
        <SettingsCard
            cardId="chatbox.heartRate"
            title={t('view.tools.chatbox.heart_rate.title')}
            description={t(
                active
                    ? 'view.tools.chatbox.module_on'
                    : 'view.tools.chatbox.module_off'
            )}
            defaultOpen={active}
            bodyClassName="flex flex-col gap-3 py-3"
            action={
                <Switch
                    aria-label={t('view.tools.chatbox.heart_rate.connect')}
                    checked={active}
                    disabled={unavailable || pending}
                    onCheckedChange={(next) =>
                        save(() => commands.appHeartRateConnectedSet(next))
                    }
                />
            }
        >
            <div className="bg-muted/40 flex min-h-12 items-center gap-3 rounded-lg px-3 py-2">
                <HeartPulseIcon
                    aria-hidden="true"
                    className={cn(
                        'size-4 shrink-0',
                        bpm ? 'text-foreground' : 'text-muted-foreground'
                    )}
                />
                <span
                    className={cn(
                        'min-w-0 flex-1 text-sm',
                        !bpm && 'text-muted-foreground'
                    )}
                >
                    {heartRateStatusText(status, t)}
                </span>
                {bpm ? (
                    <span className="font-heading shrink-0 text-xl leading-none font-semibold tabular-nums">
                        {bpm}
                        <span className="text-muted-foreground ml-1 text-xs font-normal">
                            {t('view.tools.chatbox.heart_rate.bpm_unit')}
                        </span>
                    </span>
                ) : null}
            </div>
            <Field orientation="horizontal" className="gap-3 py-1">
                <FieldContent>
                    <FieldLabel htmlFor={sendParametersId}>
                        {t('view.tools.chatbox.heart_rate.send_parameters')}
                    </FieldLabel>
                    <FieldDescription className="text-xs">
                        {t(
                            'view.tools.chatbox.heart_rate.send_parameters_hint'
                        )}
                    </FieldDescription>
                </FieldContent>
                <HintTooltip
                    label={t('view.tools.chatbox.heart_rate.parameters.open')}
                >
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={!sendParameters}
                        onClick={() => setParametersOpen(true)}
                    >
                        <Settings2Icon />
                    </Button>
                </HintTooltip>
                <Switch
                    id={sendParametersId}
                    checked={sendParameters}
                    disabled={pending}
                    onCheckedChange={(next) =>
                        save(() => commands.appHeartRateSendParametersSet(next))
                    }
                />
            </Field>
            <div className="border-stroke-subtle text-muted-foreground flex flex-col gap-1 border-t pt-2.5 text-xs">
                <p>{t('view.tools.chatbox.heart_rate.devices')}</p>
                <p>
                    {t('view.tools.chatbox.heart_rate.hint', {
                        variable: '{heartrate}'
                    })}
                </p>
            </div>
            <ChatboxHeartRateParametersDialog
                open={parametersOpen}
                onOpenChange={setParametersOpen}
            />
        </SettingsCard>
    );
}

function heartRateStatusText(
    status: HeartRateStatus | null,
    t: TFunction
): string {
    const device =
        status?.deviceName ?? t('view.tools.chatbox.heart_rate.device');
    switch (status?.phase) {
        case 'unavailable':
            return t('view.tools.chatbox.heart_rate.unavailable');
        case 'waiting':
            return t('view.tools.chatbox.heart_rate.waiting', { device });
        case 'connected':
            return status.bpm
                ? t('view.tools.chatbox.heart_rate.connected', { device })
                : t('view.tools.chatbox.heart_rate.no_reading', { device });
        default:
            if (status?.problem === 'incompatible') {
                return t('view.tools.chatbox.heart_rate.incompatible');
            }
            if (status?.problem === 'permissionDenied') {
                return t('view.tools.chatbox.heart_rate.permission_denied');
            }
            return t('view.tools.chatbox.heart_rate.off');
    }
}
