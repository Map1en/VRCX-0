import {
    ArrowDownUpIcon,
    ArrowDownWideNarrowIcon,
    ArrowUpNarrowWideIcon,
    ListXIcon,
    Trash2Icon,
    XIcon
} from 'lucide-react';
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    formatPreviousInstanceCount,
    rowDuration,
    rowLocation
} from '@/components/dialogs/previous-instances-table/previousInstancesRows';
import { DialogEmptyState } from '@/components/dialogs/previous-instances-table/PreviousInstancesViewParts';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { Location } from '@/components/Location';
import { useVirtualSidebarRows } from '@/components/sidebar/useVirtualSidebarRows';
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

const HEADER_ENTRY_HEIGHT = 28;
const RECORD_ENTRY_HEIGHT = 36;

export function rowKey(
    row: PreviousInstanceRow,
    fallback: string | number = ''
): string {
    return `${rowLocation(row)}:${row?.id || row?.created_at || row?.createdAt || fallback}`;
}

function dayLabel(row: PreviousInstanceRow): string {
    return formatDateFilter(row?.created_at || row?.createdAt, 'date');
}

type InstanceHistoryEntry =
    | { key: string; kind: 'header'; label: string }
    | { key: string; kind: 'row'; row: PreviousInstanceRow; label: string };

function estimateInstanceHistoryEntrySize(entry: InstanceHistoryEntry): number {
    return entry.kind === 'header' ? HEADER_ENTRY_HEIGHT : RECORD_ENTRY_HEIGHT;
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
            <div className="relative flex shrink-0 items-center">
                <div
                    className="bg-muted invisible absolute inset-y-0 right-full z-10 mr-1.5 flex items-center gap-1 rounded-md px-1 group-focus-within:visible group-hover:visible"
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
                <span className="text-muted-foreground text-xs tabular-nums">
                    {rowDuration(row)}
                </span>
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
    sortKey: string;
    sortDesc: boolean;
    onSortSelect: (sortKey: SortField, sortDesc: boolean) => void;
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
    sortKey,
    sortDesc,
    onSortSelect,
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

    const entries = useMemo<InstanceHistoryEntry[]>(() => {
        const result: InstanceHistoryEntry[] = [];
        let lastLabel = '';
        visibleRows.forEach((row, index) => {
            const label = grouped ? dayLabel(row) : '';
            if (grouped && label !== lastLabel) {
                result.push({
                    key: `header:${label}:${index}`,
                    kind: 'header',
                    label
                });
                lastLabel = label;
            }
            result.push({
                key: rowKey(row, index),
                kind: 'row',
                row,
                label
            });
        });
        return result;
    }, [grouped, visibleRows]);

    const {
        getRowRef,
        viewportRef,
        virtualItems,
        totalSize,
        firstVisibleIndex,
        scrollKeyToView
    } = useVirtualSidebarRows(entries, estimateInstanceHistoryEntrySize);

    const firstVisibleEntry =
        entries[Math.min(firstVisibleIndex, entries.length - 1)];
    const pinnedLabel =
        grouped && firstVisibleEntry && firstVisibleEntry.kind !== 'header'
            ? firstVisibleEntry.label
            : '';

    useEffect(() => {
        if (!selectedRow) {
            return;
        }
        const entry = entries.find(
            (item) => item.kind === 'row' && item.row === selectedRow
        );
        if (!entry) {
            return;
        }
        scrollKeyToView(entry.key, grouped ? HEADER_ENTRY_HEIGHT : 0);
    }, [entries, grouped, scrollKeyToView, selectedRow]);

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
                                items={SORT_FIELDS.map((field) => ({
                                    value: field,
                                    label: sortFieldLabel[field]
                                }))}
                                onValueChange={(value) =>
                                    onSortSelect(
                                        (value ?? '') as SortField,
                                        sortDesc
                                    )
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
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border">
                    {pinnedLabel ? (
                        <div className="bg-background/95 text-muted-foreground absolute inset-x-0 top-0 z-20 px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase backdrop-blur">
                            {pinnedLabel}
                        </div>
                    ) : null}
                    <div ref={viewportRef} className="h-full overflow-auto">
                        <div
                            className="relative w-full p-1"
                            style={{ height: `${totalSize}px` }}
                        >
                            {virtualItems.map(({ key, start, row: entry }) => (
                                <div
                                    key={String(key)}
                                    ref={getRowRef(key)}
                                    className="absolute top-1 right-1 left-1"
                                    style={{
                                        transform: `translateY(${start}px)`
                                    }}
                                >
                                    {entry.kind === 'header' ? (
                                        <div className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
                                            {entry.label}
                                        </div>
                                    ) : (
                                        <InstanceHistoryRow
                                            row={entry.row}
                                            selected={selectedRow === entry.row}
                                            onOpenDetails={onOpenDetails}
                                            onDeleteRow={onDeleteRow}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <DialogEmptyState
                    title={t(
                        'dialog.previous_instances.empty.no_instance_records'
                    )}
                    description={
                        anyFilterActive
                            ? t('common.search_no_results')
                            : undefined
                    }
                    action={
                        anyFilterActive ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    onSearchChange('');
                                    onClearDate?.();
                                }}
                            >
                                <ListXIcon data-icon="inline-start" />
                                {t('common.actions.clear')}
                            </Button>
                        ) : undefined
                    }
                    className="min-h-40 flex-none"
                />
            )}
        </div>
    );
}
