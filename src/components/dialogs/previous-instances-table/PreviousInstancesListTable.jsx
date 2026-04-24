import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar.jsx';
import { Location } from '@/components/Location.jsx';
import { LocationWorld } from '@/components/LocationWorld.jsx';
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
    rowDuration,
    rowLocation,
    rowLocationObject,
    rowOwnerUserId
} from './previousInstancesRows.js';
import {
    DialogEmptyState,
    InstanceOwnerCell,
    formatDate
} from './PreviousInstancesViewParts.jsx';

function renderLocationCell(row, { variant, currentUserId }) {
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
    sortDesc,
    onSortDescChange,
    currentPageIndex,
    totalPages,
    onPreviousPage,
    onNextPage,
    onClose,
    currentUserId,
    currentEndpoint,
    onOpenLocation,
    onOpenDetails,
    onDeleteRow
}) {
    const { t } = useTranslation();

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
                            {filteredRows.length}/{rows.length}{' '}
                            {t(
                                'dialog.previous_instances.generated.recorded_instance_visits'
                            )}
                        </p>
                    </div>
                </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Input
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder={t(
                        'dialog.previous_instances.search_placeholder'
                    )}
                    className="max-w-sm"
                />
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-sm">
                        {t('dialog.previous_instances.generated.rows')}
                    </span>
                    <Select
                        value={String(pageSize)}
                        onValueChange={(value) =>
                            onPageSizeChange(Number.parseInt(value, 10) || 10)
                        }
                    >
                        <SelectTrigger size="sm" className="w-24">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {[10, 25, 50, 100].map((size) => (
                                    <SelectItem
                                        key={size}
                                        value={String(size)}
                                    >
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
                        <TableHeader className="bg-background sticky top-0">
                            <TableRow>
                                <TableHead className="w-44">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-auto px-1"
                                        onClick={onSortDescChange}
                                    >
                                        {t(
                                            'dialog.previous_instances.generated.created'
                                        )}
                                        {sortDesc ? (
                                            <ArrowDownIcon data-icon="inline-end" />
                                        ) : (
                                            <ArrowUpIcon data-icon="inline-end" />
                                        )}
                                    </Button>
                                </TableHead>
                                <TableHead>
                                    {t(
                                        'dialog.previous_instances.generated.location'
                                    )}
                                </TableHead>
                                <TableHead className="w-48">
                                    {t(
                                        'dialog.previous_instances.generated.world_group'
                                    )}
                                </TableHead>
                                <TableHead className="w-44">
                                    {t(
                                        'dialog.previous_instances.generated.creator'
                                    )}
                                </TableHead>
                                <TableHead className="w-24">
                                    {t(
                                        'dialog.previous_instances.generated.duration'
                                    )}
                                </TableHead>
                                <TableHead className="w-80 text-right">
                                    {t(
                                        'dialog.previous_instances.generated.actions'
                                    )}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visibleRows.map((row, index) => {
                                const location = rowLocation(row);
                                return (
                                    <TableRow
                                        key={`${location}:${row?.id || row?.created_at || row?.createdAt || index}`}
                                    >
                                        <TableCell className="text-muted-foreground align-top text-xs">
                                            {formatDate(
                                                row?.created_at ||
                                                    row?.createdAt
                                            )}
                                        </TableCell>
                                        <TableCell className="relative max-w-[26rem] align-top text-xs">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="hover:bg-muted absolute inset-0 h-full w-full rounded-none p-0"
                                                onClick={() => onOpenDetails(row)}
                                            >
                                                <span className="sr-only">
                                                    {t(
                                                        'dialog.previous_instances.generated.open_instance_details'
                                                    )}
                                                </span>
                                            </Button>
                                            <div className="pointer-events-none relative z-10 max-w-full text-left">
                                                {location
                                                    ? renderLocationCell(row, {
                                                          variant,
                                                          currentUserId
                                                      })
                                                    : '-'}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground align-top text-xs">
                                            {[row?.worldName, row?.groupName]
                                                .filter(Boolean)
                                                .join(' / ') || '-'}
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <InstanceOwnerCell
                                                userId={rowOwnerUserId(row)}
                                                location={location}
                                                endpoint={currentEndpoint}
                                            />
                                        </TableCell>
                                        <TableCell className="align-top text-xs tabular-nums">
                                            {rowDuration(row)}
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <div className="flex justify-end gap-2">
                                                <InstanceActionBar
                                                    location={location}
                                                    launchLocation={location}
                                                    inviteLocation={location}
                                                    instanceLocation={location}
                                                    worldName={
                                                        row?.worldName || ''
                                                    }
                                                    showRefresh={false}
                                                    showInstanceInfo={false}
                                                />
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={!location}
                                                    onClick={() =>
                                                        onOpenLocation(row)
                                                    }
                                                >
                                                    {t(
                                                        'common.actions.open'
                                                    )}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() =>
                                                        onOpenDetails(row)
                                                    }
                                                >
                                                    {t(
                                                        'dialog.previous_instances.generated.details'
                                                    )}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={!location}
                                                    onClick={() =>
                                                        void onDeleteRow(row)
                                                    }
                                                >
                                                    <Trash2Icon data-icon="inline-start" />
                                                    {t(
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
                        'dialog.previous_instances.generated.no_instance_records'
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
                    {t('dialog.previous_instances.generated.page')}{' '}
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
