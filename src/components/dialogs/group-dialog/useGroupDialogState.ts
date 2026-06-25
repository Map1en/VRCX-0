import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import gameLogRepository from '@/repositories/gameLogRepository';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { recordLocationHintsFromInstances } from '@/services/domainIngestionService';
import { useDialogStore } from '@/state/dialogStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { buildGroupDialogViewState } from './groupDialogViewState';
import { normalizeEntityId } from './groupInstances';
import { useGroupDialogActiveInstances } from './useGroupDialogActiveInstances';
import { useGroupOwnerProfile } from './useGroupOwnerProfile';

export function useGroupDialogState({ groupId, seedData = null }: any) {
    const { t } = useTranslation();

    const normalizedGroupId = normalizeEntityId(groupId);
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const currentLocation = useRuntimeStore(
        (state: any) => state.gameState.currentLocation
    );
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const confirm = useModalStore((state: any) => state.confirm);
    const updateEntityDialogMetadata = useDialogStore(
        (state: any) => state.updateEntityDialogMetadata
    );
    const [group, setGroup] = useState(() =>
        seedData ? groupProfileRepository.normalize(seedData) : null
    );
    const [loadStatus, setLoadStatus] = useState(
        normalizedGroupId ? 'running' : 'idle'
    );
    const [actionStatus, setActionStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [previousInstances, setPreviousInstances] = useState<any[]>([]);
    const actionStatusRef = useRef('idle');
    const activeGroupTargetRef = useRef<any>({
        groupId: normalizedGroupId,
        endpoint: currentEndpoint
    });
    const { activeInstances, setRawActiveInstances } =
        useGroupDialogActiveInstances({
            groupId: normalizedGroupId,
            friendsById,
            currentUserSnapshot,
            currentLocation
        });
    const ownerProfile = useGroupOwnerProfile({
        currentEndpoint,
        friendsById,
        group
    });

    useEffect(() => {
        setGroup(seedData ? groupProfileRepository.normalize(seedData) : null);
    }, [seedData]);

    useEffect(() => {
        activeGroupTargetRef.current = {
            groupId: normalizedGroupId,
            endpoint: currentEndpoint
        };
    }, [currentEndpoint, normalizedGroupId]);

    useEffect(() => {
        if (!group?.id || !group?.name) {
            return;
        }
        updateEntityDialogMetadata({
            kind: 'group',
            entityId: group.id,
            title: group.name
        });
    }, [group?.id, group?.name, updateEntityDialogMetadata]);

    useEffect(() => {
        let active = true;

        if (!normalizedGroupId) {
            setGroup(null);
            setLoadStatus('error');
            setDetail(
                t('dialog.group.empty.no_group_id_was_provided_for_this_dialog')
            );
            return () => {
                active = false;
            };
        }

        setGroup(seedData ? groupProfileRepository.normalize(seedData) : null);
        setPreviousInstances([]);
        setRawActiveInstances([]);
        setLoadStatus('running');
        setDetail('');

        groupProfileRepository
            .getGroupProfile({
                groupId: normalizedGroupId,
                endpoint: currentEndpoint,
                dialog: true
            })
            .then((nextGroup: any) => {
                if (!active) {
                    return;
                }

                setGroup(nextGroup);
                setLoadStatus('ready');
            })
            .catch((error: any) => {
                if (!active) {
                    return;
                }

                if (seedData) {
                    setGroup(groupProfileRepository.normalize(seedData));
                    setLoadStatus('ready');
                    setDetail(
                        error instanceof Error
                            ? error.message
                            : t(
                                  'dialog.group.error.failed_to_refresh_the_remote_group_snapshot'
                              )
                    );
                    return;
                }

                setGroup(null);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.group.error.failed_to_load_the_group_profile'
                          )
                );
            });

        return () => {
            active = false;
        };
    }, [
        currentEndpoint,
        normalizedGroupId,
        seedData,
        setRawActiveInstances,
        t
    ]);

    useEffect(() => {
        let active = true;

        if (!normalizedGroupId) {
            setPreviousInstances([]);
            return () => {
                active = false;
            };
        }

        gameLogRepository
            .getPreviousInstancesByGroupId(normalizedGroupId)
            .then((rows: any) => {
                if (!active) {
                    return;
                }
                const values =
                    rows instanceof Map ? Array.from(rows.values()) : [];
                setPreviousInstances(values);
            })
            .catch(() => {
                if (active) {
                    setPreviousInstances([]);
                }
            });

        return () => {
            active = false;
        };
    }, [normalizedGroupId]);

    useEffect(() => {
        let active = true;

        if (!normalizedGroupId || !currentUserId) {
            setRawActiveInstances([]);
            return () => {
                active = false;
            };
        }

        groupProfileRepository
            .getGroupInstances({
                groupId: normalizedGroupId,
                userId: currentUserId,
                endpoint: currentEndpoint
            })
            .then((response: any) => {
                if (!active) {
                    return;
                }
                const rows = Array.isArray(response.json)
                    ? response.json
                    : Array.isArray(response.json?.instances)
                      ? response.json.instances
                      : [];
                recordLocationHintsFromInstances({
                    endpoint: currentEndpoint,
                    instances: rows.map((row: any) => ({
                        ...row,
                        groupId: normalizedGroupId,
                        groupName: group?.name || group?.displayName || ''
                    }))
                });
                setRawActiveInstances(rows);
            })
            .catch(() => {
                if (active) {
                    setRawActiveInstances([]);
                }
            });

        return () => {
            active = false;
        };
    }, [
        currentEndpoint,
        currentUserId,
        group?.displayName,
        group?.name,
        normalizedGroupId,
        setRawActiveInstances
    ]);

    if (loadStatus === 'running' && !group) {
        return {
            status: 'loading',
            emptyState: {
                loading: true,
                title: t('dialog.group.loading.loading_group_profile'),
                description: t(
                    'dialog.group.loading.fetching_the_current_vrchat_group_snapshot_for_this_dialog'
                )
            }
        };
    }

    if (!group) {
        return {
            status: 'empty',
            emptyState: {
                title: t('dialog.group.error.group_profile_unavailable'),
                description:
                    detail ||
                    t(
                        'dialog.group.description.group_snapshot_unavailable_description'
                    )
            }
        };
    }

    const viewState = buildGroupDialogViewState({
        currentUserId,
        friendsById,
        group,
        ownerProfile
    });

    async function refreshGroupProfile() {
        const nextGroup = await groupProfileRepository.getGroupProfile({
            groupId: normalizedGroupId,
            endpoint: currentEndpoint,
            force: true
        });
        if (
            activeGroupTargetRef.current.groupId === normalizedGroupId &&
            activeGroupTargetRef.current.endpoint === currentEndpoint
        ) {
            setGroup(nextGroup);
        }
        return nextGroup;
    }

    function commitGroupSnapshot(nextGroup: any) {
        if (
            activeGroupTargetRef.current.groupId === normalizedGroupId &&
            activeGroupTargetRef.current.endpoint === currentEndpoint
        ) {
            setGroup(groupProfileRepository.normalize(nextGroup));
        }
    }

    async function joinGroup() {
        if (!viewState.canJoin || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'join';
        setActionStatus('join');
        try {
            const response = await groupProfileRepository.joinGroup({
                groupId: normalizedGroupId,
                endpoint: currentEndpoint
            });
            const nextStatus = normalizeEntityId(
                response.json?.membershipStatus
            ).toLowerCase();
            await refreshGroupProfile().catch(() => {
                if (response.json && typeof response.json === 'object') {
                    commitGroupSnapshot(response.json);
                }
            });
            toast.success(
                nextStatus === 'requested'
                    ? t('message.group.join_request_sent')
                    : t('message.group.joined')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.group.toast.failed_to_join_group')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function leaveGroup() {
        if (!viewState.isMember || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'leave';
        setActionStatus('leave');
        const result = await confirm({
            title: t('dialog.group.modal.leave_group'),
            description: t('dialog.group.dynamic.leave_value', {
                value: group?.name || group?.id
            }),
            destructive: true,
            confirmText: t('dialog.group.modal.leave'),
            cancelText: t('common.actions.cancel')
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            const response = await groupProfileRepository.leaveGroup({
                groupId: normalizedGroupId,
                endpoint: currentEndpoint
            });
            await refreshGroupProfile().catch(() => {
                if (response.json && typeof response.json === 'object') {
                    commitGroupSnapshot(response.json);
                }
            });
            toast.success(t('dialog.group.label.group_left'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.group.toast.failed_to_leave_group')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function cancelJoinRequest() {
        if (
            viewState.memberStatus !== 'requested' ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        actionStatusRef.current = 'cancel-request';
        setActionStatus('cancel-request');
        try {
            await groupProfileRepository.cancelGroupRequest({
                groupId: normalizedGroupId,
                endpoint: currentEndpoint
            });
            await refreshGroupProfile();
            toast.success(
                t('dialog.group.success.group_join_request_cancelled')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.group.toast.failed_to_cancel_group_join_request'
                      )
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function refreshGroup() {
        if (actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'refresh';
        setActionStatus('refresh');
        try {
            await refreshGroupProfile();
            toast.success(t('dialog.group.success.group_refreshed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.group.toast.failed_to_refresh_group')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateGroupRepresentation(enabled: any) {
        if (!viewState.isMember || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'represent';
        setActionStatus('represent');
        try {
            await groupProfileRepository.setGroupRepresentation({
                groupId: normalizedGroupId,
                isRepresenting: enabled,
                endpoint: currentEndpoint
            });
            await refreshGroupProfile();
            toast.success(
                enabled
                    ? t('dialog.group.toast.group_represented')
                    : t('dialog.group.toast.group_unrepresented')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.group.toast.failed_to_update_group_representation'
                      )
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateGroupMemberProps(params: any, label: any) {
        if (
            !viewState.isMember ||
            !currentUserId ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        actionStatusRef.current = 'member-props';
        setActionStatus('member-props');
        try {
            await groupProfileRepository.setGroupMemberProps({
                groupId: normalizedGroupId,
                userId: currentUserId,
                params,
                endpoint: currentEndpoint
            });
            await refreshGroupProfile();
            toast.success(label);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.group.toast.failed_to_update_group_member_settings'
                      )
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateGroupBlock(enabled: any) {
        if (
            viewState.isMember ||
            !currentUserId ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const result = await confirm({
            title: enabled
                ? t('dialog.group.modal.block_group')
                : t('dialog.group.modal.unblock_group'),
            description: group?.name || group?.id,
            confirmText: enabled
                ? t('dialog.group.actions.block')
                : t('dialog.group.actions.unblock'),
            cancelText: t('common.actions.cancel'),
            destructive: enabled
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'block';
        setActionStatus('block');
        try {
            if (enabled) {
                await groupProfileRepository.blockGroup({
                    groupId: normalizedGroupId,
                    endpoint: currentEndpoint
                });
            } else {
                await groupProfileRepository.unblockGroup({
                    groupId: normalizedGroupId,
                    userId: currentUserId,
                    endpoint: currentEndpoint
                });
            }
            await refreshGroupProfile();
            toast.success(
                enabled
                    ? t('dialog.group.toast.group_blocked')
                    : t('dialog.group.toast.group_unblocked')
            );
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('dialog.group.toast.failed_to_update_group_block_state')
                )
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return {
        status: 'ready',
        group,
        detail,
        actionStatus,
        activeInstances,
        previousInstances,
        setPreviousInstances,
        viewState,
        actions: {
            cancelJoinRequest,
            joinGroup,
            leaveGroup,
            refreshGroup,
            updateGroupBlock,
            updateGroupMemberProps,
            updateGroupRepresentation
        },
        labels: {
            subscribedToAnnouncements: t(
                'dialog.group.label.subscribed_to_announcements'
            ),
            unsubscribedAnnouncements: t(
                'dialog.group.members.unsubscribed_announcements'
            ),
            visibilityUpdated: t('message.group.visibility_updated')
        }
    };
}
