import { Trash2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { FadeInImage } from '@/components/media/FadeInImage';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands, type NoteExportStatus } from '@/platform/tauri/bindings';
import { tauriClient } from '@/platform/tauri/client';
import { openUserDialog } from '@/services/dialogService';
import { userImage } from '@/services/entityMediaService';
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';
import { Textarea } from '@/ui/shadcn/textarea';

import {
    getFriendIds,
    getUserMemoMap,
    normalizeExportMemo,
    truncateExportMemo
} from './toolsDialogUtils';

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
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
}

export function NoteExportDialog({
    open,
    onOpenChange
}: NoteExportDialogProps) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const activeRunIdRef = useRef('');
    const terminalRunIdRef = useRef('');
    const refreshRequestRef = useRef(0);
    const [rows, setRows] = useState<NoteExportRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [errors, setErrors] = useState('');

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
                        ref
                    });
                }
            }
            if (requestId !== refreshRequestRef.current) {
                return;
            }
            setRows(nextRows);
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

    useEffect(() => {
        if (!open) {
            refreshRequestRef.current += 1;
            if (activeRunIdRef.current) {
                void commands.appNoteExportCancel().catch((error: unknown) => {
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
        void (async () => {
            unsubscribe = await tauriClient.events.subscribe<NoteExportStatus>(
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
            refreshRequestRef.current += 1;
        };
    }, [open]);

    async function exportNotes() {
        const snapshot = [...rows].reverse();
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
            applyExportStatus(status);
            applyExportStatus(await commands.appNoteExportStatus());
        } catch (error) {
            setErrors(
                userFacingErrorMessage(
                    error,
                    t('dialog.note_export.failed_to_update_local_note')
                )
            );
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>{t('dialog.note_export.header')}</DialogTitle>
                    <DialogDescription
                        render={
                            <div className="flex flex-col gap-1">
                                {Array.from({ length: 8 }, (_, index) => (
                                    <span
                                        key={`note-export-description-${index + 1}`}
                                    >
                                        {t(
                                            `dialog.note_export.description${index + 1}`
                                        )}
                                    </span>
                                ))}
                            </div>
                        }
                    />
                </DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading}
                        onClick={() => {
                            refreshRows();
                        }}
                    >
                        {t('dialog.note_export.refresh')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading || rows.length === 0}
                        onClick={() => {
                            exportNotes();
                        }}
                    >
                        {t('dialog.note_export.export')}
                    </Button>
                    {loading ? (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                void commands
                                    .appNoteExportCancel()
                                    .then(applyExportStatus)
                                    .catch((error: unknown) => {
                                        toast.error(
                                            userFacingErrorMessage(error)
                                        );
                                    });
                            }}
                        >
                            {t('dialog.note_export.cancel')}
                        </Button>
                    ) : null}
                    {loading ? (
                        <span className="text-muted-foreground text-sm">
                            {t('dialog.note_export.progress')} {progress.done}/
                            {progress.total}
                        </span>
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
                <div className="overflow-hidden rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-16">
                                    {t('table.import.image')}
                                </TableHead>
                                <TableHead>{t('table.import.name')}</TableHead>
                                <TableHead>
                                    {t('dialog.user.info.memo')}
                                </TableHead>
                                <TableHead className="w-20 text-right">
                                    {t('table.import.skip_export')}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.length ? (
                                rows.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell>
                                            {userImage(row.ref, true, '64') ? (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="bg-muted size-10 overflow-hidden rounded-full border p-0"
                                                    aria-label={row.name}
                                                    onClick={() => {
                                                        const fullImageUrl =
                                                            userImage(
                                                                row.ref,
                                                                false,
                                                                '512'
                                                            );
                                                        if (fullImageUrl) {
                                                            openImagePreview({
                                                                url: fullImageUrl,
                                                                title: row.name
                                                            });
                                                        }
                                                    }}
                                                >
                                                    <FadeInImage
                                                        src={userImage(
                                                            row.ref,
                                                            true,
                                                            '64'
                                                        )}
                                                        alt=""
                                                        className="size-full object-cover"
                                                        loading="lazy"
                                                        fallback={
                                                            <span className="bg-muted block size-10 rounded-full border" />
                                                        }
                                                    />
                                                </Button>
                                            ) : (
                                                <span className="bg-muted block size-10 rounded-full border" />
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="hover:text-primary px-0"
                                                onClick={() =>
                                                    openUserDialog({
                                                        userId: row.id,
                                                        title: row.name
                                                    })
                                                }
                                            >
                                                {row.name}
                                            </Button>
                                        </TableCell>
                                        <TableCell>
                                            <Textarea
                                                value={row.memo}
                                                maxLength={256}
                                                rows={2}
                                                disabled={loading}
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
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                type="button"
                                                size="icon"
                                                variant="ghost"
                                                disabled={loading}
                                                onClick={() =>
                                                    setRows((current) =>
                                                        current.filter(
                                                            (item) =>
                                                                item.id !==
                                                                row.id
                                                        )
                                                    )
                                                }
                                            >
                                                <Trash2Icon data-icon="inline-start" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell
                                        colSpan={4}
                                        className="text-muted-foreground h-24 text-center"
                                    >
                                        {loading
                                            ? t('common.loading')
                                            : t(
                                                  'dialog.note_export.no_local_note_differences'
                                              )}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </DialogContent>
        </Dialog>
    );
}
