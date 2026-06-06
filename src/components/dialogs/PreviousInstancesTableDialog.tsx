import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import gameLogRepository from '@/repositories/gameLogRepository';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

import { PreviousInstancesListTable } from './previous-instances-table/PreviousInstancesListTable';
import {
    formatPreviousInstanceCount,
    rowLocation,
    rowSearchText,
    sortPreviousInstanceRows
} from './previous-instances-table/previousInstancesRows';
import { PreviousInstanceDetailsPanel } from './previous-instances-table/PreviousInstancesViewParts';

function instanceDialogDescription(row: any, t: any) {
    const parts = [row?.worldName, row?.groupName].filter(Boolean);
    return parts.length
        ? parts.join(' / ')
        : t('dialog.previous_instances.description.instance_details');
}

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
    headerActions = null,
    className = ''
}: any) {
    const { t } = useTranslation();

    const confirm = useModalStore((state: any) => state.confirm);
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state: any) => state.auth.currentUserId);
    const [rows, setRows] = useState<any[]>([]);
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState('date');
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
            ? rows.filter((row: any) => rowSearchText(row).includes(query))
            : rows;
        return sortPreviousInstanceRows(nextRows, sortKey, sortDesc);
    }, [rows, search, sortDesc, sortKey]);

    function changeSort(nextKey: any) {
        if (nextKey === sortKey) {
            if (!sortDesc) {
                setSortKey('');
                setSortDesc(true);
                return;
            }
            setSortDesc((value: any) => !value);
            return;
        }
        setSortKey(nextKey);
        setSortDesc(nextKey === 'date');
    }

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const currentPageIndex = Math.min(pageIndex, totalPages - 1);
    const visibleRows = filteredRows.slice(
        currentPageIndex * pageSize,
        currentPageIndex * pageSize + pageSize
    );

    async function deleteRow(row: any) {
        const location = rowLocation(row);
        if (!location) {
            return;
        }
        const result = await confirm({
            title: t(
                'dialog.previous_instances_table.modal.delete_instance_record'
            ),
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
                        t(
                            'dialog.previous_instances.error.this_user_instance_row_cannot_be_deleted_without_event_ids'
                        )
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
            setRows((current: any) => {
                const nextRows = current.filter((item: any) => item !== row);
                onRowsChange?.(nextRows);
                return nextRows;
            });
            setDetailRow((current: any) => (current === row ? null : current));
            toast.success(
                t('dialog.previous_instances.success.instance_record_deleted')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.previous_instances_table.toast.failed_to_delete_instance_record'
                      )
            );
        }
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
            onSearchChange={(value: any) => {
                setSearch(value);
                setPageIndex(0);
            }}
            pageSize={pageSize}
            onPageSizeChange={(value: any) => {
                setPageSize(value);
                setPageIndex(0);
            }}
            sortKey={sortKey}
            sortDesc={sortDesc}
            onSortChange={changeSort}
            currentPageIndex={currentPageIndex}
            totalPages={totalPages}
            onPreviousPage={() =>
                setPageIndex((value: any) => Math.max(0, value - 1))
            }
            onNextPage={() =>
                setPageIndex((value: any) => Math.min(totalPages - 1, value + 1))
            }
            onClose={onClose}
            currentUserId={currentUserId}
            currentEndpoint={currentEndpoint}
            onOpenDetails={setDetailRow}
            onDeleteRow={deleteRow}
            headerActions={headerActions}
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
}: any) {
    const { t } = useTranslation();
    const initialDetailRow =
        detailsOnly && Array.isArray(instances) ? instances[0] || null : null;
    const instanceCountText = formatPreviousInstanceCount(
        Array.isArray(instances) ? instances.length : 0
    );
    const dialogTitle = detailsOnly
        ? t('dialog.previous_instances.info')
        : title;
    const dialogDescription = detailsOnly
        ? instanceDialogDescription(initialDetailRow, t)
        : t(
              'dialog.previous_instances.label.recorded_instance_visits_count',
              {
                  count: instanceCountText
              }
          );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-[min(92vw,72rem)]">
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
