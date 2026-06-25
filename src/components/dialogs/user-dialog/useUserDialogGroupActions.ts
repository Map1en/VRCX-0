import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import groupProfileRepository from '@/repositories/groupProfileRepository';
import { setVrchatRegistryKey } from '@/services/shellIntegrationService';
import { useRuntimeStore } from '@/state/runtimeStore';

import { groupIdForRow } from './userDialogGroupRows';
import { normalizedText, summarizeEntityRow } from './userDialogRows';
import { downloadJsonFile } from './UserDialogViewParts';

export function useUserDialogGroupActions({
    confirm,
    currentEndpoint,
    currentUserId,
    inGameGroupOrder,
    isCurrentUser,
    profile,
    profileGroups,
    prompt,
    refreshGroups,
    selectedGroupIds,
    selectedUserGroups,
    setGroupSort,
    setSelectedGroupIds,
    t
}: any) {
    const [groupActionId, setGroupActionId] = useState('');
    const [groupEditMode, setGroupEditMode] = useState(false);

    useEffect(() => {
        setGroupEditMode(false);
        setSelectedGroupIds(new Set());
    }, [currentUserId, profile.id, setSelectedGroupIds]);

    async function inviteToGroup() {
        if (!profile.id) {
            return;
        }
        const result = await prompt({
            title: t('dialog.user.actions.invite_to_group'),
            description: t(
                'dialog.user.modal.enter_the_vrchat_group_id_to_invite_this_user_to'
            ),
            inputValue: '',
            confirmText: t('dialog.user.actions.invite'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            await groupProfileRepository.sendGroupInvite({
                groupId: result.value,
                userId: profile.id,
                endpoint: currentEndpoint
            });
            toast.success(t('dialog.user.success.group_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_send_group_invite')
            );
        }
    }

    async function refreshGroupsAfterMembershipChange() {
        await refreshGroups();
    }

    async function changeGroupVisibility(group: any, visibility: any) {
        const groupId = groupIdForRow(group);
        if (!groupId || !currentUserId || groupActionId) {
            return;
        }
        setGroupActionId(groupId);
        try {
            await groupProfileRepository.setGroupMemberProps({
                groupId,
                userId: currentUserId,
                endpoint: currentEndpoint,
                params: { visibility }
            });
            toast.success(t('message.group.visibility_updated'));
            await refreshGroupsAfterMembershipChange();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_update_group_visibility')
            );
        } finally {
            setGroupActionId('');
        }
    }

    async function leaveUserGroup(group: any) {
        const groupId = groupIdForRow(group);
        if (!groupId || groupActionId) {
            return;
        }
        const result = await confirm({
            title: t('dialog.user.modal.leave_group'),
            description: t('dialog.user.dynamic.leave_value', {
                value: summarizeEntityRow(group, groupId)
            }),
            confirmText: t('dialog.user.modal.leave'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setGroupActionId(groupId);
        try {
            await groupProfileRepository.leaveGroup({
                groupId,
                endpoint: currentEndpoint
            });
            toast.success(t('dialog.user.success.left_group'));
            await refreshGroupsAfterMembershipChange();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_leave_group')
            );
        } finally {
            setGroupActionId('');
        }
    }

    function setGroupSelected(group: any, selected: any) {
        const groupId = groupIdForRow(group);
        if (!groupId) {
            return;
        }
        setSelectedGroupIds((current: any) => {
            const next = new Set(current);
            if (selected) {
                next.add(groupId);
            } else {
                next.delete(groupId);
            }
            return next;
        });
    }

    function selectVisibleGroups(rows: any) {
        setSelectedGroupIds((current: any) => {
            const next = new Set(current);
            for (const group of rows) {
                const groupId = groupIdForRow(group);
                if (groupId) {
                    next.add(groupId);
                }
            }
            return next;
        });
    }

    function clearSelectedGroups() {
        setSelectedGroupIds(new Set());
    }

    function exportUserGroups(rows: any) {
        const groups = rows.length ? rows : profileGroups;
        if (!groups.length) {
            toast.error(t('dialog.user.empty.no_groups_to_export'));
            return;
        }
        const filenameUser =
            normalizedText(
                profile.username || profile.displayName || profile.id
            ).replace(/[^a-z0-9_-]+/gi, '_') || 'user';
        downloadJsonFile(`vrcx-${filenameUser}-groups.json`, groups);
        toast.success(
            t('dialog.user.dynamic.exported_value_groups', {
                value: groups.length
            })
        );
    }

    async function changeSelectedGroupsVisibility(visibility: any) {
        if (!selectedUserGroups.length || !currentUserId || groupActionId) {
            return;
        }
        setGroupActionId('__bulk_groups__');
        try {
            const results = await Promise.allSettled(
                selectedUserGroups.map((group: any) =>
                    groupProfileRepository.setGroupMemberProps({
                        groupId: groupIdForRow(group),
                        userId: currentUserId,
                        endpoint: currentEndpoint,
                        params: { visibility }
                    })
                )
            );
            const failed = results.filter(
                (result: any) => result.status === 'rejected'
            ).length;
            if (failed) {
                toast.error(
                    t('dialog.user.dynamic.failed_to_update_value_groups', {
                        value: failed
                    })
                );
            } else {
                toast.success(
                    t('dialog.user.dynamic.updated_value_groups', {
                        value: selectedUserGroups.length
                    })
                );
            }
            await refreshGroupsAfterMembershipChange();
        } finally {
            setGroupActionId('');
        }
    }

    async function leaveSelectedGroups() {
        if (!selectedUserGroups.length || groupActionId) {
            return;
        }
        const result = await confirm({
            title: t('dialog.user.modal.leave_selected_groups'),
            description: t('dialog.user.dynamic.leave_value_selected_groups', {
                value: selectedUserGroups.length
            }),
            confirmText: t('dialog.user.modal.leave'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        setGroupActionId('__bulk_groups__');
        try {
            const results = await Promise.allSettled(
                selectedUserGroups.map((group: any) =>
                    groupProfileRepository.leaveGroup({
                        groupId: groupIdForRow(group),
                        endpoint: currentEndpoint
                    })
                )
            );
            const failed = results.filter(
                (entry: any) => entry.status === 'rejected'
            ).length;
            if (failed) {
                toast.error(
                    t('dialog.user.dynamic.failed_to_leave_value_groups', {
                        value: failed
                    })
                );
            } else {
                toast.success(
                    t('dialog.user.dynamic.left_value_groups', {
                        value: selectedUserGroups.length
                    })
                );
                clearSelectedGroups();
            }
            await refreshGroupsAfterMembershipChange();
        } finally {
            setGroupActionId('');
        }
    }

    function editableGroupOrder() {
        const nextOrder: string[] = [];
        const seen = new Set();
        const pushGroupId = (groupId: any) => {
            const normalizedGroupId = normalizedText(groupId);
            if (!normalizedGroupId || seen.has(normalizedGroupId)) {
                return;
            }
            seen.add(normalizedGroupId);
            nextOrder.push(normalizedGroupId);
        };
        for (const groupId of inGameGroupOrder || []) {
            pushGroupId(groupId);
        }
        for (const group of profileGroups) {
            pushGroupId(groupIdForRow(group));
        }
        return nextOrder;
    }

    async function moveGroupInGameOrder(group: any, direction: any) {
        const groupId = groupIdForRow(group);
        if (!isCurrentUser || !currentUserId || !groupId || groupActionId) {
            return;
        }
        const isCurrentGroupOrderScope = () => {
            const state = useRuntimeStore.getState();
            return (
                state.auth.currentUserId === currentUserId &&
                state.auth.currentUserEndpoint === currentEndpoint
            );
        };
        const previousOrder = editableGroupOrder();
        const index = previousOrder.indexOf(groupId);
        if (index === -1) {
            return;
        }
        const nextOrder = previousOrder.slice();
        nextOrder.splice(index, 1);
        let nextIndex = index;
        if (direction === 'top') {
            nextIndex = 0;
        } else if (direction === 'bottom') {
            nextIndex = nextOrder.length;
        } else if (direction === 'up') {
            nextIndex = Math.max(0, index - 1);
        } else if (direction === 'down') {
            nextIndex = Math.min(nextOrder.length, index + 1);
        }
        nextOrder.splice(nextIndex, 0, groupId);
        if (previousOrder.join('\u0000') === nextOrder.join('\u0000')) {
            return;
        }
        setGroupActionId(groupId);
        if (isCurrentGroupOrderScope()) {
            useRuntimeStore.getState().setGroupInstancesState({
                userId: currentUserId,
                endpoint: currentEndpoint,
                groupOrder: nextOrder
            });
        }
        setGroupSort('inGame');
        try {
            await setVrchatRegistryKey(
                `VRC_GROUP_ORDER_${currentUserId}`,
                JSON.stringify(nextOrder),
                3
            );
            toast.success(t('dialog.user.success.group_order_updated'));
        } catch (error) {
            if (isCurrentGroupOrderScope()) {
                useRuntimeStore.getState().setGroupInstancesState({
                    userId: currentUserId,
                    endpoint: currentEndpoint,
                    groupOrder: previousOrder
                });
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_update_group_order')
            );
        } finally {
            setGroupActionId('');
        }
    }

    return {
        changeGroupVisibility,
        changeSelectedGroupsVisibility,
        clearSelectedGroups,
        exportUserGroups,
        groupActionId,
        groupEditMode,
        inviteToGroup,
        leaveSelectedGroups,
        leaveUserGroup,
        moveGroupInGameOrder,
        selectVisibleGroups,
        selectedGroupIds,
        setGroupEditMode,
        setGroupSelected
    };
}
