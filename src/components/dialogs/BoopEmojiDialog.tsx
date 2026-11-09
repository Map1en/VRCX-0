import { BanIcon, CheckIcon, ImageIcon, RefreshCcwIcon } from 'lucide-react';
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { FadeInImage } from '@/components/media/FadeInImage';
import { TileShell } from '@/components/tile/TileShell';
import {
    isSameBoopEmoji,
    type BoopEmojiChoice
} from '@/domain/entities/boopEmoji';
import {
    resolveInventoryImageUrl,
    resolveInventoryName
} from '@/domain/entities/inventory';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import vrchatMediaRepository, {
    type InventoryItemRecord
} from '@/repositories/vrchatMediaRepository';
import { getRecentBoopEmojis } from '@/services/boopRecentService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import {
    TILE_CHECK,
    TILE_CHECK_ANCHOR,
    TILE_MOTION_STANDALONE
} from '@/shared/constants/selectableTile';
import { vrchatDefaultEmojis } from '@/shared/constants/vrchatDefaultEmojis';
import { isRecord } from '@/shared/utils/record';
import { HintTooltip } from '@/ui/hint-tooltip';
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

const EMOJI_SOURCES = ['recent', 'default', 'custom', 'inventory'] as const;

type EmojiSource = (typeof EMOJI_SOURCES)[number];

type BoopEmojiDialogProps = {
    open: boolean;
    isLocalUserVrcPlusSupporter?: boolean;
    targetLabel?: string;
    sendDisabled?: boolean;
    onOpenChange: (open: boolean) => void;
    onSend: (choice: BoopEmojiChoice | null) => void | Promise<void>;
};

const defaultEmojiChoices: readonly BoopEmojiChoice[] = vrchatDefaultEmojis.map(
    (emoji) => ({
        kind: 'default',
        id: emoji.id,
        imageUrl: emoji.previewUrl,
        name: emoji.name
    })
);

function isEmojiSource(value: string): value is EmojiSource {
    return EMOJI_SOURCES.some((source) => source === value);
}

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
): BoopEmojiChoice | null {
    const id = getString(file, 'id');
    const imageUrl = getFileImageUrl(file);
    if (!id || !imageUrl) {
        return null;
    }
    return { kind: 'file', id, imageUrl, name: '' };
}

function normalizeInventoryEmoji(
    item: InventoryItemRecord
): BoopEmojiChoice | null {
    const imageUrl = resolveInventoryImageUrl(item);
    if (!item.id || !imageUrl || !item.metadata?.fileId) {
        return null;
    }
    return {
        kind: 'inventory',
        id: item.id,
        imageUrl: convertFileUrlToImageUrl(imageUrl, 128),
        name: resolveInventoryName(item)
    };
}

async function fetchCustomEmojis(): Promise<BoopEmojiChoice[]> {
    const { json } = await vrchatMediaRepository.getFileList({
        n: 100,
        tag: 'emoji'
    });
    return Array.isArray(json)
        ? [...json]
              .reverse()
              .map(normalizeCustomEmoji)
              .filter((emoji) => emoji !== null)
        : [];
}

async function fetchInventoryEmojis(): Promise<BoopEmojiChoice[]> {
    const { items } = await vrchatMediaRepository.collectInventoryItems({
        types: ['emoji'],
        notFlags: ['ugc'],
        archived: false
    });
    return items.map(normalizeInventoryEmoji).filter((emoji) => emoji !== null);
}

function useEmojiRows(
    fetchRows: () => Promise<BoopEmojiChoice[]>,
    enabled: boolean
) {
    const { t } = useTranslation();
    const [rows, setRows] = useState<BoopEmojiChoice[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const requestIdRef = useRef(0);
    const failedMessageRef = useRef('');
    failedMessageRef.current = t('dialog.boop_dialog.failed_to_load_emojis');

    const load = useCallback(async () => {
        const requestId = ++requestIdRef.current;
        setLoading(true);
        setError('');
        try {
            const next = await fetchRows();
            if (requestIdRef.current === requestId) {
                setRows(next);
            }
        } catch (nextError) {
            if (requestIdRef.current === requestId) {
                setRows([]);
                setError(
                    userFacingErrorMessage(nextError, failedMessageRef.current)
                );
            }
        } finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }, [fetchRows]);

    useEffect(() => {
        if (enabled) {
            load();
            return;
        }
        requestIdRef.current += 1;
        setLoading(false);
    }, [enabled, load]);

    return { rows, loading, error, load };
}

function EmojiChoice({
    imageUrl,
    icon,
    label,
    imageOnly = false,
    selected,
    disabled,
    onClick
}: {
    imageUrl?: string;
    icon?: ReactNode;
    label: string;
    imageOnly?: boolean;
    selected: boolean;
    disabled: boolean;
    onClick: () => void;
}) {
    return (
        <TileShell
            selected={selected}
            className={cn(
                'focus-visible:border-ring focus-visible:ring-ring/50 flex flex-col items-center gap-2 bg-clip-padding p-2.5 text-center outline-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50',
                TILE_MOTION_STANDALONE,
                imageOnly && 'aspect-square justify-center p-3'
            )}
            render={
                <button
                    type="button"
                    aria-label={label}
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={onClick}
                />
            }
        >
            {selected ? (
                <span className={cn(TILE_CHECK, TILE_CHECK_ANCHOR)}>
                    <CheckIcon className="size-3" aria-hidden="true" />
                </span>
            ) : null}
            <span
                className={cn(
                    'flex items-center justify-center',
                    imageOnly ? 'size-full' : 'size-16'
                )}
            >
                {icon ?? (
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
                )}
            </span>
            {imageOnly ? null : (
                <span className="w-full truncate text-xs font-medium">
                    {label}
                </span>
            )}
        </TileShell>
    );
}

function EmojiChoiceGrid({
    source,
    rows,
    selected,
    disabled,
    loading = false,
    emptyLabel,
    onSelect,
    onSelectNone
}: {
    source: EmojiSource;
    rows: readonly BoopEmojiChoice[];
    selected: BoopEmojiChoice | null;
    disabled: boolean;
    loading?: boolean;
    emptyLabel: string;
    onSelect: (choice: BoopEmojiChoice) => void;
    onSelectNone?: () => void;
}) {
    const { t } = useTranslation();
    return (
        <TabsContent
            value={source}
            className="bg-muted/20 max-h-[48vh] min-h-0 overflow-y-auto rounded-xl border p-2"
        >
            {loading ? (
                <div className="text-muted-foreground flex h-28 items-center justify-center gap-2 text-sm">
                    <Spinner className="size-4" />
                    {t('view.notification.loading.loading_emojis')}
                </div>
            ) : rows.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                    {onSelectNone ? (
                        <EmojiChoice
                            label={t('dialog.gallery_select.none')}
                            imageOnly
                            selected={selected === null}
                            disabled={disabled}
                            onClick={onSelectNone}
                            icon={
                                <span className="border-muted-foreground/50 text-muted-foreground flex size-12 items-center justify-center rounded-full border-2 border-dashed">
                                    <BanIcon
                                        className="size-5"
                                        aria-hidden="true"
                                    />
                                </span>
                            }
                        />
                    ) : null}
                    {rows.map((choice) => (
                        <EmojiChoice
                            key={`${choice.kind}:${choice.id}`}
                            imageUrl={choice.imageUrl}
                            label={
                                choice.name || t('dialog.gallery_icons.emoji')
                            }
                            imageOnly={!choice.name}
                            selected={isSameBoopEmoji(selected, choice)}
                            disabled={disabled}
                            onClick={() => onSelect(choice)}
                        />
                    ))}
                </div>
            ) : (
                <div className="text-muted-foreground flex h-28 items-center justify-center text-sm">
                    {emptyLabel}
                </div>
            )}
        </TabsContent>
    );
}

const tabTriggerClassName = 'min-w-28 flex-none px-3';

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
    const [choice, setChoice] = useState<BoopEmojiChoice | null>(null);
    const [emojiSource, setEmojiSource] = useState<EmojiSource>('default');
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState('');
    const recent = useEmojiRows(getRecentBoopEmojis, open);
    const custom = useEmojiRows(
        fetchCustomEmojis,
        open && isLocalUserVrcPlusSupporter
    );
    const inventory = useEmojiRows(fetchInventoryEmojis, open);

    useEffect(() => {
        if (open) {
            setChoice(null);
            setSendError('');
        }
    }, [open]);

    useEffect(() => {
        setEmojiSource((current) =>
            recent.rows.length
                ? 'recent'
                : current === 'recent'
                  ? 'default'
                  : current
        );
    }, [recent.rows]);

    const error = sendError || custom.error || inventory.error;
    const refreshable =
        emojiSource === 'custom'
            ? custom
            : emojiSource === 'inventory'
              ? inventory
              : null;

    function toggleChoice(next: BoopEmojiChoice) {
        setChoice((current) => (isSameBoopEmoji(current, next) ? null : next));
    }

    async function handleSend() {
        if (sendDisabled || sending) {
            return;
        }
        setSending(true);
        setSendError('');
        try {
            await onSend(choice);
            onOpenChange(false);
        } catch (nextError) {
            setSendError(
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
                            if (isEmojiSource(value)) {
                                setEmojiSource(value);
                            }
                        }}
                    >
                        <div className="flex min-h-8 items-center justify-between gap-3">
                            <TabsList className="justify-start">
                                {recent.rows.length ? (
                                    <TabsTrigger
                                        value="recent"
                                        className={tabTriggerClassName}
                                    >
                                        {t('dialog.boop_dialog.recent')}
                                    </TabsTrigger>
                                ) : null}
                                <TabsTrigger
                                    value="default"
                                    className={tabTriggerClassName}
                                >
                                    {t('dialog.boop_dialog.default_emojis')}
                                </TabsTrigger>
                                {isLocalUserVrcPlusSupporter ? (
                                    <TabsTrigger
                                        value="custom"
                                        className={tabTriggerClassName}
                                    >
                                        {t('dialog.inventory.custom')}
                                    </TabsTrigger>
                                ) : null}
                                <TabsTrigger
                                    value="inventory"
                                    className={tabTriggerClassName}
                                >
                                    {t('dialog.boop_dialog.inventory_emojis')}
                                </TabsTrigger>
                            </TabsList>
                            {refreshable ? (
                                <HintTooltip
                                    label={t('common.actions.refresh')}
                                >
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon-sm"
                                        disabled={
                                            refreshable.loading || sending
                                        }
                                        onClick={refreshable.load}
                                    >
                                        <RefreshCcwIcon />
                                    </Button>
                                </HintTooltip>
                            ) : null}
                        </div>
                        {recent.rows.length ? (
                            <EmojiChoiceGrid
                                source="recent"
                                rows={recent.rows}
                                selected={choice}
                                disabled={sending}
                                emptyLabel={t('empty_state.search_no_results')}
                                onSelect={toggleChoice}
                                onSelectNone={() => setChoice(null)}
                            />
                        ) : null}
                        <EmojiChoiceGrid
                            source="default"
                            rows={defaultEmojiChoices}
                            selected={choice}
                            disabled={sending}
                            emptyLabel={t('empty_state.search_no_results')}
                            onSelect={toggleChoice}
                            onSelectNone={() => setChoice(null)}
                        />
                        {isLocalUserVrcPlusSupporter ? (
                            <EmojiChoiceGrid
                                source="custom"
                                rows={custom.rows}
                                selected={choice}
                                disabled={sending}
                                loading={custom.loading}
                                emptyLabel={t('empty_state.search_no_results')}
                                onSelect={toggleChoice}
                            />
                        ) : null}
                        <EmojiChoiceGrid
                            source="inventory"
                            rows={inventory.rows}
                            selected={choice}
                            disabled={sending}
                            loading={inventory.loading}
                            emptyLabel={t(
                                'dialog.boop_dialog.no_inventory_emojis'
                            )}
                            onSelect={toggleChoice}
                        />
                    </Tabs>
                    {error ? (
                        <div className="text-destructive text-sm">{error}</div>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        className="sm:mr-auto"
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
                        {sending ? <Spinner data-icon="inline-start" /> : null}
                        {t('dialog.boop_dialog.send')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
