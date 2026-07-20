import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import groupProfileRepository from '@/repositories/groupProfileRepository';
import { windowDelay } from '@/shared/utils/delays';
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

const IMPORT_INTERVAL_MS = 1000;

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
    const cancelledRef = useRef(false);

    useEffect(() => {
        if (!open) {
            cancelledRef.current = false;
            setInput('');
            setImporting(false);
            setProgress({ current: 0, total: 0 });
            setErrors('');
            setResultMessage('');
        }
    }, [open]);

    async function startImport() {
        const userIds = extractGroupBanUserIds(input);
        if (!userIds.length) {
            setErrors(
                t('dialog.group_member_moderation.import_bans_no_ids_found')
            );
            return;
        }

        setImporting(true);
        cancelledRef.current = false;
        setProgress({ current: 0, total: userIds.length });
        setErrors('');
        setResultMessage('');
        let successCount = 0;

        for (let i = 0; i < userIds.length; i += 1) {
            if (cancelledRef.current) {
                break;
            }
            const userId = userIds[i];
            setProgress({ current: i + 1, total: userIds.length });

            try {
                await groupProfileRepository.banGroupMember({
                    groupId,
                    userId
                });
                successCount += 1;
            } catch (banError) {
                setErrors(
                    (current) =>
                        `${current}${userId}: ${
                            banError instanceof Error
                                ? banError.message
                                : String(banError)
                        }\n`
                );
            }

            if (i < userIds.length - 1 && !cancelledRef.current) {
                await windowDelay(IMPORT_INTERVAL_MS);
            }
        }

        setResultMessage(
            cancelledRef.current
                ? t('dialog.group_member_moderation.import_bans_cancelled', {
                      success: successCount,
                      total: userIds.length
                  })
                : t('dialog.group_member_moderation.import_bans_done', {
                      success: successCount,
                      total: userIds.length
                  })
        );

        setImporting(false);
        setProgress({ current: 0, total: 0 });

        if (successCount > 0) {
            onImported();
        }
    }

    function cancelImport() {
        cancelledRef.current = true;
    }

    const progressPercent = progress.total
        ? Math.min(100, Math.round((progress.current / progress.total) * 100))
        : 0;

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && importing) {
                    cancelImport();
                }
                onOpenChange(nextOpen);
            }}
        >
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
