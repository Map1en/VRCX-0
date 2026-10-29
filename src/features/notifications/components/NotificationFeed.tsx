import {
    ArrowUpToLineIcon,
    BellIcon,
    CheckCheckIcon,
    SearchXIcon
} from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppTable } from '@/components/data-table/appTable';
import {
    DataTablePagination,
    DataTableSurface
} from '@/components/data-table/DataTableView';
import { EmptyState, LoadingState } from '@/components/layout/PageScaffold';
import { formatDateFilter } from '@/lib/dateTime';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { useNowMs } from '@/lib/useNowMs';
import { getNotificationTs } from '@/shared/utils/notificationCategory';
import { Button } from '@/ui/shadcn/button';

import {
    foldAdjacentNotifications,
    useExpandedNotificationGroups
} from '../notificationGroups';
import type {
    NotificationLoadStatus,
    NotificationRow as NotificationRecord
} from '../notificationPageTypes';
import type { NotificationQuickFilter } from '../useNotificationFilters';
import { NotificationGroupSummary } from './NotificationGroupSummary';
import {
    NotificationRow,
    type NotificationFeedHandlers
} from './NotificationRow';

type NotificationFeedDay = {
    key: string;
    timestamp: number;
    rows: NotificationRecord[];
};

function dayKey(timestamp: number): string {
    const date = new Date(timestamp);
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function groupByDay(rows: NotificationRecord[]): NotificationFeedDay[] {
    const days: NotificationFeedDay[] = [];
    for (const row of rows) {
        const timestamp = getNotificationTs(row);
        const key = dayKey(timestamp);
        const current = days.at(-1);
        if (current?.key === key) {
            current.rows.push(row);
            continue;
        }
        days.push({ key, timestamp, rows: [row] });
    }
    return days;
}

export function NotificationFeed({
    rows,
    table,
    detail,
    loadStatus,
    sourceRowsCount,
    hasActiveFilters,
    rowsCount,
    pagination,
    pageSizes,
    onPageSizeChange,
    onClearFilters,
    currentUserId,
    canInviteFromCurrentLocation,
    handlers,
    pendingCount = 0,
    onShowPending,
    onScrolledAwayChange,
    onRetry,
    quickFilter = 'all'
}: {
    canInviteFromCurrentLocation: boolean;
    pendingCount?: number;
    onShowPending?: () => void;
    onScrolledAwayChange?: (value: boolean) => void;
    onRetry?: () => void;
    quickFilter?: NotificationQuickFilter;
    currentUserId?: string;
    detail: string;
    handlers: NotificationFeedHandlers;
    loadStatus: NotificationLoadStatus;
    hasActiveFilters: boolean;
    onClearFilters: () => void;
    onPageSizeChange: (value: string) => void;
    pageSizes: number[];
    pagination: { pageIndex: number; pageSize: number };
    rows: NotificationRecord[];
    rowsCount: number;
    sourceRowsCount: number;
    table: AppTable<NotificationRecord>;
}) {
    const { t } = useTranslation();
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const scrolledAwayRef = useRef(false);
    const days = useMemo(() => groupByDay(rows), [rows]);
    const { expanded, toggle } = useExpandedNotificationGroups();
    const nowMs = useNowMs({ intervalMs: 60_000 });
    const todayKey = dayKey(nowMs);
    const yesterdayKey = dayKey(nowMs - 86_400_000);

    function renderRow(notification: NotificationRecord) {
        return (
            <NotificationRow
                key={String(notification.id)}
                notification={notification}
                currentUserId={currentUserId}
                canInviteFromCurrentLocation={canInviteFromCurrentLocation}
                handlers={handlers}
            />
        );
    }

    function dayLabel(day: NotificationFeedDay) {
        if (day.key === todayKey) {
            return t('view.notification.feed.today');
        }
        if (day.key === yesterdayKey) {
            return t('view.notification.feed.yesterday');
        }
        return formatDateFilter(day.timestamp, 'date');
    }

    return (
        <>
            {detail ? (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    {userFacingErrorMessage(
                        detail,
                        t(
                            'view.notifications.toast.failed_to_load_notifications'
                        )
                    )}
                    {onRetry ? (
                        <Button
                            type="button"
                            variant="link"
                            size="sm"
                            onClick={onRetry}
                        >
                            {t('common.action.retry')}
                        </Button>
                    ) : null}
                </div>
            ) : null}

            <DataTableSurface>
                <div
                    ref={scrollRef}
                    className="relative h-full min-h-0 min-w-0 overflow-auto px-2 pb-2"
                    onScroll={(event) => {
                        const scrolledAway = event.currentTarget.scrollTop > 8;
                        if (scrolledAwayRef.current !== scrolledAway) {
                            scrolledAwayRef.current = scrolledAway;
                            onScrolledAwayChange?.(scrolledAway);
                        }
                    }}
                >
                    {pendingCount > 0 ? (
                        <div className="pointer-events-none sticky top-2 z-20 flex justify-center">
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="bg-popover/95 pointer-events-auto h-7 rounded-full border px-3 text-xs shadow-md"
                                onClick={() => {
                                    if (scrollRef.current) {
                                        scrollRef.current.scrollTop = 0;
                                    }
                                    onShowPending?.();
                                }}
                            >
                                <ArrowUpToLineIcon data-icon="inline-start" />
                                {t('view.notification.feed.pending_count', {
                                    count: pendingCount
                                })}
                            </Button>
                        </div>
                    ) : null}
                    {days.length > 0 ? (
                        days.map((day) => (
                            <section key={day.key}>
                                <h3 className="text-muted-foreground/70 sticky top-0 z-10 bg-(--vrcx-0-main-content-surface) px-2 pt-5 pb-2 text-xs font-medium">
                                    {dayLabel(day)}
                                </h3>
                                <div role="list">
                                    {foldAdjacentNotifications(
                                        day.rows,
                                        (row) => row
                                    ).map((fold) => {
                                        if (fold.kind === 'single') {
                                            return renderRow(fold.item);
                                        }
                                        const isExpanded = expanded.has(
                                            fold.runKey
                                        );
                                        return (
                                            <div
                                                key={`group:${fold.runKey}`}
                                                role="listitem"
                                            >
                                                <NotificationGroupSummary
                                                    variant="page"
                                                    rows={fold.items}
                                                    expanded={isExpanded}
                                                    onToggle={() =>
                                                        toggle(fold.runKey)
                                                    }
                                                />
                                                {isExpanded ? (
                                                    <div
                                                        role="list"
                                                        className="border-border/60 ml-6 border-l pl-2"
                                                    >
                                                        {fold.items.map(
                                                            renderRow
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        ))
                    ) : loadStatus === 'running' ? (
                        <LoadingState
                            variant="table"
                            label={t('common.loading')}
                        />
                    ) : quickFilter === 'action' &&
                      sourceRowsCount > 0 &&
                      !detail ? (
                        <EmptyState
                            variant="table"
                            icon={CheckCheckIcon}
                            title={t('view.notification.feed.action_all_done')}
                            description={t(
                                'view.notification.feed.action_all_done_description'
                            )}
                        />
                    ) : (
                        <EmptyState
                            variant="table"
                            icon={sourceRowsCount > 0 ? SearchXIcon : BellIcon}
                            title={t(
                                sourceRowsCount > 0
                                    ? 'common.no_matching_entries'
                                    : 'empty_state.notifications_title'
                            )}
                            description={t(
                                sourceRowsCount > 0
                                    ? 'empty_state.notifications_filter_description'
                                    : 'empty_state.notifications_description'
                            )}
                        >
                            {sourceRowsCount > 0 && hasActiveFilters ? (
                                <Button
                                    type="button"
                                    variant="link"
                                    onClick={onClearFilters}
                                >
                                    {t('empty_state.clear_search_and_filters')}
                                </Button>
                            ) : null}
                        </EmptyState>
                    )}
                </div>
            </DataTableSurface>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-muted-foreground text-sm">
                    {t('view.notification.label.notifications_in_view', {
                        total: rowsCount
                    })}
                </div>
                <DataTablePagination
                    table={table}
                    pageIndex={pagination.pageIndex}
                    pageCount={table.getPageCount() || 1}
                    pageSize={pagination.pageSize}
                    pageSizes={pageSizes}
                    pageSizeLabel={t('table.pagination.rows_per_page')}
                    previousLabel={t('table.pagination.previous')}
                    nextLabel={t('table.pagination.next')}
                    onPageSizeChange={onPageSizeChange}
                />
            </div>
        </>
    );
}
