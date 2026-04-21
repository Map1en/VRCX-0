import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import {
    gameLogRepository,
    groupProfileRepository,
    userProfileRepository
} from '@/repositories/index.js';
import { useDialogStore } from '@/state/dialogStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    mergeGroupInstances,
    normalizeEntityId
} from './group-dialog/groupInstances.js';
import { GroupDialogTabbedView } from './GroupDialogTabbedView.jsx';

function GroupDialogEmptyState({ title, description, loading = false }) {
    return (
        <div className="bg-muted/20 flex min-h-56 items-center justify-center rounded-xl border border-dashed p-6 text-center">
            <div className="flex max-w-sm flex-col gap-2">
                {loading ? (
                    <div className="flex justify-center">
                        <Spinner className="text-muted-foreground size-5" />
                    </div>
                ) : null}
                <div className="text-sm font-medium">{title}</div>
                <div className="text-muted-foreground text-sm">
                    {description}
                </div>
            </div>
        </div>
    );
}

export function GroupDialogContent({ groupId, seedData = null }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const confirm = useModalStore((state) => state.confirm);
    const updateEntityDialogMetadata = useDialogStore(
        (state) => state.updateEntityDialogMetadata
    );
    const [group, setGroup] = useState(() =>
        seedData ? groupProfileRepository.normalize(seedData) : null
    );
    const [loadStatus, setLoadStatus] = useState(
        normalizedGroupId ? 'running' : 'idle'
    );
    const [actionStatus, setActionStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [ownerProfile, setOwnerProfile] = useState(null);
    const [previousInstances, setPreviousInstances] = useState([]);
    const [rawActiveInstances, setRawActiveInstances] = useState([]);
    const actionStatusRef = useRef('idle');
    const activeGroupTargetRef = useRef({
        groupId: normalizedGroupId,
        endpoint: currentEndpoint
    });
    const activeInstances = useMemo(
        () =>
            mergeGroupInstances(rawActiveInstances, {
                groupId: normalizedGroupId,
                friendsById,
                currentUserSnapshot,
                currentLocation
            }),
        [
            currentLocation,
            currentUserSnapshot,
            friendsById,
            normalizedGroupId,
            rawActiveInstances
        ]
    );

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
        const ownerId = normalizeEntityId(group?.ownerId);
        setOwnerProfile(null);

        if (!ownerId || friendsById[ownerId]?.displayName) {
            return () => {
                active = false;
            };
        }

        userProfileRepository
            .getUserProfile({
                userId: ownerId,
                endpoint: currentEndpoint
            })
            .then((profile) => {
                if (active) {
                    setOwnerProfile(profile);
                }
            })
            .catch(() => {
                if (active) {
                    setOwnerProfile(null);
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, friendsById, group?.ownerId]);

    useEffect(() => {
        let active = true;

        if (!normalizedGroupId) {
            setGroup(null);
            setLoadStatus('error');
            setDetail('No group id was provided for this dialog.');
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
                endpoint: currentEndpoint
            })
            .then((nextGroup) => {
                if (!active) {
                    return;
                }

                setGroup(nextGroup);
                setLoadStatus('ready');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                if (seedData) {
                    setGroup(groupProfileRepository.normalize(seedData));
                    setLoadStatus('ready');
                    setDetail(
                        error instanceof Error
                            ? error.message
                            : 'Failed to refresh the remote group snapshot.'
                    );
                    return;
                }

                setGroup(null);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load the group profile.'
                );
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, normalizedGroupId, seedData]);

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
            .then((rows) => {
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
            .then((response) => {
                if (!active) {
                    return;
                }
                const rows = Array.isArray(response.json)
                    ? response.json
                    : Array.isArray(response.json?.instances)
                      ? response.json.instances
                      : [];
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
    }, [currentEndpoint, currentUserId, normalizedGroupId]);

    if (loadStatus === 'running' && !group) {
        return (
            <GroupDialogEmptyState
                loading
                title="Loading group profile"
                description="Fetching the current VRChat group snapshot for this dialog."
            />
        );
    }

    if (!group) {
        return (
            <GroupDialogEmptyState
                title="Group profile unavailable"
                description={
                    detail ||
                    'VRCX could not resolve a group snapshot for this dialog.'
                }
            />
        );
    }

    const bannerUrl = convertFileUrlToImageUrl(group.bannerUrl, 1024);
    const iconUrl = convertFileUrlToImageUrl(group.iconUrl, 256);
    const memberStatus = normalizeEntityId(
        group.myMember?.membershipStatus || group.membershipStatus
    ).toLowerCase();
    const isMember = memberStatus === 'member';
    const isBlocked = memberStatus === 'userblocked';
    const isRepresenting = Boolean(group.myMember?.isRepresenting);
    const isSubscribedToAnnouncements = Boolean(
        group.myMember?.isSubscribedToAnnouncements
    );
    const memberVisibility =
        normalizeEntityId(group.myMember?.visibility || 'visible') || 'visible';
    const joinState = normalizeEntityId(group.joinState).toLowerCase();
    const ownerDisplayName =
        normalizeEntityId(
            group.ownerDisplayName ||
                group.ownerName ||
                group.owner?.displayName ||
                ownerProfile?.displayName ||
                ownerProfile?.username ||
                ownerProfile?.name
        ) ||
        normalizeEntityId(friendsById[group.ownerId]?.displayName) ||
        normalizeEntityId(group.ownerId);
    const canJoin =
        !isMember &&
        memberStatus !== 'requested' &&
        memberStatus !== 'userblocked' &&
        (joinState === 'open' ||
            joinState === 'request' ||
            memberStatus === 'invited');

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

    function commitGroupSnapshot(nextGroup) {
        if (
            activeGroupTargetRef.current.groupId === normalizedGroupId &&
            activeGroupTargetRef.current.endpoint === currentEndpoint
        ) {
            setGroup(groupProfileRepository.normalize(nextGroup));
        }
    }

    async function joinGroup() {
        if (!canJoin || actionStatusRef.current !== 'idle') {
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
                    ? 'Group join request sent.'
                    : 'Group joined.'
            );
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : 'Failed to join group.'
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function leaveGroup() {
        if (!isMember || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'leave';
        setActionStatus('leave');
        const result = await confirm({
            title: 'Leave group?',
            description: `Leave ${group.name || group.id}?`,
            destructive: true,
            confirmText: 'Leave',
            cancelText: 'Cancel'
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
            toast.success('Group left.');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to leave group.'
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function cancelJoinRequest() {
        if (
            memberStatus !== 'requested' ||
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
            toast.success('Group join request cancelled.');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to cancel group join request.'
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
            toast.success('Group refreshed.');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to refresh group.'
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateGroupRepresentation(enabled) {
        if (!isMember || actionStatusRef.current !== 'idle') {
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
                enabled ? 'Group represented.' : 'Group unrepresented.'
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to update group representation.'
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateGroupMemberProps(params, label) {
        if (!isMember || !currentUserId || actionStatusRef.current !== 'idle') {
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
                    : 'Failed to update group member settings.'
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateGroupBlock(enabled) {
        if (isMember || !currentUserId || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await confirm({
            title: enabled ? 'Block group?' : 'Unblock group?',
            description: group.name || group.id,
            confirmText: enabled ? 'Block' : 'Unblock',
            cancelText: 'Cancel',
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
            toast.success(enabled ? 'Group blocked.' : 'Group unblocked.');
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    'Failed to update group block state.'
                )
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return (
        <GroupDialogTabbedView
            group={group}
            detail={detail}
            bannerUrl={bannerUrl}
            iconUrl={iconUrl}
            actionStatus={actionStatus}
            isMember={isMember}
            isBlocked={isBlocked}
            isRepresenting={isRepresenting}
            isSubscribedToAnnouncements={isSubscribedToAnnouncements}
            ownerDisplayName={ownerDisplayName}
            memberVisibility={memberVisibility}
            memberStatus={memberStatus}
            joinState={joinState}
            canJoin={canJoin}
            activeInstances={activeInstances}
            previousInstances={previousInstances}
            onPreviousInstancesChange={setPreviousInstances}
            onRefresh={() => void refreshGroup()}
            onJoin={() => void joinGroup()}
            onLeave={() => void leaveGroup()}
            onCancelRequest={() => void cancelJoinRequest()}
            onRepresent={(enabled) => void updateGroupRepresentation(enabled)}
            onSubscribe={(enabled) =>
                void updateGroupMemberProps(
                    { isSubscribedToAnnouncements: enabled },
                    enabled
                        ? 'Subscribed to announcements.'
                        : 'Unsubscribed from announcements.'
                )
            }
            onVisibility={(visibility) =>
                void updateGroupMemberProps(
                    { visibility },
                    'Group visibility updated.'
                )
            }
            onBlock={(enabled) => void updateGroupBlock(enabled)}
            onOpenPage={() => openExternalLink(group.url)}
        />
    );
}
