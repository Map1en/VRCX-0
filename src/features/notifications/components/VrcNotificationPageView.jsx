export function VrcNotificationPageView({
    cn,
    embedded,
    NotificationPageToolbar,
    activeTypes,
    searchQuery,
    notificationTypeLabel,
    loadStatus,
    table,
    setActiveTypes,
    setSearchQuery,
    setReloadToken,
    t,
    NotificationPageTable,
    detail,
    rows,
    pagination,
    pageSizes,
    setPagination,
    resolvePageSize,
    InviteMessageDialog,
    inviteResponseRequest,
    setInviteResponseRequest,
    currentUserId,
    endpoint,
    isLocalUserVrcPlusSupporter,
    sendInviteResponseSlot,
    BoopReplyDialog,
    boopReplyRequest,
    setBoopReplyRequest,
    sendBoopReply
}) {
    return (
        <>
            <div
                className={cn(
                    'flex h-full min-h-0 flex-col gap-3',
                    embedded
                        ? 'p-3'
                        : 'x-container x-container--auto-height p-4 pb-0'
                )}
            >
                <NotificationPageToolbar
                    activeTypes={activeTypes}
                    searchQuery={searchQuery}
                    notificationTypeLabel={notificationTypeLabel}
                    loadStatus={loadStatus}
                    table={table}
                    onActiveTypesChange={setActiveTypes}
                    onSearchQueryChange={setSearchQuery}
                    onRefresh={() => setReloadToken((value) => value + 1)}
                    onClearFilters={() => setActiveTypes([])}
                    t={t}
                />
                <NotificationPageTable
                    table={table}
                    detail={detail}
                    loadStatus={loadStatus}
                    rowsCount={rows.length}
                    pagination={pagination}
                    pageSizes={pageSizes}
                    onPageSizeChange={(value) =>
                        setPagination({
                            pageIndex: 0,
                            pageSize: resolvePageSize(
                                value,
                                pageSizes,
                                pagination.pageSize
                            )
                        })
                    }
                    t={t}
                />
            </div>
            <InviteMessageDialog
                open={Boolean(inviteResponseRequest)}
                onOpenChange={(open) => {
                    if (!open) {
                        setInviteResponseRequest(null);
                    }
                }}
                currentUserId={currentUserId}
                endpoint={endpoint}
                messageType={inviteResponseRequest?.messageType || 'response'}
                mode="respond"
                targetLabel={
                    inviteResponseRequest?.notification?.senderUsername ||
                    inviteResponseRequest?.notification?.senderUserId ||
                    'this user'
                }
                allowEdit
                allowImageUpload={isLocalUserVrcPlusSupporter}
                onUse={(payload) =>
                    sendInviteResponseSlot({
                        ...payload,
                        notification: inviteResponseRequest?.notification
                    })
                }
            />
            <BoopReplyDialog
                request={boopReplyRequest}
                endpoint={endpoint}
                isLocalUserVrcPlusSupporter={isLocalUserVrcPlusSupporter}
                onOpenChange={(open) => {
                    if (!open) {
                        setBoopReplyRequest(null);
                    }
                }}
                onSend={sendBoopReply}
            />
        </>
    );
}
