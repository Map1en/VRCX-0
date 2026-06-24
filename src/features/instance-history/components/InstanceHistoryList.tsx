import {
    ArrowDownUpIcon,
    ArrowDownWideNarrowIcon,
    ArrowUpNarrowWideIcon,
    ListXIcon,
    Trash2Icon,
    XIcon
} from 'lucide-react';
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
    formatPreviousInstanceCount,
    rowDuration,
    rowLocation
} from '@/components/dialogs/previous-instances-table/previousInstancesRows';
import { DialogEmptyState } from '@/components/dialogs/previous-instances-table/PreviousInstancesViewParts';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { Location } from '@/components/Location';
import type { PreviousInstanceRow } from '@/features/instance-history/instance-activity/instanceActivityTypes';
import type { InstanceHistoryMode } from '@/features/instance-history/instanceHistoryDayMode';
import { formatClock, formatDateFilter } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
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

const SORT_FIELDS = ['date', 'location', 'duration'] as const;
type SortField = (typeof SORT_FIELDS)[number];

function rowKey(row: PreviousInstanceRow, index: number): string {
    return `${rowLocation(row)}:${row?.id || row?.created_at || row?.createdAt || index}`;
}

function dayLabel(row: PreviousInstanceRow): string {
    return formatDateFilter(row?.created_at || row?.createdAt, 'date');
}

type InstanceHistoryRowProps = {
    row: PreviousInstanceRow;
    selected: boolean;
    onOpenDetails: (row: PreviousInstanceRow) => void;
    onDeleteRow: (row: PreviousInstanceRow) => void;
};

function InstanceHistoryRow({
    row,
    selected,
    onOpenDetails,
    onDeleteRow
}: InstanceHistoryRowProps) {
    const { t } = useTranslation();
    const location = rowLocation(row);

    return (
        <div
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            onClick={() => onOpenDetails(row)}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenDetails(row);
                }
            }}
            className={cn(
                'group focus-visible:ring-ring relative flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2',
                selected ? 'bg-muted' : 'hover:bg-muted/60'
            )}
        >
            {selected ? (
                <span className="bg-foreground absolute inset-y-1.5 left-0 w-0.5 rounded-full" />
            ) : null}
            <span className="text-muted-foreground w-11 shrink-0 text-xs tabular-nums">
                {formatClock(row?.created_at || row?.createdAt) || '—'}
            </span>
            <div className="min-w-0 flex-1 text-xs">
                {location ? (
                    <Location
                        location={location}
                        hint={row?.worldName || ''}
                        link={false}
                        disableTooltip
                        asButton={false}
                        className="max-w-full"
                    />
                ) : (
                    '—'
                )}
            </div>
            <div className="relative flex shrink-0 items-center justify-end">
                <span className="text-muted-foreground text-xs tabular-nums group-hover:invisible">
                    {rowDuration(row)}
                </span>
                <div
                    className="bg-muted invisible absolute right-0 flex items-center gap-1 pl-3 group-hover:visible"
                    onClick={(event: MouseEvent<HTMLDivElement>) =>
                        event.stopPropagation()
                    }
                    role="presentation"
                >
                    <InstanceActionBar
                        target={{
                            location,
                            worldName: row?.worldName || ''
                        }}
                        showRefresh={false}
                        showInstanceInfo={false}
                    />
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        disabled={!location}
                        aria-label={t('common.actions.delete')}
                        onClick={() => onDeleteRow(row)}
                    >
                        <Trash2Icon data-icon="icon" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

type InstanceHistoryListProps = {
    mode?: InstanceHistoryMode;
    totalCount?: number;
    filteredCount?: number;
    visibleRows: PreviousInstanceRow[];
    selectedRow: PreviousInstanceRow | null;
    search: string;
    onSearchChange: (value: string) => void;
    pageSize: number;
    onPageSizeChange: (value: number) => void;
    sortKey: string;
    sortDesc: boolean;
    onSortSelect: (sortKey: SortField, sortDesc: boolean) => void;
    currentPageIndex: number;
    totalPages: number;
    onPreviousPage: () => void;
    onNextPage: () => void;
    onOpenDetails: (row: PreviousInstanceRow) => void;
    onDeleteRow: (row: PreviousInstanceRow) => void;
    dateRangeControl?: ReactNode;
    dateActive?: boolean;
    dateRangeLabel?: string;
    onClearDate?: () => void;
};

export function InstanceHistoryList({
    mode = 'search',
    totalCount = 0,
    filteredCount = 0,
    visibleRows,
    selectedRow,
    search,
    onSearchChange,
    pageSize,
    onPageSizeChange,
    sortKey,
    sortDesc,
    onSortSelect,
    currentPageIndex,
    totalPages,
    onPreviousPage,
    onNextPage,
    onOpenDetails,
    onDeleteRow,
    dateRangeControl = null,
    dateActive = false,
    dateRangeLabel = '',
    onClearDate
}: InstanceHistoryListProps) {
    const { t } = useTranslation();
    const isDayMode = mode === 'day';
    const activeSortKey = SORT_FIELDS.includes(sortKey as SortField)
        ? (sortKey as SortField)
        : 'date';
    const grouped = !isDayMode && activeSortKey === 'date';
    const searchActive = !isDayMode && Boolean(search && search.trim());
    const dayRangeActive = !isDayMode && dateActive;
    const anyFilterActive = searchActive || dayRangeActive;

    const sortFieldLabel: Record<string, string> = {
        date: t('table.previous_instances.date'),
        location: t('dialog.previous_instances.label.location'),
        duration: t('table.previous_instances.time')
    };

    let lastDayLabel = '';

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            {!isDayMode ? (
                <div className="flex flex-col gap-2">
                    <Input
                        value={search}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            onSearchChange(event.target.value)
                        }
                        placeholder={t(
                            'dialog.previous_instances.search_placeholder'
                        )}
                        className="w-full"
                    />
                    <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">{dateRangeControl}</div>
                        <div className="flex shrink-0 items-center">
                            <Select
                                value={activeSortKey}
                                onValueChange={(value: string) =>
                                    onSortSelect(value as SortField, sortDesc)
                                }
                            >
                                <SelectTrigger
                                    size="sm"
                                    className="w-32 rounded-r-none border-r-0"
                                    aria-label={t(
                                        'dialog.previous_instances.label.sort_by'
                                    )}
                                >
                                    <ArrowDownUpIcon className="text-muted-foreground size-3.5" />
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {SORT_FIELDS.map((field) => (
                                            <SelectItem
                                                key={field}
                                                value={field}
                                            >
                                                {sortFieldLabel[field]}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="rounded-l-none px-2"
                                aria-label={t(
                                    sortDesc
                                        ? 'dialog.previous_instances.label.sort_descending'
                                        : 'dialog.previous_instances.label.sort_ascending'
                                )}
                                onClick={() =>
                                    onSortSelect(activeSortKey, !sortDesc)
                                }
                            >
                                {sortDesc ? (
                                    <ArrowDownWideNarrowIcon data-icon="icon" />
                                ) : (
                                    <ArrowUpNarrowWideIcon data-icon="icon" />
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">
                    {formatPreviousInstanceCount(filteredCount)}/
                    {formatPreviousInstanceCount(totalCount)}{' '}
                    {t(
                        'dialog.previous_instances.label.recorded_instance_visits'
                    )}
                </span>
                {searchActive ? (
                    <button
                        type="button"
                        className="bg-card text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-0.5"
                        onClick={() => onSearchChange('')}
                    >
                        <span className="max-w-32 truncate">{search}</span>
                        <XIcon className="text-muted-foreground size-3" />
                    </button>
                ) : null}
                {dayRangeActive ? (
                    <button
                        type="button"
                        className="bg-card text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-0.5"
                        onClick={() => onClearDate?.()}
                    >
                        <span className="max-w-40 truncate">
                            {dateRangeLabel}
                        </span>
                        <XIcon className="text-muted-foreground size-3" />
                    </button>
                ) : null}
                {anyFilterActive ? (
                    <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        onClick={() => {
                            onSearchChange('');
                            onClearDate?.();
                        }}
                    >
                        <ListXIcon className="size-3.5" />
                        {t('common.actions.clear')}
                    </button>
                ) : null}
            </div>

            {visibleRows.length ? (
                <div className="min-h-0 flex-1 overflow-auto rounded-md border p-1">
                    {visibleRows.map((row, index) => {
                        const label = grouped ? dayLabel(row) : '';
                        const showHeader = grouped && label !== lastDayLabel;
                        lastDayLabel = label;
                        return (
                            <div key={rowKey(row, index)}>
                                {showHeader ? (
                                    <div className="bg-background/95 text-muted-foreground sticky top-0 z-10 px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase backdrop-blur">
                                        {label}
                                    </div>
                                ) : null}
                                <InstanceHistoryRow
                                    row={row}
                                    selected={selectedRow === row}
                                    onOpenDetails={onOpenDetails}
                                    onDeleteRow={onDeleteRow}
                                />
                            </div>
                        );
                    })}
                </div>
            ) : (
                <DialogEmptyState
                    title={t(
                        'dialog.previous_instances.empty.no_instance_records'
                    )}
                    description={
                        searchActive ? t('common.search_no_results') : undefined
                    }
                    className="min-h-40 flex-none"
                />
            )}

            {!isDayMode ? (
                <div className="flex items-center justify-between gap-2">
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Select
                            value={String(pageSize)}
                            onValueChange={(value: string) =>
                                onPageSizeChange(
                                    Number.parseInt(value, 10) || 10
                                )
                            }
                        >
                            <SelectTrigger size="sm" className="w-20">
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
                        <span>
                            {t('dialog.previous_instances.label.page')}{' '}
                            {currentPageIndex + 1} / {totalPages}
                        </span>
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
                    </div>
                </div>
            ) : null}
        </div>
    );
}
