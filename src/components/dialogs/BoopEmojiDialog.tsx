import { RefreshCcwIcon, SendIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import mediaRepository from '@/repositories/mediaRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { photonEmojiId, photonEmojis } from '@/shared/constants/photonEmojis';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';

type PhotonEmojiRow = {
    id: string;
    name: string;
};

const photonEmojiRows: PhotonEmojiRow[] = photonEmojis.map((name) => ({
    id: photonEmojiId(name),
    name
}));

const noDefaultEmojiValue = '__none__';

function getFileImageUrl(file: any) {
    const versions = Array.isArray(file?.versions) ? file.versions : [];
    const version = versions.at(-1);
    const url = version?.file?.url || file?.url || file?.imageUrl || '';
    return url ? convertFileUrlToImageUrl(url, 128) : '';
}

export function BoopEmojiDialog({
    open,
    endpoint = '',
    isLocalUserVrcPlusSupporter = false,
    targetLabel = '',
    sendDisabled = false,
    onOpenChange,
    onSend
}: any) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [emojiId, setEmojiId] = useState('');
    const [emojiSearch, setEmojiSearch] = useState('');
    const [emojiRows, setEmojiRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const requestIdRef = useRef(0);

    async function loadEmojiRows() {
        if (!open || !isLocalUserVrcPlusSupporter) {
            return;
        }
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError('');
        try {
            const { json } = await mediaRepository.getFileList(
                { n: 100, tag: 'emoji' },
                { endpoint }
            );
            if (requestIdRef.current !== requestId) {
                return;
            }
            setEmojiRows(Array.isArray(json) ? [...json].reverse() : []);
        } catch (nextError) {
            if (requestIdRef.current !== requestId) {
                return;
            }
            setEmojiRows([]);
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : 'Failed to load emojis.'
            );
        } finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        if (open) {
            setEmojiId('');
            loadEmojiRows();
        } else {
            requestIdRef.current += 1;
            setEmojiId('');
            setEmojiSearch('');
            setEmojiRows([]);
            setLoading(false);
            setSending(false);
            setError('');
        }
    }, [endpoint, isLocalUserVrcPlusSupporter, open]);

    const selectedDefaultEmojiId = useMemo(
        () =>
            photonEmojiRows.some((row) => row.id === emojiId)
                ? emojiId
                : undefined,
        [emojiId]
    );
    const filteredEmojiRows = useMemo(() => {
        const query = emojiSearch.trim().toLowerCase();
        if (!query) {
            return emojiRows;
        }
        return emojiRows.filter((emoji: any) =>
            [emoji?.name, emoji?.id].some((value: any) =>
                String(value || '')
                    .toLowerCase()
                    .includes(query)
            )
        );
    }, [emojiRows, emojiSearch]);

    async function handleSend() {
        if (sendDisabled || sending) {
            return;
        }
        setSending(true);
        setError('');
        try {
            await onSend?.(emojiId);
            onOpenChange?.(false);
        } catch (nextError) {
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : 'Failed to send boop.'
            );
        } finally {
            setSending(false);
        }
    }

    return (
        <Dialog open={Boolean(open)} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-[min(92vw,46rem)]">
                <DialogHeader>
                    <DialogTitle>{t('dialog.boop_dialog.header')}</DialogTitle>
                    <DialogDescription>
                        {targetLabel || t('view.notification.action.send_boop')}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 flex-col gap-3">
                    {!emojiId ? (
                        <div className="text-muted-foreground rounded-md border p-3 text-sm">
                            {t(
                                'view.notification.empty.no_custom_emoji_selected_the_default_boop_will_be_sent'
                            )}
                        </div>
                    ) : null}
                    <div className="flex flex-col gap-2">
                        <div className="text-muted-foreground text-xs font-medium">
                            {t('dialog.boop_dialog.default_emojis')}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Select
                                value={selectedDefaultEmojiId}
                                onValueChange={(value) => {
                                    setEmojiId(
                                        value === noDefaultEmojiValue
                                            ? ''
                                            : value
                                    );
                                }}
                            >
                                <SelectTrigger
                                    className="w-full min-w-56 flex-1"
                                    disabled={sending}
                                >
                                    <SelectValue
                                        placeholder={t(
                                            'dialog.boop_dialog.select_default_emoji'
                                        )}
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={noDefaultEmojiValue}>
                                        {t(
                                            'view.notification.action.clear_selection'
                                        )}
                                    </SelectItem>
                                    {photonEmojiRows.map((row) => (
                                        <SelectItem key={row.id} value={row.id}>
                                            {row.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={sending || !selectedDefaultEmojiId}
                                onClick={() => setEmojiId('')}
                            >
                                {t('view.notification.action.clear_selection')}
                            </Button>
                        </div>
                    </div>
                    {isLocalUserVrcPlusSupporter ? (
                        <div className="flex min-h-0 flex-col gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <Input
                                    value={emojiSearch}
                                    placeholder={t(
                                        'view.notification.action.search_emoji'
                                    )}
                                    disabled={sending}
                                    className="h-9 min-w-48 flex-1"
                                    onChange={(event: any) =>
                                        setEmojiSearch(event.target.value)
                                    }
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={sending || !emojiId}
                                    onClick={() => setEmojiId('')}
                                >
                                    {t(
                                        'view.notification.action.clear_selection'
                                    )}
                                </Button>
                            </div>
                            <div className="max-h-[42vh] min-h-0 overflow-y-auto rounded-md border p-2">
                                {loading ? (
                                    <div className="text-muted-foreground flex h-28 items-center justify-center gap-2 text-sm">
                                        <Spinner className="size-4" />
                                        {t(
                                            'view.notification.loading.loading_emojis'
                                        )}
                                    </div>
                                ) : filteredEmojiRows.length ? (
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
                                        {filteredEmojiRows.map((emoji: any) => {
                                            const imageUrl =
                                                getFileImageUrl(emoji);
                                            if (!imageUrl || !emoji?.id) {
                                                return null;
                                            }
                                            const selected =
                                                emojiId === emoji.id;
                                            return (
                                                <Button
                                                    key={emoji.id}
                                                    type="button"
                                                    variant={
                                                        selected
                                                            ? 'secondary'
                                                            : 'outline'
                                                    }
                                                    className="h-auto w-full flex-col p-2"
                                                    aria-pressed={selected}
                                                    disabled={sending}
                                                    onClick={() =>
                                                        setEmojiId(
                                                            selected
                                                                ? ''
                                                                : emoji.id
                                                        )
                                                    }
                                                >
                                                    <img
                                                        src={imageUrl}
                                                        alt={
                                                            emoji.name ||
                                                            emoji.id
                                                        }
                                                        className="mx-auto size-20 object-contain"
                                                    />
                                                </Button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-muted-foreground flex h-28 items-center justify-center text-sm">
                                        {emojiRows.length
                                            ? 'No custom emojis match the search.'
                                            : 'No custom emojis.'}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : null}
                    {error ? (
                        <div className="text-destructive text-sm">{error}</div>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={sending}
                        onClick={() => {
                            onOpenChange?.(false);
                            navigate('/tools/inventory');
                        }}
                    >
                        {t('dialog.boop_dialog.emoji_manager')}
                    </Button>
                    {isLocalUserVrcPlusSupporter ? (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={loading || sending}
                            onClick={() => {
                                loadEmojiRows();
                            }}
                        >
                            <RefreshCcwIcon data-icon="inline-start" />
                            {t('common.actions.refresh')}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={sending}
                        onClick={() => onOpenChange?.(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={sending || sendDisabled}
                        onClick={() => {
                            handleSend();
                        }}
                    >
                        {sending ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <SendIcon data-icon="inline-start" />
                        )}
                        {t('dialog.boop_dialog.send')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
