import { ListXIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
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
import type { InstanceHistoryEntryRow } from '@/features/instance-history/instance-activity/instanceActivityTypes';
import type { InstanceHistorySortKey } from '@/features/instance-history/instanceHistoryController';
import type { InstanceHistoryMode } from '@/features/instance-history/instanceHistoryDayMode';
import { formatClock, formatDateFilter } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';

const HEADER_ENTRY_HEIGHT = 28;
const RECORD_ENTRY_HEIGHT = 36;

export function rowKey(
    row: InstanceHistoryEntryRow,
    fallback: string | number = ''
): string {
    return `${rowLocation(row)}:${row?.id || row?.created_at || row?.createdAt || fallback}`;
}

function dayLabel(row: InstanceHistoryEntryRow): string {
    return formatDateFilter(row?.created_at || row?.createdAt, 'date');
}

type InstanceHistoryEntry =
    | { key: string; kind: 'header'; label: string }
    | { key: string; kind: 'row'; row: InstanceHistoryEntryRow; label: string };

function estimateInstanceHistoryEntrySize(entry: InstanceHistoryEntry): number {
    return entry.kind === 'header' ? HEADER_ENTRY_HEIGHT : RECORD_ENTRY_HEIGHT;
}

type InstanceHistoryRowProps = {
    row: InstanceHistoryEntryRow;
    selected: boolean;
    onOpenDetails: (row: InstanceHistoryEntryRow) => void;
    onDeleteRow: (row: InstanceHistoryEntryRow) => void;
};

export function InstanceHistoryRow({
    row,
    selected,
    onOpenDetails,
    onDeleteRow
}: InstanceHistoryRowProps) {
    const { t } = useTranslation();
    const location = rowLocation(row);

    return (
        <div
            className={cn(
                'group relative flex min-h-9 items-center rounded-md',
                selected ? 'bg-muted' : 'hover:bg-muted/60'
            )}
        >
            {selected ? (
                <span className="bg-foreground absolute inset-y-1.5 left-0 w-0.5 rounded-full" />
            ) : null}
            <button
                type="button"
                aria-pressed={selected}
                onClick={() => onOpenDetails(row)}
                className="focus-visible:ring-ring flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2"
            >
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
                <span className="text-muted-foreground text-xs tabular-nums">
                    {rowDuration(row)}
                </span>
            </button>
            <div className="bg-muted invisible absolute top-1/2 right-2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-md px-1 group-focus-within:visible group-hover:visible">
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
    );
}

type InstanceHistoryListProps = {
    mode?: InstanceHistoryMode;
    totalCount?: number;
    filteredCount?: number;
    visibleRows: InstanceHistoryEntryRow[];
    selectedRow: InstanceHistoryEntryRow | null;
    search: string;
    onSearchChange: (value: string) => void;
    sortKey: InstanceHistorySortKey;
    onOpenDetails: (row: InstanceHistoryEntryRow) => void;
    onDeleteRow: (row: InstanceHistoryEntryRow) => void;
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
    onOpenDetails,
    onDeleteRow,
    dateActive = false,
    dateRangeLabel = '',
    onClearDate
}: InstanceHistoryListProps) {
    const { t } = useTranslation();
    const isDayMode = mode === 'day';
    const grouped = !isDayMode && sortKey === 'date';
    const searchActive = !isDayMode && Boolean(search && search.trim());
    const dayRangeActive = !isDayMode && dateActive;
    const anyFilterActive = searchActive || dayRangeActive;

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
    const selectionScrollRequestRef = useRef<{
        entries: InstanceHistoryEntry[];
        selectedRow: InstanceHistoryEntryRow | null;
    } | null>(null);

    useEffect(() => {
        const previousRequest = selectionScrollRequestRef.current;
        if (
            previousRequest?.entries === entries &&
            previousRequest.selectedRow === selectedRow
        ) {
            return;
        }
        selectionScrollRequestRef.current = { entries, selectedRow };
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
