import type { GroupMemberVisibility } from '@/platform/tauri/bindings';

import { GroupDialogEmptyState } from './group-dialog/GroupDialogEmptyState';
import { GroupDialogTabbedView } from './group-dialog/GroupDialogTabbedView';
import { useGroupDialogState } from './group-dialog/useGroupDialogState';

function isEntityRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function GroupDialogContent({
    groupId,
    seedData = null
}: {
    groupId?: string;
    seedData?: unknown;
}) {
    const normalizedSeedData = isEntityRecord(seedData) ? seedData : null;
    const dialogState = useGroupDialogState({
        groupId,
        seedData: normalizedSeedData
    });

    if (dialogState.status !== 'ready') {
        return <GroupDialogEmptyState {...dialogState.emptyState} />;
    }

    const {
        actionStatus,
        actions,
        activeInstances,
        detail,
        group,
        labels,
        previousInstances,
        setPreviousInstances,
        viewState
    } = dialogState;

    return (
        <GroupDialogTabbedView
            groupResource={{
                group,
                detail,
                actionStatus,
                activeInstances,
                previousInstances
            }}
            groupView={viewState}
            groupControls={{
                onPreviousInstancesChange: setPreviousInstances,
                onRefresh: () => {
                    actions.refreshGroup();
                },
                onReloadProfile: () => {
                    actions.reloadGroupProfile().catch(() => {});
                },
                onJoin: () => {
                    actions.joinGroup();
                },
                onLeave: () => {
                    actions.leaveGroup();
                },
                onDelete: () => {
                    actions.deleteGroup();
                },
                onCancelRequest: () => {
                    actions.cancelJoinRequest();
                },
                onRepresent: (enabled: boolean) => {
                    actions.updateGroupRepresentation(enabled);
                },
                onSubscribe: (enabled: boolean) => {
                    actions.updateGroupMemberProps(
                        { isSubscribedToAnnouncements: enabled },
                        enabled
                            ? labels.subscribedToAnnouncements
                            : labels.unsubscribedAnnouncements
                    );
                },
                onVisibility: (visibility: GroupMemberVisibility) => {
                    actions.updateGroupMemberProps(
                        { visibility },
                        labels.visibilityUpdated
                    );
                },
                onBlock: (enabled: boolean) => {
                    actions.updateGroupBlock(enabled);
                },
                onUpdateProfile: actions.updateGroupProfile
            }}
        />
    );
}
