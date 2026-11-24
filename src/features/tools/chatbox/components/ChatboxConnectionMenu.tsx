import { Settings2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatboxConfig } from '@/platform/tauri/bindings';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
    Popover,
    PopoverContent,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger
} from '@/ui/shadcn/popover';

import type { ChatboxConfigUpdate } from '../chatboxConfig';
import { useSyncedDraft } from '../useSyncedDraft';

export function ChatboxConnectionMenu({
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

    const label = t('view.tools.chatbox.settings.connection');

    return (
        <Popover>
            <HintTooltip label={label}>
                <PopoverTrigger
                    render={
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={label}
                        >
                            <Settings2Icon />
                        </Button>
                    }
                />
            </HintTooltip>
            <PopoverContent align="end" className="w-72">
                <PopoverHeader>
                    <PopoverTitle>{label}</PopoverTitle>
                </PopoverHeader>
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
            </PopoverContent>
        </Popover>
    );
}
