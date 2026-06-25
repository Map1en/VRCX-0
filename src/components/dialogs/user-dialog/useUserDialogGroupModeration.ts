import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type {
    GroupQuickModerationGroup,
    GroupQuickModerationOutput
} from '@/platform/tauri/bindings';
import {
    getGroupQuickModeration,
    runGroupQuickModerationAction,
    type GroupQuickModerationAction
} from '@/services/groupQuickModerationService';

import {
    createDelayedVisibleController,
    groupQuickModerationLoadingDelayMs
} from './groupQuickModerationLoading';
import { normalizeUserId } from './userProfileFields';

type GroupsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface UseUserDialogGroupModerationInput {
    open: boolean;
    endpoint?: string;
    currentUserId?: string;
    targetUserId?: string;
}

function groupIdSet(groups: GroupQuickModerationGroup[]) {
    return new Set(groups.map((group) => group.groupId));
}

export function useDelayedGroupQuickModerationLoading(
    loading: boolean,
    identity: string
) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const controller = createDelayedVisibleController(
            setVisible,
            groupQuickModerationLoadingDelayMs
        );
        if (loading) {
            controller.start();
        } else {
            controller.stop();
        }
        return () => {
            controller.dispose();
        };
    }, [identity, loading]);

    return visible;
}

function emptyOutput(
    currentUserId: string,
    targetUserId: string
): GroupQuickModerationOutput {
    return {
        currentUserId,
        targetUserId,
        stale: false,
        kickGroups: [],
        banGroups: [],
        membershipErrorCount: 0
    };
}

export function useUserDialogGroupModeration({
    open,
    endpoint = '',
    currentUserId = '',
    targetUserId = ''
}: UseUserDialogGroupModerationInput) {
    const { t } = useTranslation();
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const normalizedTargetUserId = normalizeUserId(targetUserId);
    const identity = `${endpoint}:${normalizedCurrentUserId}:${normalizedTargetUserId}`;
    const loadRequestRef = useRef(0);
    const [groupsStatus, setGroupsStatus] = useState<GroupsStatus>('idle');
    const [groupsError, setGroupsError] = useState('');
    const [model, setModel] = useState<GroupQuickModerationOutput>(() =>
        emptyOutput(normalizedCurrentUserId, normalizedTargetUserId)
    );
    const [reloadToken, setReloadToken] = useState(0);
    const [pendingKickGroupId, setPendingKickGroupId] = useState('');
    const [kickBusyGroupId, setKickBusyGroupId] = useState('');
    const [selectedBanGroupId, setSelectedBanGroupId] = useState('');
    const [banBusy, setBanBusy] = useState(false);
    const [pendingBanGroupId, setPendingBanGroupId] = useState('');

    const groupsLoadingVisible = useDelayedGroupQuickModerationLoading(
        groupsStatus === 'loading',
        `${identity}:${reloadToken}:groups`
    );
    const banGroupsById = useMemo(() => {
        return new Map(model.banGroups.map((group) => [group.groupId, group]));
    }, [model.banGroups]);
    const selectedBanGroup = selectedBanGroupId
        ? banGroupsById.get(selectedBanGroupId) || null
        : null;
    const detailedGroupId =
        selectedBanGroupId ||
        model.banGroups[0]?.groupId ||
        model.kickGroups[0]?.groupId ||
        '';

    useEffect(() => {
        if (!open) {
            loadRequestRef.current += 1;
            setGroupsStatus('idle');
            setGroupsError('');
            setModel(emptyOutput('', ''));
            setPendingKickGroupId('');
            setKickBusyGroupId('');
            setSelectedBanGroupId('');
            setBanBusy(false);
            setPendingBanGroupId('');
            return;
        }

        setPendingKickGroupId('');
        setKickBusyGroupId('');
        setSelectedBanGroupId('');
        setBanBusy(false);
        setPendingBanGroupId('');

        if (
            !normalizedCurrentUserId ||
            !normalizedTargetUserId ||
            normalizedCurrentUserId === normalizedTargetUserId
        ) {
            setGroupsStatus('ready');
            setGroupsError('');
            setModel(
                emptyOutput(normalizedCurrentUserId, normalizedTargetUserId)
            );
            return;
        }

        const requestId = loadRequestRef.current + 1;
        loadRequestRef.current = requestId;
        setGroupsStatus('loading');
        setGroupsError('');
        getGroupQuickModeration({
            endpoint,
            currentUserId: normalizedCurrentUserId,
            targetUserId: normalizedTargetUserId
        })
            .then((output) => {
                if (loadRequestRef.current !== requestId) {
                    return;
                }
                setModel(output);
                setGroupsStatus('ready');
                const availableBanGroupIds = groupIdSet(output.banGroups);
                setSelectedBanGroupId((current) =>
                    current && availableBanGroupIds.has(current) ? current : ''
                );
                setPendingBanGroupId((current) =>
                    current && availableBanGroupIds.has(current) ? current : ''
                );
                if (output.stale) {
                    toast.info(t('dialog.user.group_moderation.stale'));
                }
                if (output.membershipErrorCount > 0) {
                    toast.warning(
                        t('dialog.user.group_moderation.membership_partial', {
                            count: output.membershipErrorCount
                        })
                    );
                }
            })
            .catch((error: unknown) => {
                if (loadRequestRef.current !== requestId) {
                    return;
                }
                setGroupsStatus('error');
                setGroupsError(
                    userFacingErrorMessage(
                        error,
                        t('dialog.user.group_moderation.load_failed')
                    )
                );
            });
    }, [
        endpoint,
        identity,
        normalizedCurrentUserId,
        normalizedTargetUserId,
        open,
        reloadToken,
        t
    ]);

    function reload() {
        setReloadToken((token) => token + 1);
    }

    async function runAction(
        groupId: string,
        action: GroupQuickModerationAction
    ) {
        await runGroupQuickModerationAction({
            endpoint,
            currentUserId: normalizedCurrentUserId,
            targetUserId: normalizedTargetUserId,
            groupId,
            action
        });
    }

    async function kickGroup(group: GroupQuickModerationGroup) {
        if (kickBusyGroupId || !group.groupId) {
            return;
        }
        setKickBusyGroupId(group.groupId);
        try {
            await runAction(group.groupId, 'kick');
            setModel((current) => ({
                ...current,
                kickGroups: current.kickGroups.filter(
                    (row) => row.groupId !== group.groupId
                )
            }));
            setPendingKickGroupId('');
            toast.success(
                t('dialog.user.group_moderation.kick_success', {
                    value: group.name || group.groupId
                })
            );
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('dialog.user.group_moderation.kick_failed')
                )
            );
        } finally {
            setKickBusyGroupId('');
        }
    }

    async function runBanAction() {
        if (banBusy || !selectedBanGroupId) {
            return;
        }
        const group = selectedBanGroup;
        setBanBusy(true);
        try {
            await runAction(selectedBanGroupId, 'ban');
            setPendingBanGroupId('');
            toast.success(
                t('dialog.user.group_moderation.ban_success', {
                    value: group?.name || selectedBanGroupId || targetUserId
                })
            );
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('dialog.user.group_moderation.ban_failed')
                )
            );
        } finally {
            setBanBusy(false);
        }
    }

    return {
        banBusy,
        banGroups: model.banGroups,
        detailedGroupId,
        groupsError,
        groupsLoadingVisible,
        groupsStatus,
        kickBusyGroupId,
        kickGroup,
        kickGroups: model.kickGroups,
        pendingBanGroupId,
        pendingKickGroupId,
        reload,
        runBanAction,
        selectedBanGroup,
        selectedBanGroupId,
        setPendingBanGroupId,
        setPendingKickGroupId,
        setSelectedBanGroupId
    };
}
