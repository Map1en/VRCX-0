import { useTranslation } from 'react-i18next';

import type {
    ChatboxConfig,
    ChatboxLimits,
    ChatboxStatus
} from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';

import type { ChatboxConfigUpdate } from '../chatboxConfig';
import { useSyncedDraft } from '../useSyncedDraft';

export function ChatboxAfkCard({
    config,
    limits,
    status,
    onUpdate,
    onManualAfkChange
}: {
    config: ChatboxConfig;
    limits: ChatboxLimits;
    status: ChatboxStatus | null;
    onUpdate(update: ChatboxConfigUpdate): void;
    onManualAfkChange(afk: boolean): void;
}) {
    const { t } = useTranslation();
    const manualAfk = status?.manualAfk ?? false;
    const [text, setText] = useSyncedDraft(config.afk.text);

    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>{t('view.tools.chatbox.afk.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    <label
                        htmlFor="chatbox-afk-text"
                        className="text-muted-foreground text-xs"
                    >
                        {t('view.tools.chatbox.afk.text')}
                    </label>
                    <div className="flex items-center gap-2">
                        <Input
                            id="chatbox-afk-text"
                            value={text}
                            maxLength={limits.maxAfkTextChars}
                            placeholder={t(
                                'view.tools.chatbox.afk.text_placeholder'
                            )}
                            className="flex-1"
                            onChange={(event) => setText(event.target.value)}
                            onBlur={() => {
                                if (text.trim() !== config.afk.text) {
                                    onUpdate((current) => ({
                                        ...current,
                                        afk: {
                                            ...current.afk,
                                            text: text.trim()
                                        }
                                    }));
                                }
                            }}
                        />
                        <Button
                            variant="outline"
                            onClick={() => onManualAfkChange(!manualAfk)}
                        >
                            {manualAfk
                                ? t('view.tools.chatbox.afk.back')
                                : t('view.tools.chatbox.afk.go_afk')}
                        </Button>
                    </div>
                </div>
                <label className="flex items-center gap-3 text-sm">
                    <span className="flex-1">
                        {t('view.tools.chatbox.afk.show_duration')}
                    </span>
                    <Switch
                        checked={config.afk.showDuration}
                        onCheckedChange={(showDuration) =>
                            onUpdate((current) => ({
                                ...current,
                                afk: { ...current.afk, showDuration }
                            }))
                        }
                    />
                </label>
                {status?.vrMode ? (
                    <label className="flex items-start gap-3 text-sm">
                        <span className="flex flex-1 flex-col gap-0.5">
                            {t('view.tools.chatbox.afk.auto_headset')}
                            <span className="text-muted-foreground text-xs">
                                {t('view.tools.chatbox.afk.auto_headset_hint')}
                            </span>
                        </span>
                        <Switch
                            checked={config.afk.autoWhenHeadsetRemoved}
                            onCheckedChange={(autoWhenHeadsetRemoved) =>
                                onUpdate((current) => ({
                                    ...current,
                                    afk: {
                                        ...current.afk,
                                        autoWhenHeadsetRemoved
                                    }
                                }))
                            }
                        />
                    </label>
                ) : null}
            </CardContent>
        </Card>
    );
}
