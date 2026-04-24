import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { backend } from '@/platform/tauri/backend.js';
import { groupProfileRepository } from '@/repositories/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { groupIdForRow } from './userDialogGroupRows.js';
import { normalizedText, summarizeEntityRow } from './userDialogRows.js';
import { downloadJsonFile } from './UserDialogViewParts.jsx';

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
}) {
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
            title: t('dialog.user.generated_modal.invite_to_group'),
            description: t(
                'dialog.user.generated_modal.enter_the_vrchat_group_id_to_invite_this_user_to'
            ),
            inputValue: '',
            confirmText: t('dialog.user.generated_modal.invite'),
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
            toast.success(t('dialog.user.generated.group_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.user.generated_toast.failed_to_send_group_invite'
                      )
            );
        }
    }

    async function refreshGroupsAfterMembershipChange() {
        await refreshGroups();
    }

    async function changeGroupVisibility(group, visibility) {
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
            toast.success(t('dialog.user.generated.group_visibility_updated'));
            await refreshGroupsAfterMembershipChange();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.user.generated_toast.failed_to_update_group_visibility'
                      )
            );
        } finally {
            setGroupActionId('');
        }
    }

    async function leaveUserGroup(group) {
        const groupId = groupIdForRow(group);
        if (!groupId || groupActionId) {
            return;
        }
        const result = await confirm({
            title: t('dialog.user.generated_modal.leave_group'),
            description: t('dialog.user.generated_dynamic.leave_value', {
                value: summarizeEntityRow(group, groupId)
            }),
            confirmText: t('dialog.user.generated_modal.leave'),
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
            toast.success(t('dialog.user.generated.left_group'));
            await refreshGroupsAfterMembershipChange();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.generated_toast.failed_to_leave_group')
            );
        } finally {
            setGroupActionId('');
        }
    }

    function setGroupSelected(group, selected) {
        const groupId = groupIdForRow(group);
        if (!groupId) {
            return;
        }
        setSelectedGroupIds((current) => {
            const next = new Set(current);
            if (selected) {
                next.add(groupId);
            } else {
                next.delete(groupId);
            }
            return next;
        });
    }

    function selectVisibleGroups(rows) {
        setSelectedGroupIds((current) => {
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

    function exportUserGroups(rows) {
        const groups = rows.length ? rows : profileGroups;
        if (!groups.length) {
            toast.error(t('dialog.user.generated.no_groups_to_export'));
            return;
        }
        const filenameUser =
            normalizedText(
                profile.username || profile.displayName || profile.id
            ).replace(/[^a-z0-9_-]+/gi, '_') || 'user';
        downloadJsonFile(`vrcx-${filenameUser}-groups.json`, groups);
        toast.success(
            t('dialog.user.generated_dynamic.exported_value_groups', {
                value: groups.length
            })
        );
    }

    async function changeSelectedGroupsVisibility(visibility) {
        if (!selectedUserGroups.length || !currentUserId || groupActionId) {
            return;
        }
        setGroupActionId('__bulk_groups__');
        try {
            const results = await Promise.allSettled(
                selectedUserGroups.map((group) =>
                    groupProfileRepository.setGroupMemberProps({
                        groupId: groupIdForRow(group),
                        userId: currentUserId,
                        endpoint: currentEndpoint,
                        params: { visibility }
                    })
                )
            );
            const failed = results.filter(
                (result) => result.status === 'rejected'
            ).length;
            if (failed) {
                toast.error(
                    t(
                        'dialog.user.generated_dynamic.failed_to_update_value_groups',
                        { value: failed }
                    )
                );
            } else {
                toast.success(
                    t('dialog.user.generated_dynamic.updated_value_groups', {
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
            title: t('dialog.user.generated_modal.leave_selected_groups'),
            description: t(
                'dialog.user.generated_dynamic.leave_value_selected_groups',
                { value: selectedUserGroups.length }
            ),
            confirmText: t('dialog.user.generated_modal.leave'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        setGroupActionId('__bulk_groups__');
        try {
            const results = await Promise.allSettled(
                selectedUserGroups.map((group) =>
                    groupProfileRepository.leaveGroup({
                        groupId: groupIdForRow(group),
                        endpoint: currentEndpoint
                    })
                )
            );
            const failed = results.filter(
                (entry) => entry.status === 'rejected'
            ).length;
            if (failed) {
                toast.error(
                    t(
                        'dialog.user.generated_dynamic.failed_to_leave_value_groups',
                        { value: failed }
                    )
                );
            } else {
                toast.success(
                    t('dialog.user.generated_dynamic.left_value_groups', {
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
        const nextOrder = [];
        const seen = new Set();
        const pushGroupId = (groupId) => {
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

    async function moveGroupInGameOrder(group, direction) {
        const groupId = groupIdForRow(group);
        if (!isCurrentUser || !currentUserId || !groupId || groupActionId) {
            return;
        }
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
        useRuntimeStore
            .getState()
            .setGroupInstancesState({ groupOrder: nextOrder });
        setGroupSort('inGame');
        try {
            await backend.app.SetVRChatRegistryKey(
                `VRC_GROUP_ORDER_${currentUserId}`,
                JSON.stringify(nextOrder),
                3
            );
            toast.success(t('dialog.user.generated.group_order_updated'));
        } catch (error) {
            useRuntimeStore
                .getState()
                .setGroupInstancesState({ groupOrder: previousOrder });
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.user.generated_toast.failed_to_update_group_order'
                      )
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
