import { CheckIcon, ImageIcon, RefreshCcwIcon, SendIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { FadeInImage } from '@/components/media/FadeInImage';
import {
    TILE_CHECK,
    TILE_MOTION_STANDALONE,
    TILE_SELECTED
} from '@/lib/selectableTile';
import { cn } from '@/lib/utils';
import mediaRepository from '@/repositories/mediaRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { vrchatDefaultEmojis } from '@/shared/constants/vrchatDefaultEmojis';
import { isRecord } from '@/shared/utils/record';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

type EmojiSource = 'default' | 'custom';

type CustomEmoji = {
    id: string;
    imageUrl: string;
};

type BoopEmojiDialogProps = {
    open: boolean;
    isLocalUserVrcPlusSupporter?: boolean;
    targetLabel?: string;
    sendDisabled?: boolean;
    onOpenChange: (open: boolean) => void;
    onSend: (emojiId: string) => void | Promise<void>;
};

function getString(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    return typeof value === 'string' ? value : '';
}

function getFileImageUrl(file: Record<string, unknown>): string {
    const versions = Array.isArray(file.versions) ? file.versions : [];
    const version = versions.at(-1);
    const versionFile =
        isRecord(version) && isRecord(version.file) ? version.file : {};
    const url =
        getString(versionFile, 'url') ||
        getString(file, 'url') ||
        getString(file, 'imageUrl');
    return url ? convertFileUrlToImageUrl(url, 128) : '';
}

function normalizeCustomEmoji(
    file: Record<string, unknown>
): CustomEmoji | null {
    const id = getString(file, 'id');
    const imageUrl = getFileImageUrl(file);
    if (!id || !imageUrl) {
        return null;
    }
    return {
        id,
        imageUrl
    };
}

function EmojiChoice({
    imageUrl,
    label,
    imageOnly = false,
    selected,
    disabled,
    onClick
}: {
    imageUrl: string;
    label: string;
    imageOnly?: boolean;
    selected: boolean;
    disabled: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={selected}
            disabled={disabled}
            className={cn(
                'focus-visible:border-ring focus-visible:ring-ring/50 relative flex min-w-0 flex-col items-center gap-2 rounded-lg border bg-clip-padding p-2.5 text-center outline-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50',
                TILE_MOTION_STANDALONE,
                'border-border bg-card/40 pointer-fine:hover:bg-muted/60',
                imageOnly && 'aspect-square justify-center p-3',
                selected && TILE_SELECTED
            )}
            onClick={onClick}
        >
            {selected ? (
                <span className={TILE_CHECK}>
                    <CheckIcon className="size-3" aria-hidden="true" />
                </span>
            ) : null}
            <span
                className={cn(
                    'flex items-center justify-center',
                    imageOnly ? 'size-full' : 'size-16'
                )}
            >
                <FadeInImage
                    src={imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={cn(
                        'object-contain',
                        imageOnly
                            ? 'max-h-full max-w-full'
                            : 'max-h-16 max-w-16'
                    )}
                    fallback={
                        <ImageIcon
                            className="text-muted-foreground size-8"
                            aria-hidden="true"
                        />
                    }
                />
            </span>
            {imageOnly ? null : (
                <span className="w-full truncate text-xs font-medium">
                    {label}
                </span>
            )}
        </button>
    );
}

export function BoopEmojiDialog({
    open,
    isLocalUserVrcPlusSupporter = false,
    targetLabel = '',
    sendDisabled = false,
    onOpenChange,
    onSend
}: BoopEmojiDialogProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [emojiId, setEmojiId] = useState('');
    const [emojiSource, setEmojiSource] = useState<EmojiSource>('default');
    const [emojiRows, setEmojiRows] = useState<CustomEmoji[]>([]);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const requestIdRef = useRef(0);

    const loadEmojiRows = useCallback(async () => {
        if (!open || !isLocalUserVrcPlusSupporter) {
            return;
        }
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError('');
        try {
            const { json } = await mediaRepository.getFileList({
                n: 100,
                tag: 'emoji'
            });
            if (requestIdRef.current !== requestId) {
                return;
            }
            setEmojiRows(
                Array.isArray(json)
                    ? [...json]
                          .reverse()
                          .map(normalizeCustomEmoji)
                          .filter(
                              (emoji): emoji is CustomEmoji => emoji !== null
                          )
                    : []
            );
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
    }, [isLocalUserVrcPlusSupporter, open]);

    useEffect(() => {
        if (open) {
            setEmojiId('');
            setEmojiSource('default');
            loadEmojiRows();
        } else {
            requestIdRef.current += 1;
            setEmojiId('');
            setEmojiSource('default');
            setEmojiRows([]);
            setLoading(false);
            setSending(false);
            setError('');
        }
    }, [loadEmojiRows, open]);

    const selectedEmojiName =
        vrchatDefaultEmojis.find((emoji) => emoji.id === emojiId)?.name ??
        (emojiRows.some((emoji) => emoji.id === emojiId)
            ? t('dialog.inventory.custom')
            : '');

    async function handleSend() {
        if (sendDisabled || sending) {
            return;
        }
        setSending(true);
        setError('');
        try {
            await onSend(emojiId);
            onOpenChange(false);
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
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-[min(92vw,46rem)]">
                <DialogHeader>
                    <DialogTitle>{t('dialog.boop_dialog.header')}</DialogTitle>
                    <DialogDescription>
                        {targetLabel || t('view.notification.action.send_boop')}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 flex-col gap-3">
                    <Tabs
                        value={emojiSource}
                        className="min-h-0 gap-3"
                        onValueChange={(value) => {
                            if (value === 'default' || value === 'custom') {
                                setEmojiSource(value);
                            }
                        }}
                    >
                        <div className="flex min-h-8 items-center justify-between gap-3">
                            <TabsList
                                variant="underline"
                                className="relative h-8 justify-start p-0"
                            >
                                <TabsTrigger
                                    value="default"
                                    className="min-w-28 flex-none px-3"
                                >
                                    {t('dialog.boop_dialog.default_emojis')}
                                </TabsTrigger>
                                {isLocalUserVrcPlusSupporter ? (
                                    <TabsTrigger
                                        value="custom"
                                        className="min-w-28 flex-none px-3"
                                    >
                                        {t('dialog.inventory.custom')}
                                    </TabsTrigger>
                                ) : null}
                            </TabsList>
                            {emojiId || emojiSource === 'custom' ? (
                                <div className="flex min-w-0 items-center gap-1">
                                    {emojiId ? (
                                        <>
                                            <span
                                                className="text-muted-foreground max-w-36 truncate text-xs"
                                                title={selectedEmojiName}
                                            >
                                                {selectedEmojiName}
                                            </span>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                disabled={sending}
                                                onClick={() => setEmojiId('')}
                                            >
                                                {t(
                                                    'view.notification.action.clear_selection'
                                                )}
                                            </Button>
                                        </>
                                    ) : null}
                                    {emojiSource === 'custom' ? (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon-sm"
                                            aria-label={t(
                                                'common.actions.refresh'
                                            )}
                                            title={t('common.actions.refresh')}
                                            disabled={loading || sending}
                                            onClick={loadEmojiRows}
                                        >
                                            <RefreshCcwIcon />
                                        </Button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                        <TabsContent
                            value="default"
                            className="bg-muted/20 max-h-[48vh] min-h-0 overflow-y-auto rounded-xl border p-2"
                        >
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
                                {vrchatDefaultEmojis.map((emoji) => {
                                    const selected = emojiId === emoji.id;
                                    return (
                                        <EmojiChoice
                                            key={emoji.id}
                                            imageUrl={emoji.previewUrl}
                                            label={emoji.name}
                                            selected={selected}
                                            disabled={sending}
                                            onClick={() =>
                                                setEmojiId(
                                                    selected ? '' : emoji.id
                                                )
                                            }
                                        />
                                    );
                                })}
                            </div>
                        </TabsContent>
                        {isLocalUserVrcPlusSupporter ? (
                            <TabsContent
                                value="custom"
                                className="bg-muted/20 max-h-[48vh] min-h-0 overflow-y-auto rounded-xl border p-2"
                            >
                                {loading ? (
                                    <div className="text-muted-foreground flex h-28 items-center justify-center gap-2 text-sm">
                                        <Spinner className="size-4" />
                                        {t(
                                            'view.notification.loading.loading_emojis'
                                        )}
                                    </div>
                                ) : emojiRows.length ? (
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                                        {emojiRows.map((emoji) => {
                                            const selected =
                                                emojiId === emoji.id;
                                            return (
                                                <EmojiChoice
                                                    key={emoji.id}
                                                    imageUrl={emoji.imageUrl}
                                                    label={t(
                                                        'dialog.gallery_icons.emoji'
                                                    )}
                                                    imageOnly
                                                    selected={selected}
                                                    disabled={sending}
                                                    onClick={() =>
                                                        setEmojiId(
                                                            selected
                                                                ? ''
                                                                : emoji.id
                                                        )
                                                    }
                                                />
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-muted-foreground flex h-28 items-center justify-center text-sm">
                                        {t('empty_state.search_no_results')}
                                    </div>
                                )}
                            </TabsContent>
                        ) : null}
                    </Tabs>
                    {!emojiId ? (
                        <p className="text-muted-foreground text-xs">
                            {t(
                                'view.notification.empty.no_custom_emoji_selected_the_default_boop_will_be_sent'
                            )}
                        </p>
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
                            onOpenChange(false);
                            navigate('/tools/inventory');
                        }}
                    >
                        {t('dialog.boop_dialog.emoji_manager')}
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={sending}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={sending || sendDisabled}
                        onClick={handleSend}
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
