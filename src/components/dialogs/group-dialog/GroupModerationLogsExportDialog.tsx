import { CopyIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { copyTextToClipboard } from '@/services/clipboardService';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Textarea } from '@/ui/shadcn/textarea';

import {
    buildGroupAuditLogCsv,
    GROUP_AUDIT_LOG_EXPORT_COLUMNS
} from './groupModerationCsv';
import type { GroupAuditLogRow } from './GroupModerationLogsPanel';

const DEFAULT_EXPORT_COLUMNS = GROUP_AUDIT_LOG_EXPORT_COLUMNS.map(
    (column) => column.key
);

export function GroupModerationLogsExportDialog({
    open,
    onOpenChange,
    rows
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    rows: GroupAuditLogRow[];
}) {
    const { t } = useTranslation();
    const [selectedColumns, setSelectedColumns] = useState<string[]>(
        DEFAULT_EXPORT_COLUMNS
    );

    useEffect(() => {
        if (open) {
            setSelectedColumns(DEFAULT_EXPORT_COLUMNS);
        }
    }, [open]);

    const content = useMemo(
        () => buildGroupAuditLogCsv(rows, selectedColumns),
        [rows, selectedColumns]
    );

    function toggleColumn(key: string, checked: boolean) {
        setSelectedColumns((current) => {
            const next = new Set(current);
            if (checked) {
                next.add(key);
            } else {
                next.delete(key);
            }
            return DEFAULT_EXPORT_COLUMNS.filter((columnKey) =>
                next.has(columnKey)
            );
        });
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[min(92vw,40rem)]">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.group_member_moderation.export_logs')}
                    </DialogTitle>
                </DialogHeader>
                <div className="mb-2 flex flex-col gap-2">
                    {GROUP_AUDIT_LOG_EXPORT_COLUMNS.map((column) => (
                        <label
                            key={column.key}
                            className="inline-flex items-center gap-2 text-sm"
                        >
                            <Checkbox
                                checked={selectedColumns.includes(column.key)}
                                onCheckedChange={(checked) =>
                                    toggleColumn(column.key, Boolean(checked))
                                }
                            />
                            <span>{t(column.labelKey)}</span>
                        </label>
                    ))}
                </div>
                <Textarea
                    value={content}
                    readOnly
                    rows={12}
                    className="resize-none font-mono text-xs"
                />
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 self-start"
                    disabled={!content}
                    onClick={() =>
                        copyTextToClipboard(content, {
                            successMessage: t(
                                'dialog.group_member_moderation.export_logs_copied'
                            ),
                            errorMessage: (error) =>
                                error instanceof Error
                                    ? error.message
                                    : t('dialog.group.toast.value_failed', {
                                          value: t(
                                              'dialog.group_member_moderation.export_logs'
                                          )
                                      })
                        })
                    }
                >
                    <CopyIcon data-icon="inline-start" />
                    {t('common.actions.copy')}
                </Button>
            </DialogContent>
        </Dialog>
    );
}
