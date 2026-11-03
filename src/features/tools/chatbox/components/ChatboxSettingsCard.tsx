import { useTranslation } from 'react-i18next';

import type { ChatboxConfig } from '@/platform/tauri/bindings';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';

import type { ChatboxConfigUpdate } from '../chatboxConfig';
import { useSyncedDraft } from '../useSyncedDraft';

export function ChatboxSettingsCard({
    config,
    onUpdate
}: {
    config: ChatboxConfig;
    onUpdate(update: ChatboxConfigUpdate): void;
}) {
    const { t } = useTranslation();
    const [host, setHost] = useSyncedDraft(config.oscHost);
    const [port, setPort] = useSyncedDraft(String(config.oscPort));

    function commitHost() {
        const oscHost = host.trim() || config.oscHost;
        setHost(oscHost);
        if (oscHost !== config.oscHost) {
            onUpdate((current) => ({ ...current, oscHost }));
        }
    }

    function commitPort() {
        const parsed = Number.parseInt(port, 10);
        const oscPort =
            Number.isInteger(parsed) && parsed > 0 && parsed < 65536
                ? parsed
                : config.oscPort;
        setPort(String(oscPort));
        if (oscPort !== config.oscPort) {
            onUpdate((current) => ({ ...current, oscPort }));
        }
    }

    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>{t('view.tools.chatbox.settings.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                <div className="flex items-end gap-2">
                    <label className="flex flex-1 flex-col gap-1 text-xs">
                        <span className="text-muted-foreground">
                            {t('view.tools.chatbox.settings.host')}
                        </span>
                        <Input
                            value={host}
                            onChange={(event) => setHost(event.target.value)}
                            onBlur={commitHost}
                        />
                    </label>
                    <label className="flex w-24 flex-col gap-1 text-xs">
                        <span className="text-muted-foreground">
                            {t('view.tools.chatbox.settings.port')}
                        </span>
                        <Input
                            type="number"
                            min={1}
                            max={65535}
                            value={port}
                            onChange={(event) => setPort(event.target.value)}
                            onBlur={commitPort}
                        />
                    </label>
                </div>
                <MessageSwitch
                    label={t('view.tools.chatbox.settings.typing_indicator')}
                    checked={config.messages.typingIndicator}
                    onChange={(typingIndicator) =>
                        onUpdate((current) => ({
                            ...current,
                            messages: { ...current.messages, typingIndicator }
                        }))
                    }
                />
                <MessageSwitch
                    label={t('view.tools.chatbox.settings.notify_sound')}
                    checked={config.messages.notifySound}
                    onChange={(notifySound) =>
                        onUpdate((current) => ({
                            ...current,
                            messages: { ...current.messages, notifySound }
                        }))
                    }
                />
            </CardContent>
        </Card>
    );
}

function MessageSwitch({
    label,
    checked,
    onChange
}: {
    label: string;
    checked: boolean;
    onChange(checked: boolean): void;
}) {
    return (
        <label className="flex items-center gap-3 text-sm">
            <span className="flex-1">{label}</span>
            <Switch checked={checked} onCheckedChange={onChange} />
        </label>
    );
}
