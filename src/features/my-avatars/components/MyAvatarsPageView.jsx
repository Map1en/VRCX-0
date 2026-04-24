export function MyAvatarsPageView({
    cn,
    embedded,
    Input,
    imageUploadInputRef,
    IMAGE_UPLOAD_ACCEPT,
    onAvatarImageFileChange,
    MyAvatarsToolbar,
    t,
    viewMode,
    activeFilterCount,
    allTags,
    releaseStatusFilter,
    platformFilter,
    tagFilters,
    loadStatus,
    searchQuery,
    cardScale,
    cardSpacing,
    table,
    currentUserId,
    handleViewModeChange,
    setReleaseStatusFilter,
    setPlatformFilter,
    setTagFilters,
    setSearchQuery,
    setCardScale,
    setCardSpacing,
    setRefreshToken,
    detail,
    userFacingErrorMessage,
    isLoading,
    LoadingState,
    isError,
    MyAvatarsEmptyState,
    hasRows,
    MyAvatarsTableView,
    currentAvatarId,
    savingTagsAvatarId,
    updatingAvatarId,
    uploadingImageAvatarId,
    filteredAvatars,
    pageSizes,
    pagination,
    handleAvatarAction,
    resolveMyAvatarsPageSize,
    setPagination,
    MyAvatarsGridView,
    gridScrollRef,
    gridTotalHeight,
    visibleGridRows,
    gridGap,
    gridColumnCount,
    gridMinWidth,
    MyAvatarsDialogs,
    imageCropRequest,
    manageTagsAvatar,
    stylesAvatar,
    currentEndpoint,
    setImageCropRequest,
    imageUploadAvatarRef,
    imageUploadAuthTargetRef,
    confirmAvatarImageUpload,
    setManageTagsAvatar,
    handleSaveAvatarTags,
    setStylesAvatar,
    applyAvatarUpdate,
    setDetail
}) {
    return (
        <div
            className={cn(
                'flex h-full min-h-0 flex-col p-3',
                !embedded && 'x-container overflow-hidden'
            )}
        >
            <Input
                ref={imageUploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={(event) => void onAvatarImageFileChange(event)}
            />
            <div className="flex min-h-0 flex-1 flex-col gap-3">
                <MyAvatarsToolbar
                    t={t}
                    viewMode={viewMode}
                    activeFilterCount={activeFilterCount}
                    allTags={allTags}
                    releaseStatusFilter={releaseStatusFilter}
                    platformFilter={platformFilter}
                    tagFilters={tagFilters}
                    loadStatus={loadStatus}
                    searchQuery={searchQuery}
                    cardScale={cardScale}
                    cardSpacing={cardSpacing}
                    table={table}
                    currentUserId={currentUserId}
                    onViewModeChange={handleViewModeChange}
                    onReleaseStatusChange={setReleaseStatusFilter}
                    onPlatformChange={setPlatformFilter}
                    onTagFiltersChange={setTagFilters}
                    onClearFilters={() => {
                        setReleaseStatusFilter('all');
                        setPlatformFilter('all');
                        setTagFilters(new Set());
                    }}
                    onSearchChange={setSearchQuery}
                    onCardScaleChange={setCardScale}
                    onCardSpacingChange={setCardSpacing}
                    onRefresh={() => setRefreshToken((value) => value + 1)}
                />

                {detail ? (
                    <div className="text-muted-foreground text-sm">
                        {userFacingErrorMessage(
                            detail,
                            t(
                                'view.my_avatars.generated.avatar_inventory_failed_to_load'
                            )
                        )}
                    </div>
                ) : null}

                {isLoading ? (
                    <LoadingState
                        label={t(
                            'view.my_avatars.generated.loading_the_avatar_inventory'
                        )}
                    />
                ) : isError ? (
                    <MyAvatarsEmptyState
                        title={t(
                            'view.my_avatars.generated.avatar_inventory_failed_to_load'
                        )}
                        description={
                            detail ||
                            t(
                                'view.my_avatars.generated.avatar_request_did_not_complete'
                            )
                        }
                    />
                ) : hasRows ? (
                    viewMode === 'table' ? (
                        <MyAvatarsTableView
                            t={t}
                            table={table}
                            currentAvatarId={currentAvatarId}
                            savingTagsAvatarId={savingTagsAvatarId}
                            updatingAvatarId={updatingAvatarId}
                            uploadingImageAvatarId={uploadingImageAvatarId}
                            filteredCount={filteredAvatars.length}
                            pageSizes={pageSizes}
                            pagination={pagination}
                            onAvatarAction={handleAvatarAction}
                            onPageSizeChange={(value) => {
                                const nextPageSize = resolveMyAvatarsPageSize(
                                    value,
                                    pageSizes,
                                    pagination.pageSize
                                );
                                setPagination({
                                    pageIndex: 0,
                                    pageSize: nextPageSize
                                });
                            }}
                        />
                    ) : (
                        <MyAvatarsGridView
                            gridScrollRef={gridScrollRef}
                            gridTotalHeight={gridTotalHeight}
                            visibleGridRows={visibleGridRows}
                            gridGap={gridGap}
                            gridColumnCount={gridColumnCount}
                            gridMinWidth={gridMinWidth}
                            currentAvatarId={currentAvatarId}
                            cardScale={cardScale}
                            savingTagsAvatarId={savingTagsAvatarId}
                            updatingAvatarId={updatingAvatarId}
                            uploadingImageAvatarId={uploadingImageAvatarId}
                            onAvatarAction={handleAvatarAction}
                        />
                    )
                ) : (
                    <MyAvatarsEmptyState
                        title={t(
                            'view.my_avatars.generated.no_avatars_match_the_current_filters'
                        )}
                        description={t(
                            'view.my_avatars.generated.broaden_the_filters_or_search_query_to_see_more_avatars'
                        )}
                    />
                )}
            </div>
            <MyAvatarsDialogs
                t={t}
                imageCropRequest={imageCropRequest}
                manageTagsAvatar={manageTagsAvatar}
                savingTagsAvatarId={savingTagsAvatarId}
                stylesAvatar={stylesAvatar}
                currentUserId={currentUserId}
                currentEndpoint={currentEndpoint}
                onImageCropOpenChange={(open) => {
                    if (!open) {
                        setImageCropRequest(null);
                        imageUploadAvatarRef.current = null;
                        imageUploadAuthTargetRef.current = null;
                    }
                }}
                onImageCropConfirm={(blob) => confirmAvatarImageUpload(blob)}
                onManageTagsOpenChange={(open) => {
                    if (!open && !savingTagsAvatarId) {
                        setManageTagsAvatar(null);
                    }
                }}
                onSaveTags={handleSaveAvatarTags}
                onStylesOpenChange={(open) => {
                    if (!open) {
                        setStylesAvatar(null);
                    }
                }}
                onStylesSaved={(nextAvatar) => {
                    applyAvatarUpdate(nextAvatar);
                    setDetail(
                        t('view.my_avatars.generated.avatar_styles_updated')
                    );
                }}
            />
        </div>
    );
}
