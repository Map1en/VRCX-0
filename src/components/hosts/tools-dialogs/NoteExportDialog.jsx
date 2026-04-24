import { Trash2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { userImage } from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { toolsRepository } from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
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
    delay,
    getEndpoint,
    getFriendIds,
    getUserMemoMap,
    normalizeExportMemo,
    truncateExportMemo
} from './toolsDialogUtils.js';

export function NoteExportDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const cancelRef = useRef(false);
    const refreshRequestRef = useRef(0);
    const [rows, setRows] = useState([]);
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
            const nextRows = [];
            for (const userId of getFriendIds(orderedFriendIds)) {
                const friend = friendsById[userId];
                const memo = normalizeExportMemo(
                    memosById.get(userId) || friend?.memo || ''
                );
                const vrchatNote = friend?.ref?.note ?? friend?.note ?? '';
                if (memo && friend && vrchatNote !== truncateExportMemo(memo)) {
                    nextRows.push({
                        id: userId,
                        name: friend.displayName || friend.name || userId,
                        memo,
                        ref: friend.ref || friend
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
                    t('host.tools_dialogs.generated_toast.failed_to_load_memo_export_rows')
                )
            );
        } finally {
            if (requestId === refreshRequestRef.current) {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        if (open) {
            cancelRef.current = false;
            setRows([]);
            setProgress({ done: 0, total: 0 });
            setErrors('');
            void refreshRows();
        } else {
            cancelRef.current = true;
            refreshRequestRef.current += 1;
        }
    }, [open]);

    async function exportNotes() {
        const snapshot = [...rows].reverse();
        cancelRef.current = false;
        setLoading(true);
        setProgress({ done: 0, total: snapshot.length });
        setErrors('');
        try {
            for (let index = 0; index < snapshot.length; index += 1) {
                if (cancelRef.current) {
                    break;
                }
                const row = snapshot[index];
                try {
                    await toolsRepository.saveUserNote(
                        {
                            targetUserId: row.id,
                            note: truncateExportMemo(row.memo)
                        },
                        { endpoint: getEndpoint() }
                    );
                    setRows((current) =>
                        current.filter((item) => item.id !== row.id)
                    );
                    setProgress({ done: index + 1, total: snapshot.length });
                    if (index < snapshot.length - 1) {
                        await delay(5000);
                    }
                } catch (error) {
                    setErrors(
                        (current) =>
                            `${current}Name: ${row.name}\n${userFacingErrorMessage(error, 'Failed to update memo.')}\n\n`
                    );
                    break;
                }
            }
        } finally {
            setLoading(false);
            setProgress({ done: 0, total: 0 });
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>{t('dialog.note_export.header')}</DialogTitle>
                    <DialogDescription asChild>
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
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading}
                        onClick={() => void refreshRows()}
                    >
                        {t('dialog.note_export.refresh')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading || rows.length === 0}
                        onClick={() => void exportNotes()}
                    >
                        {t('dialog.note_export.export')}
                    </Button>
                    {loading ? (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                cancelRef.current = true;
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
                                <TableHead>{t('table.import.note')}</TableHead>
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
                                                    <img
                                                        src={userImage(
                                                            row.ref,
                                                            true,
                                                            '64'
                                                        )}
                                                        alt=""
                                                        className="size-full object-cover"
                                                        loading="lazy"
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
                                            ? 'Loading.'
                                            : 'No memo differences found.'}
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
