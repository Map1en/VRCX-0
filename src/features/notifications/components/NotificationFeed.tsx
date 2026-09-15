import { BellIcon, SearchXIcon } from 'lucide-react';
import { useMemo } from 'react';
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

import type {
    NotificationLoadStatus,
    NotificationRow as NotificationRecord
} from '../notificationPageTypes';
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
    handlers
}: {
    canInviteFromCurrentLocation: boolean;
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
    const days = useMemo(() => groupByDay(rows), [rows]);
    const nowMs = useNowMs({ intervalMs: 60_000 });
    const todayKey = dayKey(nowMs);
    const yesterdayKey = dayKey(nowMs - 86_400_000);

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
                <div className="text-muted-foreground text-sm">
                    {userFacingErrorMessage(
                        detail,
                        t(
                            'view.notifications.toast.failed_to_load_notifications'
                        )
                    )}
                </div>
            ) : null}

            <DataTableSurface>
                <div className="h-full min-h-0 min-w-0 overflow-auto px-2 pb-2">
                    {days.length > 0 ? (
                        days.map((day) => (
                            <div key={day.key}>
                                <div className="text-muted-foreground/70 sticky top-0 z-10 bg-(--vrcx-0-main-content-surface) px-2 pt-5 pb-2 text-xs font-medium">
                                    {dayLabel(day)}
                                </div>
                                {day.rows.map((notification) => (
                                    <NotificationRow
                                        key={String(notification.id)}
                                        notification={notification}
                                        currentUserId={currentUserId}
                                        canInviteFromCurrentLocation={
                                            canInviteFromCurrentLocation
                                        }
                                        handlers={handlers}
                                    />
                                ))}
                            </div>
                        ))
                    ) : loadStatus === 'running' ? (
                        <LoadingState
                            variant="table"
                            label={t('common.loading')}
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
