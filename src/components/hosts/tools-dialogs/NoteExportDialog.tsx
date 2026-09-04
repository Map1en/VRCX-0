import {
    InboxIcon,
    LoaderCircleIcon,
    RefreshCwIcon,
    RotateCcwIcon,
    TriangleAlertIcon,
    XIcon
} from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { FadeInImage } from '@/components/media/FadeInImage';
import type { FriendRosterById } from '@/domain/friends/types';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { commands, type NoteExportStatus } from '@/platform/tauri/bindings';
import { openUserDialog } from '@/services/dialogService';
import { userImage } from '@/services/entityMediaService';
import { subscribeRuntimeEvent } from '@/services/runtime-event-bridge/subscription';
import { isRecord } from '@/shared/utils/record';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { Alert, AlertAction, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Progress } from '@/ui/shadcn/progress';
import { Textarea } from '@/ui/shadcn/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    getFriendIds,
    getUserMemoMap,
    normalizeExportMemo,
    truncateExportMemo
} from './toolsDialogUtils';

const NOTE_CHAR_LIMIT = 256;
const NOTE_CHAR_WARN = 230;
const LIMITATION_KEYS = [3, 4, 5, 6, 7, 8];
const EMPTY_FRIENDS: FriendRosterById = {};
const EMPTY_FRIEND_IDS: string[] = [];

type NoteExportRow = {
    id: string;
    name: string;
    memo: string;
    ref: Record<string, unknown>;
};

type NoteExportDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

function asObjectRecord(value: unknown): Record<string, unknown> | null {
    return isRecord(value) ? value : null;
}

function memoCounterClass(length: number) {
    if (length >= NOTE_CHAR_LIMIT) {
        return 'text-destructive';
    }
    if (length >= NOTE_CHAR_WARN) {
        return 'text-amber-500';
    }
    return 'text-muted-foreground/60';
}

export function NoteExportDialog({
    open,
    onOpenChange
}: NoteExportDialogProps) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) =>
        open ? state.friendsById : EMPTY_FRIENDS
    );
    const orderedFriendIds = useFriendRosterStore((state) =>
        open ? state.orderedFriendIds : EMPTY_FRIEND_IDS
    );
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const activeRunIdRef = useRef('');
    const terminalRunIdRef = useRef('');
    const sessionRef = useRef(0);
    const refreshRequestRef = useRef(0);
    const [rows, setRows] = useState<NoteExportRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [errors, setErrors] = useState('');
    const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());

    function toggleSkip(id: string) {
        setSkippedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    async function refreshRows() {
        const requestId = refreshRequestRef.current + 1;
        refreshRequestRef.current = requestId;
        setLoading(true);
        setErrors('');
        try {
            const memosById = await getUserMemoMap();
            const nextRows: NoteExportRow[] = [];
            for (const userId of getFriendIds(orderedFriendIds)) {
                const friend = friendsById[userId];
                const ref = asObjectRecord(friend?.ref) || friend;
                const memo = normalizeExportMemo(
                    memosById.get(userId) || friend?.memo || ''
                );
                const vrchatNote = ref.note ?? friend?.note ?? '';
                if (memo && friend && vrchatNote !== truncateExportMemo(memo)) {
                    nextRows.push({
                        id: userId,
                        name: friend.displayName || friend.name || userId,
                        memo,
                        ref: {
                            userIcon: ref.userIcon,
                            profilePicOverrideThumbnail:
                                ref.profilePicOverrideThumbnail,
                            profilePicOverride: ref.profilePicOverride,
                            thumbnailUrl: ref.thumbnailUrl,
                            currentAvatarThumbnailImageUrl:
                                ref.currentAvatarThumbnailImageUrl,
                            currentAvatarImageUrl: ref.currentAvatarImageUrl,
                            note: ref.note
                        }
                    });
                }
            }
            if (requestId !== refreshRequestRef.current) {
                return;
            }
            setRows(nextRows);
            setSkippedIds(new Set());
        } catch (error) {
            if (requestId !== refreshRequestRef.current) {
                return;
            }
            toast.error(
                userFacingErrorMessage(
                    error,
                    t(
                        'host.tools_dialogs.toast.failed_to_load_memo_export_rows'
                    )
                )
            );
        } finally {
            if (requestId === refreshRequestRef.current) {
                setLoading(false);
            }
        }
    }

    function applyExportStatus(status: NoteExportStatus) {
        const active =
            status.status === 'running' || status.status === 'cancelling';
        if (active && terminalRunIdRef.current === status.runId) {
            return;
        }
        if (!activeRunIdRef.current && status.runId) {
            activeRunIdRef.current = status.runId;
        }
        if (activeRunIdRef.current !== status.runId) {
            return;
        }

        const succeededIds = new Set(
            status.items
                .filter((item) => item.state === 'succeeded')
                .map((item) => item.userId)
        );
        setRows((current) => {
            if (current.length) {
                return current.filter((item) => !succeededIds.has(item.id));
            }
            return status.items
                .filter((item) => item.state !== 'succeeded')
                .map((item) => ({
                    id: item.userId,
                    name: item.displayName || item.userId,
                    memo: item.note,
                    ref: {}
                }));
        });
        setProgress({ done: status.processed, total: status.total });
        setLoading(active);

        const failedItem = status.items.find((item) => item.state === 'failed');
        if (failedItem) {
            setErrors(
                `Name: ${failedItem.displayName || failedItem.userId}\n${failedItem.error || status.lastError || t('dialog.note_export.failed_to_update_local_note')}\n\n`
            );
        }
        if (!active) {
            terminalRunIdRef.current = status.runId;
            activeRunIdRef.current = '';
        }
    }

    const initializeExportDialog = useEffectEvent(() => {
        if (!open) {
            refreshRequestRef.current += 1;
            if (activeRunIdRef.current) {
                void commands.appNoteExportCancel().catch((error) => {
                    console.warn('Failed to cancel note export:', error);
                });
            }
            return;
        }

        let disposed = false;
        let unsubscribe: (() => void) | null = null;
        activeRunIdRef.current = '';
        terminalRunIdRef.current = '';
        setRows([]);
        setProgress({ done: 0, total: 0 });
        setErrors('');
        setSkippedIds(new Set());
        void (async () => {
            unsubscribe = await subscribeRuntimeEvent(
                'noteExportStatus',
                (status) => {
                    if (!disposed) {
                        applyExportStatus(status);
                    }
                }
            );
            const status = await commands.appNoteExportStatus();
            if (disposed) {
                return;
            }
            if (status.status === 'running' || status.status === 'cancelling') {
                applyExportStatus(status);
            } else {
                await refreshRows();
            }
        })().catch((error: unknown) => {
            if (!disposed) {
                toast.error(userFacingErrorMessage(error));
                setLoading(false);
            }
        });

        return () => {
            disposed = true;
            unsubscribe?.();
            sessionRef.current += 1;
            refreshRequestRef.current += 1;
        };
    });

    useEffect(() => initializeExportDialog(), [open]);

    async function exportNotes() {
        const sessionId = sessionRef.current;
        const snapshot = [...rows]
            .reverse()
            .filter((row) => !skippedIds.has(row.id));
        if (snapshot.length === 0) {
            return;
        }
        setLoading(true);
        setProgress({ done: 0, total: snapshot.length });
        setErrors('');
        terminalRunIdRef.current = '';
        try {
            const status = await commands.appNoteExportStart({
                items: snapshot.map((row) => ({
                    userId: row.id,
                    displayName: row.name,
                    note: truncateExportMemo(row.memo)
                }))
            });
            if (sessionId !== sessionRef.current) {
                return;
            }
            applyExportStatus(status);
            const latestStatus = await commands.appNoteExportStatus();
            if (sessionId === sessionRef.current) {
                applyExportStatus(latestStatus);
            }
        } catch (error) {
            if (sessionId !== sessionRef.current) {
                return;
            }
            setErrors(
                userFacingErrorMessage(
                    error,
                    t('dialog.note_export.failed_to_update_local_note')
                )
            );
            setLoading(false);
        }
    }

    async function cancelExport() {
        const sessionId = sessionRef.current;
        try {
            const status = await commands.appNoteExportCancel();
            if (sessionId === sessionRef.current) {
                applyExportStatus(status);
            }
        } catch (error) {
            toast.error(userFacingErrorMessage(error));
        }
    }

    const progressPercent =
        progress.total > 0
            ? Math.round((progress.done / progress.total) * 100)
            : 0;
    const includedCount = rows.reduce(
        (count, row) => (skippedIds.has(row.id) ? count : count + 1),
        0
    );

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            onOpenChangeComplete={(nextOpen) => {
                if (!nextOpen && !open) {
                    setRows([]);
                    setErrors('');
                    setSkippedIds(new Set());
                }
            }}
        >
            <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{t('dialog.note_export.header')}</DialogTitle>
                    <DialogDescription>
                        {t('dialog.note_export.description1')}
                    </DialogDescription>
                </DialogHeader>

                <div className="bg-muted/40 rounded-lg border p-3">
                    <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                        <TriangleAlertIcon className="size-3.5 shrink-0" />
                        <span>{t('dialog.note_export.description2')}</span>
                    </div>
                    <ul className="mt-2 grid gap-x-5 gap-y-1 sm:grid-cols-2">
                        {LIMITATION_KEYS.map((key) => (
                            <li
                                key={`note-export-limitation-${key}`}
                                className="text-muted-foreground/80 flex gap-1.5 text-xs leading-snug"
                            >
                                <span
                                    aria-hidden
                                    className="text-muted-foreground/40 mt-px select-none"
                                >
                                    &bull;
                                </span>
                                <span className="min-w-0">
                                    {t(
                                        `dialog.note_export.description${key}`
                                    ).replace(/^[-•]\s*/, '')}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        disabled={loading || includedCount === 0}
                        onClick={() => {
                            exportNotes();
                        }}
                    >
                        {t('dialog.note_export.export')}
                        {includedCount > 0 ? (
                            <span className="bg-primary-foreground/20 ml-1.5 rounded-full px-1.5 text-xs tabular-nums">
                                {includedCount}
                            </span>
                        ) : null}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading}
                        onClick={() => {
                            refreshRows();
                        }}
                    >
                        <RefreshCwIcon data-icon="inline-start" />
                        {t('dialog.note_export.refresh')}
                    </Button>
                    {loading ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    void cancelExport();
                                }}
                            >
                                {t('dialog.note_export.cancel')}
                            </Button>
                            <div className="flex min-w-40 flex-1 items-center gap-2">
                                <Progress
                                    value={progressPercent}
                                    className="flex-1"
                                />
                                <span className="text-muted-foreground text-xs tabular-nums">
                                    {progress.done}/{progress.total}
                                </span>
                            </div>
                        </>
                    ) : null}
                </div>

                {errors ? (
                    <Alert variant="destructive">
                        <AlertDescription>
                            <pre className="text-xs whitespace-pre-wrap">
                                {errors}
                            </pre>
                        </AlertDescription>
                        <AlertAction>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setErrors('')}
                            >
                                {t('dialog.note_export.clear_errors')}
                            </Button>
                        </AlertAction>
                    </Alert>
                ) : null}

                <div className="-mr-1 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {rows.length ? (
                        rows.map((row) => {
                            const memoLength = row.memo.length;
                            const fullImageUrl = userImage(
                                row.ref,
                                false,
                                '512'
                            );
                            const thumbUrl = userImage(row.ref, true, '64');
                            const skipped = skippedIds.has(row.id);
                            const remoteNote =
                                typeof row.ref.note === 'string'
                                    ? row.ref.note.trim()
                                    : '';
                            return (
                                <div
                                    key={row.id}
                                    className={cn(
                                        'bg-card/40 flex gap-3 rounded-lg border p-3 transition-colors',
                                        skipped ? 'opacity-55' : 'hover:bg-card'
                                    )}
                                >
                                    {thumbUrl ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="bg-muted size-11 shrink-0 overflow-hidden rounded-full border p-0"
                                            aria-label={row.name}
                                            onClick={() => {
                                                if (fullImageUrl) {
                                                    openImagePreview({
                                                        url: fullImageUrl,
                                                        title: row.name
                                                    });
                                                }
                                            }}
                                        >
                                            <FadeInImage
                                                src={thumbUrl}
                                                alt=""
                                                className="size-full object-cover"
                                                loading="lazy"
                                                fallback={
                                                    <span className="bg-muted block size-11 rounded-full" />
                                                }
                                            />
                                        </Button>
                                    ) : (
                                        <span className="bg-muted size-11 shrink-0 rounded-full border" />
                                    )}
                                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="hover:text-primary h-auto min-w-0 justify-start truncate p-0 font-medium"
                                                onClick={() =>
                                                    openUserDialog({
                                                        userId: row.id,
                                                        title: row.name
                                                    })
                                                }
                                            >
                                                {row.name}
                                            </Button>
                                            <Tooltip>
                                                <TooltipTrigger
                                                    render={
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="ghost"
                                                            disabled={loading}
                                                            aria-label={t(
                                                                skipped
                                                                    ? 'dialog.note_export.include'
                                                                    : 'table.import.skip_export'
                                                            )}
                                                            className={cn(
                                                                'shrink-0',
                                                                skipped
                                                                    ? 'text-primary'
                                                                    : 'text-muted-foreground hover:text-destructive'
                                                            )}
                                                            onClick={() =>
                                                                toggleSkip(
                                                                    row.id
                                                                )
                                                            }
                                                        >
                                                            {skipped ? (
                                                                <RotateCcwIcon data-icon="inline-start" />
                                                            ) : (
                                                                <XIcon data-icon="inline-start" />
                                                            )}
                                                        </Button>
                                                    }
                                                />
                                                <TooltipContent>
                                                    {t(
                                                        skipped
                                                            ? 'dialog.note_export.include'
                                                            : 'table.import.skip_export'
                                                    )}
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                        {remoteNote ? (
                                            <div className="border-destructive/25 bg-destructive/5 flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-1.5">
                                                <span className="text-destructive/70 shrink-0 leading-5 font-semibold">
                                                    &minus;
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-destructive/70 text-[10px] font-semibold tracking-wide uppercase">
                                                        {t(
                                                            'dialog.note_export.current_note'
                                                        )}
                                                    </div>
                                                    <div
                                                        className="text-destructive/90 truncate text-xs line-through"
                                                        title={remoteNote}
                                                    >
                                                        {remoteNote}
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}
                                        <Textarea
                                            value={row.memo}
                                            maxLength={NOTE_CHAR_LIMIT}
                                            rows={2}
                                            disabled={loading || skipped}
                                            onChange={(event) =>
                                                setRows((current) =>
                                                    current.map((item) =>
                                                        item.id === row.id
                                                            ? {
                                                                  ...item,
                                                                  memo: normalizeExportMemo(
                                                                      event
                                                                          .target
                                                                          .value
                                                                  )
                                                              }
                                                            : item
                                                    )
                                                )
                                            }
                                        />
                                        <span
                                            className={cn(
                                                'self-end text-[11px] tabular-nums',
                                                memoCounterClass(memoLength)
                                            )}
                                        >
                                            {memoLength}/{NOTE_CHAR_LIMIT}
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-2 text-sm">
                            {loading ? (
                                <>
                                    <LoaderCircleIcon className="size-5 animate-spin opacity-60" />
                                    <span>{t('common.loading')}</span>
                                </>
                            ) : (
                                <>
                                    <InboxIcon className="size-6 opacity-40" />
                                    <span>
                                        {t(
                                            'dialog.note_export.no_local_note_differences'
                                        )}
                                    </span>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
