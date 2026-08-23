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
    type PreviousInstanceRow,
    type PreviousInstanceSortKey,
    type PreviousInstanceVariant,
    rowLocation,
    rowMatchesSearch,
    sortPreviousInstanceRows
} from './previous-instances-table/previousInstancesRows';
import {
    instanceDetailsSummary,
    PreviousInstanceDetailsPanel
} from './previous-instances-table/PreviousInstancesViewParts';

type PreviousInstancesPanelProps<TRow extends PreviousInstanceRow> = {
    className?: string;
    detailsOnly?: boolean;
    initialDetailRow?: TRow | null;
    instances?: TRow[];
    onClose?: (() => void) | null;
    onRowsChange?: ((rows: TRow[]) => void) | null;
    showHeader?: boolean;
    title?: string;
    variant?: PreviousInstanceVariant;
};

type PreviousInstancesTableDialogProps<TRow extends PreviousInstanceRow> = {
    detailsOnly?: boolean;
    instances?: TRow[];
    onOpenChange: (open: boolean) => void;
    onRowsChange?: ((rows: TRow[]) => void) | null;
    open: boolean;
    title?: string;
    variant?: PreviousInstanceVariant;
};

function PreviousInstancesPanel<TRow extends PreviousInstanceRow>({
    title = 'Instance History',
    instances = [],
    variant = 'world',
    onRowsChange = null,
    onClose = null,
    initialDetailRow = null,
    detailsOnly = false,
    showHeader = true,
    className = ''
}: PreviousInstancesPanelProps<TRow>) {
    const { t } = useTranslation();

    const confirm = useModalStore((state) => state.confirm);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [rows, setRows] = useState<TRow[]>([]);
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<PreviousInstanceSortKey>('date');
    const [sortDesc, setSortDesc] = useState(true);
    const [pageSize, setPageSize] = useState(10);
    const [pageIndex, setPageIndex] = useState(0);
    const [detailRow, setDetailRow] = useState(initialDetailRow);

    useEffect(() => {
        setRows(instances);
        setPageIndex(0);
        setDetailRow(initialDetailRow || null);
    }, [initialDetailRow, instances]);

    const filteredRows = useMemo(() => {
        const query = search.trim();
        const nextRows = query
            ? rows.filter((row) => rowMatchesSearch(row, query))
            : rows;
        return sortPreviousInstanceRows(nextRows, sortKey, sortDesc);
    }, [rows, search, sortDesc, sortKey]);

    function changeSort(nextKey: PreviousInstanceSortKey) {
        if (nextKey === sortKey) {
            if (!sortDesc) {
                setSortKey('');
                setSortDesc(true);
                return;
            }
            setSortDesc((value) => !value);
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

    async function deleteRow(row: TRow) {
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
            await gameLogRepository.deleteGameLogInstanceByInstanceId({
                location
            });
            setRows((current) => {
                const nextRows = current.filter((item) => item !== row);
                onRowsChange?.(nextRows);
                return nextRows;
            });
            setDetailRow((current) => (current === row ? null : current));
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
            onSearchChange={(value) => {
                setSearch(value);
                setPageIndex(0);
            }}
            pageSize={pageSize}
            onPageSizeChange={(value) => {
                setPageSize(value);
                setPageIndex(0);
            }}
            sortKey={sortKey}
            sortDesc={sortDesc}
            onSortChange={changeSort}
            currentPageIndex={currentPageIndex}
            totalPages={totalPages}
            onPreviousPage={() =>
                setPageIndex((value) => Math.max(0, value - 1))
            }
            onNextPage={() =>
                setPageIndex((value) => Math.min(totalPages - 1, value + 1))
            }
            onClose={onClose}
            currentUserId={currentUserId}
            currentEndpoint={currentEndpoint}
            onOpenDetails={setDetailRow}
            onDeleteRow={deleteRow}
        />
    );
}

function PreviousInstancesTableDialog<TRow extends PreviousInstanceRow>({
    open,
    onOpenChange,
    title = 'Instance History',
    instances = [],
    variant = 'world',
    onRowsChange = null,
    detailsOnly = false
}: PreviousInstancesTableDialogProps<TRow>) {
    const { t } = useTranslation();
    const initialDetailRow = detailsOnly ? instances[0] || null : null;
    const instanceCountText = formatPreviousInstanceCount(instances.length);
    const dialogTitle = detailsOnly
        ? t('dialog.previous_instances.info')
        : title;
    const dialogDescription = detailsOnly
        ? instanceDetailsSummary(initialDetailRow, t)
        : t('dialog.previous_instances.label.recorded_instance_visits_count', {
              count: instanceCountText
          });

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
                    onRowsChange={onRowsChange}
                    onClose={() => onOpenChange(false)}
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
