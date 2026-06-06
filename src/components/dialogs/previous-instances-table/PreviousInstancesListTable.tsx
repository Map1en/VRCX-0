import { Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { Location } from '@/components/Location';
import { LocationWorld } from '@/components/LocationWorld';
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';

import {
    formatPreviousInstanceCount,
    rowDuration,
    rowLocation,
    rowLocationObject,
    rowOwnerUserId
} from './previousInstancesRows';
import {
    DialogEmptyState,
    InstanceOwnerCell,
    formatDate
} from './PreviousInstancesViewParts';

function renderLocationCell(row: any, { variant, currentUserId }: any) {
    const location = rowLocation(row);
    if (variant === 'world') {
        const locationObject = rowLocationObject(row);
        return (
            <LocationWorld
                locationObject={locationObject}
                grouphint={row?.groupName}
                currentUserId={currentUserId}
                worldDialogShortName={locationObject.shortName || ''}
                instanceOwner={
                    locationObject.ownerUserId || locationObject.userId || ''
                }
                instanceOwnerName={
                    locationObject.ownerDisplayName ||
                    row?.ownerDisplayName ||
                    row?.ownerName ||
                    ''
                }
                interactive={false}
                hint={row?.worldName || ''}
                className="max-w-full"
            />
        );
    }
    return (
        <Location
            location={location}
            hint={row?.worldName || ''}
            link={false}
            disableTooltip
            asButton={false}
        />
    );
}

export function PreviousInstancesListTable({
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
    onDeleteRow,
    headerActions = null,
    searchActions = null
}: any) {
    const { t } = useTranslation();
    const filteredCountText = formatPreviousInstanceCount(filteredRows.length);
    const totalCountText = formatPreviousInstanceCount(rows.length);
    const showWorldGroupColumn = variant !== 'user';
    const showCreatorColumn = variant !== 'user';

    function changeSort(nextKey: any) {
        onSortChange?.(nextKey);
    }

    function sortableHeader(label: any, key: any) {
        const active = sortKey === key;
        return (
            <DataTableSortButton
                active={active}
                direction={active ? (sortDesc ? 'desc' : 'asc') : false}
                label={label}
                onSort={() => changeSort(key)}
                className="px-1"
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
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-base font-semibold">{title}</h3>
                        <p className="text-muted-foreground text-sm">
                            {filteredCountText}/{totalCountText}{' '}
                            {t(
                                'dialog.previous_instances.label.recorded_instance_visits'
                            )}
                        </p>
                    </div>
                    {headerActions ? (
                        <div className="flex shrink-0 items-center gap-2">
                            {headerActions}
                        </div>
                    ) : null}
                </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <Input
                        value={search}
                        onChange={(event: any) =>
                            onSearchChange(event.target.value)
                        }
                        placeholder={t(
                            'dialog.previous_instances.search_placeholder'
                        )}
                        className="max-w-sm"
                    />
                    {searchActions}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-sm">
                        {t('dialog.previous_instances.label.rows')}
                    </span>
                    <Select
                        value={String(pageSize)}
                        onValueChange={(value: any) =>
                            onPageSizeChange(Number.parseInt(value, 10) || 10)
                        }
                    >
                        <SelectTrigger size="sm" className="w-24">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {[10, 25, 50, 100].map((size: any) => (
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
                <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                    <Table>
                        <TableHeader className="vrcx-0-table-header sticky top-0">
                            <TableRow>
                                <TableHead className="w-44">
                                    {sortableHeader(
                                        t('table.previous_instances.date'),
                                        'date'
                                    )}
                                </TableHead>
                                <TableHead>
                                    {sortableHeader(
                                        t(
                                            'dialog.previous_instances.label.location'
                                        ),
                                        'location'
                                    )}
                                </TableHead>
                                {showWorldGroupColumn ? (
                                    <TableHead className="w-48">
                                        {t('table.previous_instances.world')} /{' '}
                                        {t('dialog.new_instance.group')}
                                    </TableHead>
                                ) : null}
                                {showCreatorColumn ? (
                                    <TableHead className="w-44">
                                        {sortableHeader(
                                            t(
                                                'table.previous_instances.instance_creator'
                                            ),
                                            'creator'
                                        )}
                                    </TableHead>
                                ) : null}
                                <TableHead className="w-24">
                                    {sortableHeader(
                                        t('table.previous_instances.time'),
                                        'duration'
                                    )}
                                </TableHead>
                                <TableHead className="w-64 text-right">
                                    {t('table.previous_instances.action')}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visibleRows.map((row: any, index: any) => {
                                const location = rowLocation(row);
                                return (
                                    <TableRow
                                        key={`${location}:${row?.id || row?.created_at || row?.createdAt || index}`}
                                    >
                                        <TableCell className="text-muted-foreground align-middle text-xs leading-5">
                                            {formatDate(
                                                row?.created_at ||
                                                    row?.createdAt
                                            )}
                                        </TableCell>
                                        <TableCell className="relative max-w-[26rem] align-middle text-xs">
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
                                            <div className="pointer-events-none relative z-10 flex min-h-9 max-w-full items-center text-left">
                                                {location
                                                    ? renderLocationCell(row, {
                                                          variant,
                                                          currentUserId
                                                      })
                                                    : '-'}
                                            </div>
                                        </TableCell>
                                        {showWorldGroupColumn ? (
                                            <TableCell className="text-muted-foreground align-middle text-xs leading-5">
                                                {[row?.worldName, row?.groupName]
                                                    .filter(Boolean)
                                                    .join(' / ') || '-'}
                                            </TableCell>
                                        ) : null}
                                        {showCreatorColumn ? (
                                            <TableCell className="align-middle text-xs">
                                                <div className="flex min-h-9 items-center">
                                                    <InstanceOwnerCell
                                                        userId={rowOwnerUserId(
                                                            row
                                                        )}
                                                        location={location}
                                                        endpoint={
                                                            currentEndpoint
                                                        }
                                                    />
                                                </div>
                                            </TableCell>
                                        ) : null}
                                        <TableCell className="align-middle text-xs tabular-nums">
                                            {rowDuration(row)}
                                        </TableCell>
                                        <TableCell className="align-middle">
                                            <div className="flex min-h-9 items-center justify-end gap-2">
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
                                                    size={
                                                        variant === 'user'
                                                            ? 'icon-sm'
                                                            : 'sm'
                                                    }
                                                    variant="outline"
                                                    disabled={!location}
                                                    aria-label={t(
                                                        'common.actions.delete'
                                                    )}
                                                    onClick={() => {
                                                        onDeleteRow(row);
                                                    }}
                                                >
                                                    <Trash2Icon
                                                        data-icon={
                                                            variant === 'user'
                                                                ? 'icon'
                                                                : 'inline-start'
                                                        }
                                                    />
                                                    {variant === 'user'
                                                        ? null
                                                        : t(
                                                              'common.actions.delete'
                                                          )}
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
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
                            ? t('common.search_no_results')
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
