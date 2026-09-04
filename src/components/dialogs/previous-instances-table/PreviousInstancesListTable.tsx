import { Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import {
    DATA_TABLE_CONTROL_CELL_CLASS_NAME,
    DATA_TABLE_NUMERIC_CELL_CLASS_NAME,
    DATA_TABLE_NUMERIC_HEADER_CLASS_NAME,
    DataTableCell,
    DataTableHead,
    DataTableHeaderRow,
    DataTableRow
} from '@/components/data-table/DataTableView';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { normalizeLocationText } from '@/components/location/locationModel';
import { StaticLocation } from '@/components/location/StaticLocation';
import { LocationWorld } from '@/components/LocationWorld';
import { formatDateFilterOrFallback } from '@/lib/dateTime';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Table, TableBody, TableHeader } from '@/ui/shadcn/table';

import {
    formatPreviousInstanceCount,
    type PreviousInstanceRow,
    type PreviousInstanceSortKey,
    type PreviousInstanceVariant,
    rowDuration,
    rowLocation,
    rowLocationObject,
    rowOwnerUserId
} from './previousInstancesRows';
import {
    DialogEmptyState,
    InstanceOwnerCell
} from './PreviousInstancesViewParts';

type PreviousInstancesListTableProps<TRow extends PreviousInstanceRow> = {
    className?: string;
    currentEndpoint?: string;
    currentPageIndex: number;
    currentUserId?: string | null;
    filteredRows: readonly TRow[];
    onClose?: (() => void) | null;
    onDeleteRow: (row: TRow) => Promise<void> | void;
    onNextPage: () => void;
    onOpenDetails: (row: TRow) => void;
    onPageSizeChange: (pageSize: number) => void;
    onPreviousPage: () => void;
    onSearchChange: (search: string) => void;
    onSortChange?: ((sortKey: PreviousInstanceSortKey) => void) | null;
    pageSize: number;
    rows: readonly TRow[];
    search: string;
    showHeader: boolean;
    sortDesc: boolean;
    sortKey?: PreviousInstanceSortKey;
    title: string;
    totalPages: number;
    variant: PreviousInstanceVariant;
    visibleRows: readonly TRow[];
};

function renderLocationCell(
    row: PreviousInstanceRow,
    {
        variant,
        currentUserId
    }: {
        variant: PreviousInstanceVariant;
        currentUserId?: string | null;
    }
) {
    const location = rowLocation(row);
    if (variant === 'world') {
        const locationObject = rowLocationObject(row);
        return (
            <LocationWorld
                locationObject={locationObject}
                grouphint={row?.groupName}
                currentUserId={currentUserId}
                worldDialogShortName={normalizeLocationText(
                    locationObject.shortName
                )}
                instanceOwner={
                    locationObject.ownerUserId || locationObject.userId || ''
                }
                instanceOwnerName={normalizeLocationText(
                    locationObject.ownerDisplayName ||
                        row?.ownerDisplayName ||
                        row?.ownerName
                )}
                interactive={false}
                hint={row?.worldName || ''}
                className="max-w-full"
            />
        );
    }
    return (
        <StaticLocation
            location={location}
            hint={row?.worldName || ''}
            disableTooltip
        />
    );
}

export function PreviousInstancesListTable<TRow extends PreviousInstanceRow>({
    title,
    rows,
    filteredRows,
    visibleRows,
    variant,
    showHeader,
    className = '',
    search,
    onSearchChange,
    pageSize,
    onPageSizeChange,
    sortKey = 'date',
    sortDesc,
    onSortChange = null,
    currentPageIndex,
    totalPages,
    onPreviousPage,
    onNextPage,
    onClose,
    currentUserId,
    currentEndpoint,
    onOpenDetails,
    onDeleteRow
}: PreviousInstancesListTableProps<TRow>) {
    const { t } = useTranslation();
    const filteredCountText = formatPreviousInstanceCount(filteredRows.length);
    const totalCountText = formatPreviousInstanceCount(rows.length);

    function changeSort(nextKey: PreviousInstanceSortKey) {
        onSortChange?.(nextKey);
    }

    function sortableHeader(
        label: ReactNode,
        key: PreviousInstanceSortKey,
        className = ''
    ) {
        const active = sortKey === key;
        return (
            <DataTableSortButton
                active={active}
                direction={active ? (sortDesc ? 'desc' : 'asc') : false}
                label={label}
                onSort={() => changeSort(key)}
                className={`px-1 ${className}`}
            />
        );
    }

    return (
        <div
            className={['flex min-h-0 flex-col gap-3', className]
                .filter(Boolean)
                .join(' ')}
        >
            {showHeader ? (
                <div className="min-w-0">
                    <h3 className="text-base font-semibold">{title}</h3>
                    <p className="text-muted-foreground text-sm">
                        {filteredCountText}/{totalCountText}{' '}
                        {t(
                            'dialog.previous_instances.label.recorded_instance_visits'
                        )}
                    </p>
                </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <Input
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder={t(
                            'dialog.previous_instances.search_placeholder'
                        )}
                        className="max-w-sm"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-sm">
                        {t('dialog.previous_instances.label.rows')}
                    </span>
                    <Select
                        value={String(pageSize)}
                        onValueChange={(value) =>
                            onPageSizeChange(
                                Number.parseInt(value ?? '', 10) || 10
                            )
                        }
                    >
                        <SelectTrigger size="sm" className="w-24">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {[10, 25, 50, 100].map((size) => (
                                    <SelectItem key={size} value={String(size)}>
                                        {size}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            {visibleRows.length ? (
                <div className="app-data-table min-h-0 flex-1 overflow-auto rounded-md border">
                    <Table>
                        <TableHeader className="vrcx-0-table-header sticky top-0">
                            <DataTableHeaderRow>
                                <DataTableHead className="w-44">
                                    {sortableHeader(
                                        t('table.previous_instances.date'),
                                        'date'
                                    )}
                                </DataTableHead>
                                <DataTableHead>
                                    {sortableHeader(
                                        t(
                                            'dialog.previous_instances.label.location'
                                        ),
                                        'location'
                                    )}
                                </DataTableHead>
                                <DataTableHead className="w-48">
                                    {t('table.previous_instances.world')} /{' '}
                                    {t('dialog.new_instance.group')}
                                </DataTableHead>
                                <DataTableHead className="w-44">
                                    {sortableHeader(
                                        t(
                                            'table.previous_instances.instance_creator'
                                        ),
                                        'creator'
                                    )}
                                </DataTableHead>
                                <DataTableHead
                                    className={`w-24 ${DATA_TABLE_NUMERIC_HEADER_CLASS_NAME}`}
                                >
                                    {sortableHeader(
                                        t('table.previous_instances.time'),
                                        'duration',
                                        'ml-auto'
                                    )}
                                </DataTableHead>
                                <DataTableHead className="w-64 text-right">
                                    {t('table.previous_instances.action')}
                                </DataTableHead>
                            </DataTableHeaderRow>
                        </TableHeader>
                        <TableBody>
                            {visibleRows.map((row, index) => {
                                const location = rowLocation(row);
                                return (
                                    <DataTableRow
                                        key={`${location}:${row?.id || row?.created_at || row?.createdAt || index}`}
                                    >
                                        <DataTableCell className="text-muted-foreground align-middle text-xs leading-5">
                                            {formatDateFilterOrFallback(
                                                row?.created_at ||
                                                    row?.createdAt,
                                                'long'
                                            )}
                                        </DataTableCell>
                                        <DataTableCell className="relative max-w-[26rem] align-middle text-xs">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="hover:bg-muted absolute inset-0 h-full w-full rounded-none p-0"
                                                onClick={() =>
                                                    onOpenDetails(row)
                                                }
                                            >
                                                <span className="sr-only">
                                                    {t(
                                                        'dialog.previous_instances.description.open_instance_details'
                                                    )}
                                                </span>
                                            </Button>
                                            <div className="pointer-events-none relative z-10 flex max-w-full items-center text-left">
                                                {location
                                                    ? renderLocationCell(row, {
                                                          variant,
                                                          currentUserId
                                                      })
                                                    : '-'}
                                            </div>
                                        </DataTableCell>
                                        <DataTableCell className="text-muted-foreground align-middle text-xs leading-5">
                                            {[row?.worldName, row?.groupName]
                                                .filter(Boolean)
                                                .join(' / ') || '-'}
                                        </DataTableCell>
                                        <DataTableCell className="align-middle text-xs">
                                            <div className="flex items-center">
                                                <InstanceOwnerCell
                                                    userId={rowOwnerUserId(row)}
                                                    endpoint={currentEndpoint}
                                                />
                                            </div>
                                        </DataTableCell>
                                        <DataTableCell
                                            className={`${DATA_TABLE_NUMERIC_CELL_CLASS_NAME} align-middle text-xs`}
                                        >
                                            {rowDuration(row)}
                                        </DataTableCell>
                                        <DataTableCell
                                            className={`${DATA_TABLE_CONTROL_CELL_CLASS_NAME} align-middle`}
                                        >
                                            <div className="flex items-center justify-end gap-2">
                                                <InstanceActionBar
                                                    target={{
                                                        location,
                                                        worldName:
                                                            row?.worldName || ''
                                                    }}
                                                    showRefresh={false}
                                                    showInstanceInfo={false}
                                                />
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() =>
                                                        onOpenDetails(row)
                                                    }
                                                >
                                                    {t(
                                                        'dialog.previous_instances.description.details'
                                                    )}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={!location}
                                                    aria-label={t(
                                                        'common.actions.delete'
                                                    )}
                                                    onClick={() => {
                                                        onDeleteRow(row);
                                                    }}
                                                >
                                                    <Trash2Icon data-icon="inline-start" />
                                                    {t('common.actions.delete')}
                                                </Button>
                                            </div>
                                        </DataTableCell>
                                    </DataTableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            ) : (
                <DialogEmptyState
                    title={t(
                        'dialog.previous_instances.empty.no_instance_records'
                    )}
                    description={
                        search.trim()
                            ? t('empty_state.search_no_results')
                            : undefined
                    }
                    className="min-h-40 flex-none"
                />
            )}
            <div className="flex items-center justify-between">
                <div className="text-muted-foreground text-sm">
                    {t('dialog.previous_instances.label.page')}{' '}
                    {currentPageIndex + 1} / {totalPages}
                </div>
                <div className="flex gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={currentPageIndex <= 0}
                        onClick={onPreviousPage}
                    >
                        {t('table.pagination.previous')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={currentPageIndex >= totalPages - 1}
                        onClick={onNextPage}
                    >
                        {t('table.pagination.next')}
                    </Button>
                    {onClose ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onClose}
                        >
                            {t('common.actions.close')}
                        </Button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
