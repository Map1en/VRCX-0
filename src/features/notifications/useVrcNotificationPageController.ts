import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';

import { useNotificationColumns } from './components/NotificationPageColumns';
import { useNotificationActions } from './useNotificationActions';
import { useNotificationDialogs } from './useNotificationDialogs';
import { useNotificationFilters } from './useNotificationFilters';
import { useNotificationRows } from './useNotificationRows';
import { useNotificationRuntime } from './useNotificationRuntime';
import { useNotificationShiftKey } from './useNotificationShiftKey';
import { useNotificationTableState } from './useNotificationTableState';
import { useNotificationTypeLabel } from './useNotificationTypeLabel';

export function useVrcNotificationPageController() {
    const filters = useNotificationFilters();
    const runtime = useNotificationRuntime();
    const dialogs = useNotificationDialogs();
    const shiftHeld = useNotificationShiftKey();
    const tableState = useNotificationTableState({
        activeTypes: filters.activeTypes,
        deferredSearchQuery: filters.deferredSearchQuery
    });
    const rowsState = useNotificationRows({
        activeTypes: filters.activeTypes,
        currentUserId: runtime.currentUserId,
        deferredSearchQuery: filters.deferredSearchQuery,
        filtersReady: filters.filtersReady
    });
    const notificationTypeLabel = useNotificationTypeLabel();
    const actions = useNotificationActions({
        canInviteFromCurrentLocation: runtime.canInviteFromCurrentLocation,
        currentInviteLocation: runtime.currentInviteLocation,
        currentUserId: runtime.currentUserId,
        endpoint: runtime.endpoint,
        reload: rowsState.reload,
        setBoopReplyRequest: dialogs.setBoopReplyRequest,
        setInviteResponseRequest: dialogs.setInviteResponseRequest
    });
    const columns = useNotificationColumns({
        canInviteFromCurrentLocation: runtime.canInviteFromCurrentLocation,
        currentUserId: runtime.currentUserId,
        isTypeClickable: actions.notificationTypeIsClickable,
        notificationTypeLabel,
        onAcceptFriendRequest: actions.acceptFriendRequest,
        onAcceptRequestInvite: actions.acceptRequestInvite,
        onDeleteNotification: actions.deleteNotification,
        onHideNotification: actions.hideNotification,
        onMarkSeen: actions.markSeen,
        onOpenGroup: actions.openGroup,
        onOpenNotificationImagePreview: actions.openNotificationImagePreview,
        onOpenNotificationLink: actions.openNotificationLink,
        onOpenTypeTarget: actions.openNotificationTypeTarget,
        onOpenUser: actions.openUser,
        onSendInviteResponseWithMessage: actions.sendInviteResponseWithMessage,
        onSendNotificationResponse: actions.sendNotificationResponse,
        shiftHeld
    });

    const table = useReactTable({
        columns,
        data: rowsState.rows,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        meta: {
            columnOrderLocked: tableState.columnOrderLocked,
            setColumnOrderLocked: tableState.setColumnOrderLocked
        },
        onColumnOrderChange: tableState.setColumnOrder,
        onColumnSizingChange: tableState.setColumnSizing,
        onColumnVisibilityChange: tableState.setColumnVisibility,
        onPaginationChange: tableState.setPagination,
        onSortingChange: tableState.setSorting,
        state: {
            columnOrder: tableState.columnOrder,
            columnSizing: tableState.columnSizing,
            columnVisibility: tableState.columnVisibility,
            pagination: tableState.pagination,
            sorting: tableState.sorting
        }
    });

    return {
        actions,
        dialogs,
        filters: {
            activeTypes: filters.activeTypes,
            clearFilters: filters.clearFilters,
            searchQuery: filters.searchQuery,
            setActiveTypes: filters.setActiveTypes,
            setSearchQuery: filters.setSearchQuery
        },
        notificationTypeLabel,
        rowsState,
        runtime,
        table,
        tableState
    };
}
