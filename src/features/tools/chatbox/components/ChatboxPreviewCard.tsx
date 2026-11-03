import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatboxStatus } from '@/platform/tauri/bindings';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';

import { chatboxCharCount, secondsUntilNextPage } from '../chatboxConfig';

export function ChatboxPreviewCard({
    status,
    receivedAt,
    maxChars
}: {
    status: ChatboxStatus | null;
    receivedAt: number;
    maxChars: number;
}) {
    const { t } = useTranslation();
    const [now, setNow] = useState(() => Date.now());
    const remaining = status
        ? secondsUntilNextPage(status, receivedAt, now)
        : null;
    const counting = remaining !== null;

    useEffect(() => {
        if (!counting) {
            return;
        }
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [counting]);

    const preview = status?.preview ?? '';
    const lineCount = preview ? preview.split('\n').length : 0;

    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>{t('view.tools.chatbox.preview.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2">
                <div className="bg-muted/40 flex min-h-20 flex-1 items-center justify-center rounded-lg p-3">
                    {preview ? (
                        <p className="max-w-64 rounded-lg bg-neutral-900 px-3 py-2 text-center text-sm leading-relaxed break-words whitespace-pre-line text-white">
                            {preview}
                        </p>
                    ) : (
                        <p className="text-muted-foreground text-sm">
                            {t('view.tools.chatbox.preview.empty')}
                        </p>
                    )}
                </div>
                <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                    <span>
                        {t('view.tools.chatbox.preview.characters', {
                            count: chatboxCharCount(preview),
                            max: maxChars
                        })}
                        {lineCount > 0 ? ` · ${lineCount}` : ''}
                        {status && status.pageNumber !== null
                            ? ` · ${t('view.tools.chatbox.preview.page', {
                                  current: status.pageNumber,
                                  total: status.pageCount
                              })}`
                            : ''}
                    </span>
                    {remaining !== null ? (
                        <span>
                            {t('view.tools.chatbox.preview.next_page', {
                                seconds: remaining
                            })}
                        </span>
                    ) : null}
                </div>
            </CardContent>
        </Card>
    );
}
