import { PersonStandingIcon, SearchXIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LoadingState, PageScaffold } from '@/components/layout/PageScaffold';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { IMAGE_UPLOAD_ACCEPT } from '@/shared/constants/imageUpload';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';

import { MyAvatarsDialogs } from './components/MyAvatarsDialogs';
import { MyAvatarsGridView } from './components/MyAvatarsGridView';
import { MyAvatarsTableView } from './components/MyAvatarsTableView';
import { MyAvatarsToolbar } from './components/MyAvatarsToolbar';
import { MyAvatarsEmptyState } from './components/MyAvatarsViewParts';
import { useMyAvatarsPageController } from './useMyAvatarsPageController';

export function MyAvatarsPage({
    embedded = false
}: { embedded?: boolean } = {}) {
    const { t } = useTranslation();
    const {
        actions,
        dialogs: { imageUploadInputRef, ...dialogs },
        filters,
        grid,
        rowsState,
        table,
        tableState,
        viewData
    } = useMyAvatarsPageController();
    const isLoading =
        rowsState.loadStatus === 'running' && rowsState.avatars.length === 0;
    const isError =
        rowsState.loadStatus === 'error' && rowsState.avatars.length === 0;
    const hasRows = viewData.filteredAvatars.length > 0;
    const hasAvatars = rowsState.avatars.length > 0;

    return (
        <PageScaffold embedded={embedded}>
            <Input
                ref={imageUploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={(event) => {
                    actions.onAvatarImageFileChange(event);
                }}
            />
            <div className="flex min-h-0 flex-1 flex-col gap-3">
                <MyAvatarsToolbar
                    source={filters.source}
                    onSourceChange={filters.setSource}
                    viewMode={filters.viewMode}
                    activeFilterCount={viewData.activeFilterCount}
                    allTags={viewData.allTags}
                    releaseStatusFilter={filters.releaseStatusFilter}
                    platformFilter={filters.platformFilter}
                    tagFilters={filters.tagFilters}
                    loadStatus={rowsState.loadStatus}
                    searchQuery={filters.searchQuery}
                    gridDensity={filters.gridDensity}
                    table={table}
                    onViewModeChange={filters.handleViewModeChange}
                    onReleaseStatusChange={filters.setReleaseStatusFilter}
                    onPlatformChange={filters.setPlatformFilter}
                    onTagFiltersChange={filters.setTagFilters}
                    onClearFilters={filters.clearFilters}
                    onSearchChange={filters.setSearchQuery}
                    onGridDensityChange={filters.handleGridDensityChange}
                    onRefresh={rowsState.refresh}
                />

                {rowsState.detail ? (
                    <div className="text-muted-foreground text-sm">
                        {userFacingErrorMessage(
                            rowsState.detail,
                            t(
                                'view.my_avatars.error.avatar_inventory_failed_to_load'
                            )
                        )}
                    </div>
                ) : null}

                {isLoading ? (
                    <LoadingState
                        label={t(
                            'view.my_avatars.loading.loading_the_avatar_inventory'
                        )}
                    />
                ) : isError ? (
                    <MyAvatarsEmptyState
                        title={t(
                            'view.my_avatars.error.avatar_inventory_failed_to_load'
                        )}
                        description={
                            rowsState.detail ||
                            t(
                                'view.my_avatars.success.avatar_request_did_not_complete'
                            )
                        }
                    />
                ) : hasRows ? (
                    filters.viewMode === 'table' ? (
                        <MyAvatarsTableView
                            table={table}
                            savingTagsAvatarId={actions.savingTagsAvatarId}
                            updatingAvatarId={actions.updatingAvatarId}
                            uploadingImageAvatarId={
                                actions.uploadingImageAvatarId
                            }
                            filteredCount={viewData.filteredAvatars.length}
                            pageSizes={tableState.pageSizes}
                            pagination={tableState.pagination}
                            onAvatarAction={actions.handleAvatarAction}
                            onPageSizeChange={tableState.handlePageSizeChange}
                        />
                    ) : (
                        <MyAvatarsGridView
                            densityConfig={grid.densityConfig}
                            gridScrollRef={grid.gridScrollRef}
                            gridTotalHeight={grid.gridTotalHeight}
                            visibleGridRows={grid.visibleGridRows}
                            gridGap={grid.gridGap}
                            gridColumnCount={grid.gridColumnCount}
                            gridMinWidth={grid.gridMinWidth}
                            gridPadding={grid.gridPadding}
                            savingTagsAvatarId={actions.savingTagsAvatarId}
                            updatingAvatarId={actions.updatingAvatarId}
                            uploadingImageAvatarId={
                                actions.uploadingImageAvatarId
                            }
                            onAvatarAction={actions.handleAvatarAction}
                        />
                    )
                ) : (
                    <MyAvatarsEmptyState
                        icon={hasAvatars ? SearchXIcon : PersonStandingIcon}
                        title={t(
                            hasAvatars
                                ? 'view.my_avatars.empty.no_avatars_match_the_current_filters'
                                : 'empty_state.my_avatars_title'
                        )}
                        description={t(
                            hasAvatars
                                ? 'view.my_avatars.label.broaden_the_filters_or_search_query_to_see_more_avatars'
                                : 'empty_state.my_avatars_description'
                        )}
                    >
                        <Button
                            type="button"
                            variant="link"
                            onClick={() => {
                                if (hasAvatars) {
                                    filters.clearFilters();
                                    filters.setSearchQuery('');
                                    return;
                                }
                                rowsState.refresh();
                            }}
                        >
                            {t(
                                hasAvatars
                                    ? 'view.my_avatars.action.clear_filters'
                                    : 'common.actions.refresh'
                            )}
                        </Button>
                    </MyAvatarsEmptyState>
                )}
            </div>
            <MyAvatarsDialogs
                editDetailsAvatar={dialogs.editDetailsAvatar}
                contentTagsAvatar={dialogs.contentTagsAvatar}
                imageCropRequest={dialogs.imageCropRequest}
                manageTagsAvatar={dialogs.manageTagsAvatar}
                savingTagsAvatarId={actions.savingTagsAvatarId}
                onEditDetailsOpenChange={(open) => {
                    if (!open) {
                        dialogs.setEditDetailsAvatar(null);
                    }
                }}
                onContentTagsOpenChange={(open) => {
                    if (!open) {
                        dialogs.setContentTagsAvatar(null);
                    }
                }}
                onImageCropOpenChange={(open) => {
                    if (!open) {
                        dialogs.clearImageUploadRequest();
                    }
                }}
                onImageCropConfirm={(blob) =>
                    actions.confirmAvatarImageUpload(blob)
                }
                onManageTagsOpenChange={(open) => {
                    if (!open && !actions.savingTagsAvatarId) {
                        dialogs.setManageTagsAvatar(null);
                    }
                }}
                onSaveTags={actions.handleSaveAvatarTags}
                onEditDetailsSaved={(nextAvatar) => {
                    actions.applyAvatarUpdate(nextAvatar);
                    rowsState.setDetail(
                        t('dialog.avatar.success.avatar_details_updated')
                    );
                }}
                onContentTagsSaved={(nextAvatar) => {
                    actions.applyAvatarUpdate(nextAvatar);
                    rowsState.setDetail(
                        t('dialog.avatar.success.avatar_content_tags_updated')
                    );
                }}
            />
        </PageScaffold>
    );
}
