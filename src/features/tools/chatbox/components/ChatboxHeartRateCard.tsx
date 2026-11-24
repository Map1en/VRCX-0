import type { TFunction } from 'i18next';
import { HeartPulseIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands, type HeartRateStatus } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useChatboxStore } from '@/state/chatboxStore';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardAction,
    CardContent,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';

export function ChatboxHeartRateCard() {
    const { t } = useTranslation();
    const status = useChatboxStore((state) => state.heartRate);
    const [pending, setPending] = useState(false);

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

    function toggle() {
        setPending(true);
        commands
            .appHeartRateConnectedSet(!active)
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
        <Card size="sm" className={unavailable ? 'opacity-60' : undefined}>
            <CardHeader>
                <CardTitle>
                    {t('view.tools.chatbox.heart_rate.title')}
                </CardTitle>
                <CardAction>
                    <Button
                        type="button"
                        size="sm"
                        variant={active ? 'outline' : 'default'}
                        disabled={unavailable || pending}
                        onClick={toggle}
                    >
                        {t(
                            active
                                ? 'view.tools.chatbox.heart_rate.disconnect'
                                : 'view.tools.chatbox.heart_rate.connect'
                        )}
                    </Button>
                </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm">
                    <HeartPulseIcon
                        className={
                            phase === 'connected' && status?.bpm
                                ? 'text-primary size-4'
                                : 'text-muted-foreground size-4'
                        }
                    />
                    <span>{heartRateStatusText(status, t)}</span>
                </div>
                <p className="text-muted-foreground text-xs">
                    {t('view.tools.chatbox.heart_rate.devices')}
                </p>
                <p className="text-muted-foreground text-xs">
                    {t('view.tools.chatbox.heart_rate.hint', {
                        variable: '{heartrate}'
                    })}
                </p>
            </CardContent>
        </Card>
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
                ? t('view.tools.chatbox.heart_rate.connected', {
                      device,
                      bpm: status.bpm
                  })
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
