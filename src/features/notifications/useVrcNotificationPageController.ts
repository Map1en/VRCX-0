import { useCallback, useMemo, useState } from 'react';

import { useAppTable } from '@/components/data-table/appTable';
import {
    selectCanMarkAllSeen,
    useVrcNotificationStore
} from '@/state/vrcNotificationStore';

import type { NotificationFeedHandlers } from './components/NotificationRow';
import { useSessionUnreadKeys } from './notificationSessionUnread';
import { useNotificationActions } from './useNotificationActions';
import { useNotificationDialogs } from './useNotificationDialogs';
import { useNotificationFilters } from './useNotificationFilters';
import { useNotificationRows } from './useNotificationRows';
import { useNotificationRuntime } from './useNotificationRuntime';
import { useNotificationTableState } from './useNotificationTableState';
import { useNotificationTypeLabel } from './useNotificationTypeLabel';

export function useVrcNotificationPageController() {
    const canMarkAllSeen = useVrcNotificationStore(selectCanMarkAllSeen);
    const isMarkingAllSeen = useVrcNotificationStore(
        (state) => state.markAllSeenProgress !== null
    );
    const sourceRows = useVrcNotificationStore((state) => state.rows);
    const sourceRowsCount = sourceRows.length;
    const sessionUnreadKeys = useSessionUnreadKeys(sourceRows);
    const [feedScrolledAway, setFeedScrolledAway] = useState(false);
    const filters = useNotificationFilters();
    const runtime = useNotificationRuntime();
    const dialogs = useNotificationDialogs();
    const tableState = useNotificationTableState({
        activeTypes: filters.activeTypes,
        deferredSearchQuery: filters.deferredSearchQuery,
        quickFilter: filters.quickFilter
    });
    const rowsState = useNotificationRows({
        activeTypes: filters.activeTypes,
        currentUserId: runtime.currentUserId ?? undefined,
        deferredSearchQuery: filters.deferredSearchQuery,
        filtersReady: filters.filtersReady,
        holdNew: feedScrolledAway || tableState.pagination.pageIndex > 0,
        quickFilter: filters.quickFilter
    });
    const { setPagination } = tableState;
    const showPendingNotifications = useCallback(() => {
        setFeedScrolledAway(false);
        setPagination((current) =>
            current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }
        );
    }, [setPagination]);
    const notificationTypeLabel = useNotificationTypeLabel();
    const actions = useNotificationActions({
        canInviteFromCurrentLocation: runtime.canInviteFromCurrentLocation,
        currentInviteLocation: runtime.currentInviteLocation,
        currentUserId: runtime.currentUserId ?? undefined,
        notificationTypeLabel,
        reload: rowsState.reload,
        setBoopReplyRequest: dialogs.setBoopReplyRequest,
        setInviteResponseRequest: dialogs.setInviteResponseRequest
    });

    const table = useAppTable({
        columns: [],
        data: rowsState.rows,
        onPaginationChange: tableState.setPagination,
        state: {
            pagination: tableState.pagination
        }
    });

    const pageRows = table.getRowModel().rows.map((row) => row.original);

    const handlers = useMemo<NotificationFeedHandlers>(
        () => ({
            onAcceptFriendRequest: actions.acceptFriendRequest,
            onAcceptRequestInvite: actions.acceptRequestInvite,
            onDeleteNotification: actions.deleteNotification,
            onHideNotification: actions.hideNotification,
            onIgnoreNotificationLocally: actions.ignoreNotificationLocally,
            onMarkSeen: actions.markSeen,
            onOpenImagePreview: actions.openNotificationImagePreview,
            onOpenLink: actions.openNotificationLink,
            onSendInviteResponseWithMessage:
                actions.sendInviteResponseWithMessage,
            onSendNotificationResponse: actions.sendNotificationResponse
        }),
        [actions]
    );

    return {
        actions,
        dialogs,
        onFeedScrolledAwayChange: setFeedScrolledAway,
        sessionUnreadKeys,
        showPendingNotifications,
        filters,
        handlers,
        notificationTypeLabel,
        pageRows,
        rowsState,
        runtime,
        sourceRowsCount,
        table,
        tableState,
        canMarkAllSeen,
        isMarkingAllSeen
    };
}
