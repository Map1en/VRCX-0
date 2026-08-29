import { useAppTable } from '@/components/data-table/appTable';

import { useMyAvatarsColumns } from './components/MyAvatarsColumns';
import type { MyAvatarRow } from './myAvatarsTypes';
import { useMyAvatarsActions } from './useMyAvatarsActions';
import { useMyAvatarsDialogState } from './useMyAvatarsDialogState';
import { useMyAvatarsFilters } from './useMyAvatarsFilters';
import { useMyAvatarsGridVirtualization } from './useMyAvatarsGridVirtualization';
import { useMyAvatarsRows } from './useMyAvatarsRows';
import { useMyAvatarsTableMeta } from './useMyAvatarsTableMeta';
import { useMyAvatarsTableState } from './useMyAvatarsTableState';
import { useMyAvatarsViewData } from './useMyAvatarsViewData';

export function useMyAvatarsPageController() {
    const filters = useMyAvatarsFilters();
    const rowsState = useMyAvatarsRows();
    const dialogs = useMyAvatarsDialogState();
    const viewData = useMyAvatarsViewData({
        avatars: rowsState.avatars,
        deferredSearchQuery: filters.deferredSearchQuery,
        platformFilter: filters.platformFilter,
        releaseStatusFilter: filters.releaseStatusFilter,
        tagFilters: filters.tagFilters
    });
    const tableState = useMyAvatarsTableState({
        deferredSearchQuery: filters.deferredSearchQuery,
        filteredCount: viewData.filteredAvatars.length,
        platformFilter: filters.platformFilter,
        releaseStatusFilter: filters.releaseStatusFilter,
        tagFilters: filters.tagFilters,
        viewMode: filters.viewMode
    });
    const actions = useMyAvatarsActions({
        avatars: rowsState.avatars,
        imageCropRequest: dialogs.imageCropRequest,
        imageUploadAuthTargetRef: dialogs.imageUploadAuthTargetRef,
        imageUploadAvatarRef: dialogs.imageUploadAvatarRef,
        imageUploadInputRef: dialogs.imageUploadInputRef,
        setAvatars: rowsState.setAvatars,
        setContentTagsAvatar: dialogs.setContentTagsAvatar,
        setDetail: rowsState.setDetail,
        setEditDetailsAvatar: dialogs.setEditDetailsAvatar,
        setImageCropRequest: dialogs.setImageCropRequest,
        setManageTagsAvatar: dialogs.setManageTagsAvatar
    });
    const tableMeta = useMyAvatarsTableMeta(actions.handleAvatarAction);
    const columns = useMyAvatarsColumns({
        savingTagsAvatarId: actions.savingTagsAvatarId,
        tableMeta,
        updatingAvatarId: actions.updatingAvatarId,
        uploadingImageAvatarId: actions.uploadingImageAvatarId
    });
    const table = useAppTable<MyAvatarRow>({
        data: viewData.filteredAvatars,
        columns,
        state: {
            sorting: tableState.sorting,
            pagination: tableState.pagination,
            columnVisibility: tableState.columnVisibility,
            columnOrder: tableState.columnOrder,
            columnSizing: tableState.columnSizing
        },
        onSortingChange: tableState.setSorting,
        onPaginationChange: tableState.setPagination,
        onColumnVisibilityChange: tableState.setColumnVisibility,
        onColumnOrderChange: tableState.handleColumnOrderChange,
        onColumnSizingChange: tableState.setColumnSizing,
        initialState: {
            columnVisibility: tableState.initialColumnVisibility
        },
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked: tableState.columnOrderLocked,
            setColumnOrderLocked: tableState.setColumnOrderLocked
        }
    });
    const grid = useMyAvatarsGridVirtualization({
        deferredSearchQuery: filters.deferredSearchQuery,
        filteredAvatars: viewData.filteredAvatars,
        gridDensity: filters.gridDensity,
        platformFilter: filters.platformFilter,
        releaseStatusFilter: filters.releaseStatusFilter,
        tagFilters: filters.tagFilters,
        viewMode: filters.viewMode
    });

    return {
        actions,
        dialogs,
        filters,
        grid,
        rowsState,
        table,
        tableState,
        viewData
    };
}
