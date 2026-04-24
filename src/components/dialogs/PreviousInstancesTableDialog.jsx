import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { gameLogRepository } from '@/repositories/index.js';
import { openWorldDialog } from '@/services/dialogService.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    createdTime,
    rowLocation,
    rowSearchText,
    rowWorldId
} from './previous-instances-table/previousInstancesRows.js';
import {
    PreviousInstanceDetailsPanel
} from './previous-instances-table/PreviousInstancesViewParts.jsx';
import { PreviousInstancesListTable } from './previous-instances-table/PreviousInstancesListTable.jsx';
function PreviousInstancesPanel({
    title = 'Instance History',
    instances = [],
    variant = 'world',
    targetRef = null,
    onRowsChange = null,
    onClose = null,
    initialDetailRow = null,
    detailsOnly = false,
    showHeader = true,
    className = ''
}) {
    const { t } = useTranslation();

    const confirm = useModalStore((state) => state.confirm);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [rows, setRows] = useState([]);
    const [search, setSearch] = useState('');
    const [sortDesc, setSortDesc] = useState(true);
    const [pageSize, setPageSize] = useState(10);
    const [pageIndex, setPageIndex] = useState(0);
    const [detailRow, setDetailRow] = useState(initialDetailRow);

    useEffect(() => {
        const nextRows = Array.isArray(instances) ? instances : [];
        setRows(nextRows);
        setPageIndex(0);
        setDetailRow(initialDetailRow || null);
    }, [initialDetailRow, instances]);

    const filteredRows = useMemo(() => {
        const query = search.trim().toLowerCase();
        const nextRows = query
            ? rows.filter((row) => rowSearchText(row).includes(query))
            : rows;
        return [...nextRows].sort((left, right) =>
            sortDesc
                ? createdTime(right) - createdTime(left)
                : createdTime(left) - createdTime(right)
        );
    }, [rows, search, sortDesc]);

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const currentPageIndex = Math.min(pageIndex, totalPages - 1);
    const visibleRows = filteredRows.slice(
        currentPageIndex * pageSize,
        currentPageIndex * pageSize + pageSize
    );

    async function deleteRow(row) {
        const location = rowLocation(row);
        if (!location) {
            return;
        }
        const result = await confirm({
            title: t('dialog.previous_instances_table.generated_modal.delete_instance_record'),
            description: location,
            destructive: true,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        try {
            if (variant === 'user') {
                if (!Array.isArray(row.events) || row.events.length === 0) {
                    toast.error(
                        t('dialog.previous_instances.generated.this_user_instance_row_cannot_be_deleted_without_event_ids')
                    );
                    return;
                }
                await gameLogRepository.deleteGameLogInstance({
                    id: targetRef?.id || '',
                    location,
                    events: row.events
                });
            } else {
                await gameLogRepository.deleteGameLogInstanceByInstanceId({
                    location
                });
            }
            setRows((current) => {
                const nextRows = current.filter((item) => item !== row);
                onRowsChange?.(nextRows);
                return nextRows;
            });
            setDetailRow((current) => (current === row ? null : current));
            toast.success(t('dialog.previous_instances.generated.instance_record_deleted'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.previous_instances_table.generated_toast.failed_to_delete_instance_record')
            );
        }
    }

    function openLocation(row) {
        const worldId = rowWorldId(row);
        if (!worldId) {
            return;
        }
        openWorldDialog({ worldId, title: row?.worldName || undefined });
        onClose?.();
    }

    if (detailsOnly || detailRow) {
        return (
            <PreviousInstanceDetailsPanel
                row={detailRow}
                onBack={detailsOnly ? null : () => setDetailRow(null)}
                showTitle={!detailsOnly}
                className={className}
            />
        );
    }

    return (
        <PreviousInstancesListTable
            title={title}
            rows={rows}
            filteredRows={filteredRows}
            visibleRows={visibleRows}
            variant={variant}
            showHeader={showHeader}
            className={className}
            search={search}
            onSearchChange={(value) => {
                setSearch(value);
                setPageIndex(0);
            }}
            pageSize={pageSize}
            onPageSizeChange={(value) => {
                setPageSize(value);
                setPageIndex(0);
            }}
            sortDesc={sortDesc}
            onSortDescChange={() => setSortDesc((value) => !value)}
            currentPageIndex={currentPageIndex}
            totalPages={totalPages}
            onPreviousPage={() =>
                setPageIndex((value) => Math.max(0, value - 1))
            }
            onNextPage={() =>
                setPageIndex((value) =>
                    Math.min(totalPages - 1, value + 1)
                )
            }
            onClose={onClose}
            currentUserId={currentUserId}
            currentEndpoint={currentEndpoint}
            onOpenLocation={openLocation}
            onOpenDetails={setDetailRow}
            onDeleteRow={deleteRow}
        />
    );
}

function PreviousInstancesTableDialog({
    open,
    onOpenChange,
    title = 'Instance History',
    instances = [],
    variant = 'world',
    targetRef = null,
    onRowsChange = null,
    detailsOnly = false
}) {
    const initialDetailRow =
        detailsOnly && Array.isArray(instances) ? instances[0] || null : null;
    const dialogTitle = detailsOnly ? 'Instance Details' : title;
    const dialogDescription = detailsOnly
        ? rowLocation(initialDetailRow) || 'Instance details'
        : `${Array.isArray(instances) ? instances.length : 0} recorded instance visits.`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] max-w-[min(92vw,72rem)] flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle>{dialogTitle}</DialogTitle>
                    <DialogDescription>{dialogDescription}</DialogDescription>
                </DialogHeader>
                <PreviousInstancesPanel
                    title={title}
                    instances={instances}
                    variant={variant}
                    targetRef={targetRef}
                    onRowsChange={onRowsChange}
                    onClose={() => onOpenChange?.(false)}
                    initialDetailRow={initialDetailRow}
                    detailsOnly={detailsOnly}
                    showHeader={false}
                    className="flex-1"
                />
            </DialogContent>
        </Dialog>
    );
}

export {
    PreviousInstanceDetailsPanel,
    PreviousInstancesPanel,
    PreviousInstancesTableDialog
};
