import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupBanImportStatus } from '@/platform/tauri/bindings';
import {
    cancelGroupBanImport,
    getGroupBanImportStatus,
    isGroupBanImportActive,
    startGroupBanImport,
    subscribeGroupBanImportStatus
} from '@/services/groupBanImportService';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Progress } from '@/ui/shadcn/progress';
import { Spinner } from '@/ui/shadcn/spinner';
import { Textarea } from '@/ui/shadcn/textarea';

import { extractGroupBanUserIds } from './groupModerationBanImport';

export function GroupModerationBanImportDialog({
    open,
    onOpenChange,
    groupId,
    onImported
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    groupId: string;
    onImported: () => void;
}) {
    const { t } = useTranslation();
    const [input, setInput] = useState('');
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [errors, setErrors] = useState('');
    const [resultMessage, setResultMessage] = useState('');
    const runIdRef = useRef<string | null>(null);
    const appliedItemsRef = useRef(0);

    const applyStatus = useEffectEvent((status: GroupBanImportStatus) => {
        if (status.runId !== runIdRef.current) {
            return;
        }
        const active = isGroupBanImportActive(status);
        setProgress({
            current: active
                ? Math.min(status.processed + 1, status.total)
                : status.processed,
            total: status.total
        });
        for (
            let index = appliedItemsRef.current;
            index < status.items.length;
            index += 1
        ) {
            const item = status.items[index];
            if (item.state === 'failed') {
                setErrors(
                    (current) => `${current}${item.userId}: ${item.message}\n`
                );
            }
        }
        appliedItemsRef.current = status.items.length;
        if (active) {
            return;
        }
        runIdRef.current = null;
        setImporting(false);
        setProgress({ current: 0, total: 0 });
        setResultMessage(
            status.status === 'completed'
                ? t('dialog.group_member_moderation.import_bans_done', {
                      success: status.succeeded,
                      total: status.total
                  })
                : t('dialog.group_member_moderation.import_bans_cancelled', {
                      success: status.succeeded,
                      total: status.total
                  })
        );
        if (status.succeeded > 0) {
            onImported();
        }
    });

    useEffect(() => {
        if (!open) {
            runIdRef.current = null;
            appliedItemsRef.current = 0;
            setInput('');
            setImporting(false);
            setProgress({ current: 0, total: 0 });
            setErrors('');
            setResultMessage('');
            return;
        }
        const unsubscribe = subscribeGroupBanImportStatus((status) => {
            applyStatus(status);
        });
        void getGroupBanImportStatus()
            .then((status) => {
                if (
                    !isGroupBanImportActive(status) ||
                    status.groupId !== groupId
                ) {
                    return;
                }
                runIdRef.current = status.runId;
                appliedItemsRef.current = 0;
                setImporting(true);
                setErrors('');
                setResultMessage('');
                applyStatus(status);
            })
            .catch((error: unknown) => {
                console.warn(
                    'Failed to hydrate group ban import status:',
                    error
                );
            });
        return unsubscribe;
    }, [open, groupId]);

    async function startImport() {
        const userIds = extractGroupBanUserIds(input);
        if (!userIds.length) {
            setErrors(
                t('dialog.group_member_moderation.import_bans_no_ids_found')
            );
            return;
        }

        setErrors('');
        setResultMessage('');
        try {
            const status = await startGroupBanImport(groupId, userIds);
            runIdRef.current = status.runId;
            appliedItemsRef.current = 0;
            setImporting(true);
            setProgress({
                current: Math.min(1, status.total),
                total: status.total
            });
        } catch (startError) {
            setErrors(
                startError instanceof Error
                    ? startError.message
                    : String(startError)
            );
        }
    }

    function cancelImport() {
        void cancelGroupBanImport().catch((error: unknown) => {
            console.warn('Failed to cancel group ban import:', error);
        });
    }

    const progressPercent = progress.total
        ? Math.min(100, Math.round((progress.current / progress.total) * 100))
        : 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[min(92vw,40rem)]">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.group_member_moderation.import_bans')}
                    </DialogTitle>
                </DialogHeader>
                <p className="text-muted-foreground mb-2 text-xs">
                    {t(
                        'dialog.group_member_moderation.import_bans_description'
                    )}
                </p>
                <Alert className="mb-2">
                    <AlertDescription>
                        {t(
                            'dialog.group_member_moderation.import_bans_warning'
                        )}
                    </AlertDescription>
                </Alert>
                <Textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    disabled={importing}
                    rows={10}
                    className="mb-2 resize-none"
                    placeholder={t(
                        'dialog.group_member_moderation.import_bans_placeholder'
                    )}
                />
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        size="sm"
                        disabled={!input.trim() || importing}
                        onClick={startImport}
                    >
                        {t('dialog.group_member_moderation.import_bans_start')}
                    </Button>
                    {importing ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={cancelImport}
                        >
                            <Spinner />
                            {t('common.actions.cancel')}
                        </Button>
                    ) : null}
                </div>
                {importing ? (
                    <div className="mt-2">
                        <div className="mb-1 flex justify-between text-sm">
                            <span>
                                {t('dialog.group_member_moderation.progress')}
                            </span>
                            <strong>
                                {progress.current} / {progress.total}
                            </strong>
                        </div>
                        <Progress value={progressPercent} className="h-3" />
                    </div>
                ) : null}
                {errors ? (
                    <>
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="mt-2 self-start"
                            onClick={() => setErrors('')}
                        >
                            {t(
                                'dialog.group_member_moderation.import_bans_clear_errors'
                            )}
                        </Button>
                        <pre className="mt-1.5 text-xs whitespace-pre-wrap">
                            {errors}
                        </pre>
                    </>
                ) : null}
                {resultMessage ? (
                    <span className="text-sm">{resultMessage}</span>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
