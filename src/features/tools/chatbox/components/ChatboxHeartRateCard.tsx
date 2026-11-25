import type { TFunction } from 'i18next';
import { Settings2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsCard } from '@/components/layout/SettingsCard';
import { commands, type HeartRateStatus } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useChatboxStore } from '@/state/chatboxStore';
import { Button } from '@/ui/shadcn/button';
import { Switch } from '@/ui/shadcn/switch';

import { ChatboxHeartRateParametersDialog } from './ChatboxHeartRateParametersDialog';

export function ChatboxHeartRateCard() {
    const { t } = useTranslation();
    const status = useChatboxStore((state) => state.heartRate);
    const [pending, setPending] = useState(false);
    const [parametersOpen, setParametersOpen] = useState(false);

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

    function toggle(next: boolean) {
        setPending(true);
        commands
            .appHeartRateConnectedSet(next)
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
            description={heartRateStatusText(status, t)}
            defaultOpen={active}
            bodyClassName="flex flex-col gap-2 py-3"
            action={
                <Switch
                    aria-label={t('view.tools.chatbox.heart_rate.connect')}
                    checked={active}
                    disabled={unavailable || pending}
                    onCheckedChange={toggle}
                />
            }
        >
            <p className="text-muted-foreground text-xs">
                {t('view.tools.chatbox.heart_rate.devices')}
            </p>
            <p className="text-muted-foreground text-xs">
                {t('view.tools.chatbox.heart_rate.hint', {
                    variable: '{heartrate}'
                })}
            </p>
            <div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setParametersOpen(true)}
                >
                    <Settings2Icon />
                    {t('view.tools.chatbox.heart_rate.parameters.open')}
                </Button>
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
