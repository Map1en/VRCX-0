import { InviteMessageDialog } from '@/components/dialogs/InviteMessageDialog';
import { PageScaffold } from '@/components/layout/PageScaffold';
import { Tabs, TabsContent } from '@/ui/shadcn/tabs';

import { NotificationFeed } from './components/NotificationFeed';
import { NotificationPageToolbar } from './components/NotificationPageToolbar';
import { BoopReplyDialog } from './components/NotificationViewParts';
import { NotificationActionPendingContext } from './notificationActionPending';
import { useVrcNotificationPageController } from './useVrcNotificationPageController';

type VrcNotificationPageProps = {
    embedded?: boolean;
};

export function VrcNotificationPage({
    embedded = false
}: VrcNotificationPageProps = {}) {
    const {
        actions,
        dialogs,
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
    } = useVrcNotificationPageController();

    return (
        <>
            <PageScaffold embedded={embedded} flushBottom={!embedded}>
                <Tabs
                    value={filters.quickFilter}
                    onValueChange={(value) => {
                        if (
                            value === 'all' ||
                            value === 'action' ||
                            value === 'unread'
                        )
                            filters.setQuickFilter(value);
                    }}
                    className="flex min-h-0 flex-1 flex-col gap-0"
                >
                    <NotificationPageToolbar
                        activeTypes={filters.activeTypes}
                        searchQuery={filters.searchQuery}
                        quickFilter={filters.quickFilter}
                        notificationTypeLabel={notificationTypeLabel}
                        loadStatus={rowsState.loadStatus}
                        canMarkAllSeen={canMarkAllSeen}
                        isMarkingAllSeen={isMarkingAllSeen}
                        onActiveTypesChange={filters.setActiveTypes}
                        onSearchQueryChange={filters.setSearchQuery}
                        onMarkAllSeen={actions.markAllSeen}
                        onRefresh={rowsState.reload}
                        onClearFilters={filters.clearFilters}
                    />
                    <TabsContent
                        value={filters.quickFilter}
                        className="flex min-h-0 flex-1 flex-col"
                    >
                        <NotificationActionPendingContext
                            value={actions.pendingNotificationKeys}
                        >
                            <NotificationFeed
                                rows={pageRows}
                                table={table}
                                detail={rowsState.detail}
                                loadStatus={rowsState.loadStatus}
                                sourceRowsCount={sourceRowsCount}
                                hasActiveFilters={
                                    filters.activeTypes.length > 0 ||
                                    filters.quickFilter !== 'all' ||
                                    Boolean(filters.searchQuery.trim())
                                }
                                rowsCount={rowsState.rows.length}
                                pagination={tableState.pagination}
                                pageSizes={tableState.pageSizes}
                                onPageSizeChange={
                                    tableState.handlePageSizeChange
                                }
                                onClearFilters={filters.clearFilters}
                                currentUserId={
                                    runtime.currentUserId ?? undefined
                                }
                                canInviteFromCurrentLocation={
                                    runtime.canInviteFromCurrentLocation
                                }
                                handlers={handlers}
                            />
                        </NotificationActionPendingContext>
                    </TabsContent>
                </Tabs>
            </PageScaffold>
            <InviteMessageDialog
                open={Boolean(dialogs.inviteResponseRequest)}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        dialogs.setInviteResponseRequest(null);
                    }
                }}
                currentUserId={runtime.currentUserId}
                endpoint={runtime.endpoint}
                messageType={
                    dialogs.inviteResponseRequest?.messageType || 'response'
                }
                targetLabel={String(
                    dialogs.inviteResponseRequest?.notification
                        ?.senderUsername ||
                        dialogs.inviteResponseRequest?.notification
                            ?.senderUserId ||
                        'this user'
                )}
                allowEdit
                allowImageUpload={runtime.isLocalUserVrcPlusSupporter}
                onUse={(payload) => {
                    const request = dialogs.inviteResponseRequest;
                    if (!request) {
                        return undefined;
                    }
                    return actions.sendInviteResponseSlot({
                        ...payload,
                        notification: request.notification
                    });
                }}
            />
            <BoopReplyDialog
                request={dialogs.boopReplyRequest}
                isLocalUserVrcPlusSupporter={
                    runtime.isLocalUserVrcPlusSupporter
                }
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        dialogs.setBoopReplyRequest(null);
                    }
                }}
                onSend={actions.sendBoopReply}
            />
        </>
    );
}
