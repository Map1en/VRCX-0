import { InviteMessageDialog } from '@/components/dialogs/InviteMessageDialog';
import { PageScaffold } from '@/components/layout/PageScaffold';

import { NotificationPageTable } from './components/NotificationPageTable';
import { NotificationPageToolbar } from './components/NotificationPageToolbar';
import { BoopReplyDialog } from './components/NotificationViewParts';
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
        notificationTypeLabel,
        rowsState,
        runtime,
        table,
        tableState
    } = useVrcNotificationPageController();

    return (
        <>
            <PageScaffold
                embedded={embedded}
                flushBottom={!embedded}
                className="gap-3"
            >
                <NotificationPageToolbar
                    activeTypes={filters.activeTypes}
                    searchQuery={filters.searchQuery}
                    notificationTypeLabel={notificationTypeLabel}
                    loadStatus={rowsState.loadStatus}
                    table={table}
                    onActiveTypesChange={filters.setActiveTypes}
                    onSearchQueryChange={filters.setSearchQuery}
                    onRefresh={rowsState.reload}
                    onClearFilters={filters.clearFilters}
                />
                <NotificationPageTable
                    table={table}
                    detail={rowsState.detail}
                    loadStatus={rowsState.loadStatus}
                    rowsCount={rowsState.rows.length}
                    pagination={tableState.pagination}
                    pageSizes={tableState.pageSizes}
                    onPageSizeChange={tableState.handlePageSizeChange}
                />
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
                mode="respond"
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
