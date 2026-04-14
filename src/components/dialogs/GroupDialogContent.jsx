import { useEffect, useMemo, useRef, useState } from 'react';
import {
    BadgeCheckIcon,
    ExternalLinkIcon,
    GlobeIcon,
    LogInIcon,
    LogOutIcon,
    LoaderCircleIcon,
    RefreshCwIcon,
    ShieldIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { formatDateFilter } from '@/lib/dateTime.js';
import { convertFileUrlToImageUrl, openExternalLink } from '@/lib/entityMedia.js';
import { GroupDialogTabbedView } from './GroupDialogTabbedView.jsx';
import { groupProfileRepository } from '@/repositories/index.js';
import { database } from '@/services/database/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useDialogStore } from '@/state/dialogStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import { Separator } from '@/ui/shadcn/separator.jsx';

function normalizeEntityId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function Section({ label, value, mono = false, children }) {
    return (
        <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {label}
            </div>
            {children ? (
                children
            ) : (
                <div className={mono ? 'break-all font-mono text-sm' : 'text-sm'}>
                    {value || '—'}
                </div>
            )}
        </div>
    );
}

function normalizeLocation(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized && normalized !== 'offline' && normalized !== 'private' ? normalized : '';
}

function userGroupLocation(user) {
    const location = normalizeLocation(user?.location);
    if (location === 'traveling') {
        return normalizeLocation(user?.travelingToLocation);
    }
    return location;
}

function instanceLocation(instance) {
    const directLocation = normalizeLocation(instance?.location || instance?.tag || instance?.$location?.tag);
    if (directLocation) {
        return directLocation;
    }
    const worldId = instance?.worldId || instance?.world?.id || '';
    const instanceId = instance?.instanceId || instance?.id || instance?.name || '';
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

function mergeGroupInstances(baseInstances, { groupId, friendsById, currentUserSnapshot, currentLocation }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const currentLocationKey = normalizeLocation(currentLocation);
    const byLocation = new Map();

    function ensureInstance(location, seed = {}) {
        const normalizedLocation = normalizeLocation(location);
        if (!normalizedLocation) {
            return null;
        }
        const parsed = parseLocation(normalizedLocation);
        const existing = byLocation.get(normalizedLocation);
        if (existing) {
            existing.worldId = seed.worldId || seed.world?.id || parsed.worldId || existing.worldId || '';
            existing.instanceId = seed.instanceId || seed.id || parsed.instanceId || existing.instanceId || '';
            existing.ref = seed.ref || existing.ref || seed;
            return Object.assign(existing, seed, {
                location: normalizedLocation,
                tag: normalizedLocation,
                users: existing.users,
                friendCount: existing.friendCount
            });
        }

        const row = {
            ...seed,
            id: seed.instanceId || seed.id || parsed.instanceId || normalizedLocation,
            location: normalizedLocation,
            tag: normalizedLocation,
            worldId: seed.worldId || seed.world?.id || parsed.worldId || '',
            instanceId: seed.instanceId || seed.id || parsed.instanceId || '',
            users: Array.isArray(seed.users) ? [...seed.users] : [],
            friendCount: Number(seed.friendCount || seed.userCount || 0) || 0,
            ref: seed.ref || seed
        };
        byLocation.set(normalizedLocation, row);
        return row;
    }

    for (const instance of Array.isArray(baseInstances) ? baseInstances : []) {
        ensureInstance(instanceLocation(instance), instance);
    }

    function addUser(user, isFriend = false) {
        const location = userGroupLocation(user);
        if (!location) {
            return;
        }
        const parsed = parseLocation(location);
        if (normalizedGroupId && parsed.groupId !== normalizedGroupId) {
            return;
        }
        const row = ensureInstance(location);
        const userId = normalizeEntityId(user?.id || user?.userId);
        if (!row || !userId || row.users.some((existing) => normalizeEntityId(existing?.id || existing?.userId) === userId)) {
            return;
        }
        row.users.push(user);
        if (isFriend) {
            row.friendCount = Math.max(row.friendCount || 0, row.users.length);
        }
    }

    Object.values(friendsById || {}).forEach((friend) => addUser(friend, true));
    if (currentUserSnapshot) {
        addUser(currentUserSnapshot, false);
    }

    return Array.from(byLocation.values())
        .map((row) => ({
            ...row,
            friendCount: row.friendCount || row.users.length,
            users: [...row.users].sort((left, right) =>
                String(left?.displayName || left?.id || '').localeCompare(String(right?.displayName || right?.id || ''))
            )
        }))
        .sort((left, right) => {
            if (currentLocationKey && left.location === currentLocationKey) {
                return -1;
            }
            if (currentLocationKey && right.location === currentLocationKey) {
                return 1;
            }
            return (right.users.length || right.ref?.userCount || 0) - (left.users.length || left.ref?.userCount || 0);
        });
}

function GroupDialogEmptyState({ title, description, loading = false }) {
    return (
        <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center">
            <div className="max-w-sm space-y-2">
                {loading ? (
                    <div className="flex justify-center">
                        <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
                    </div>
                ) : null}
                <div className="text-sm font-medium">{title}</div>
                <div className="text-sm text-muted-foreground">{description}</div>
            </div>
        </div>
    );
}

export function GroupDialogContent({ groupId, seedData = null }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore((state) => state.auth.currentUserSnapshot);
    const currentLocation = useRuntimeStore((state) => state.gameState.currentLocation);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const confirm = useModalStore((state) => state.confirm);
    const updateEntityDialogMetadata = useDialogStore((state) => state.updateEntityDialogMetadata);
    const [group, setGroup] = useState(() =>
        seedData ? groupProfileRepository.normalize(seedData) : null
    );
    const [loadStatus, setLoadStatus] = useState(normalizedGroupId ? 'running' : 'idle');
    const [actionStatus, setActionStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [previousInstances, setPreviousInstances] = useState([]);
    const [rawActiveInstances, setRawActiveInstances] = useState([]);
    const actionStatusRef = useRef('idle');
    const activeGroupTargetRef = useRef({ groupId: normalizedGroupId, endpoint: currentEndpoint });
    const activeInstances = useMemo(
        () => mergeGroupInstances(rawActiveInstances, {
            groupId: normalizedGroupId,
            friendsById,
            currentUserSnapshot,
            currentLocation
        }),
        [currentLocation, currentUserSnapshot, friendsById, normalizedGroupId, rawActiveInstances]
    );

    useEffect(() => {
        setGroup(seedData ? groupProfileRepository.normalize(seedData) : null);
    }, [seedData]);

    useEffect(() => {
        activeGroupTargetRef.current = { groupId: normalizedGroupId, endpoint: currentEndpoint };
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
                    error instanceof Error ? error.message : 'Failed to load the group profile.'
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

        database.getPreviousInstancesByGroupId(normalizedGroupId)
            .then((rows) => {
                if (!active) {
                    return;
                }
                const values = rows instanceof Map ? Array.from(rows.values()) : [];
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

        groupProfileRepository.getGroupInstances({
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
                description={detail || 'VRCX could not resolve a group snapshot for this dialog.'}
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
    const isSubscribedToAnnouncements = Boolean(group.myMember?.isSubscribedToAnnouncements);
    const memberVisibility = normalizeEntityId(group.myMember?.visibility || 'visible') || 'visible';
    const joinState = normalizeEntityId(group.joinState).toLowerCase();
    const ownerDisplayName =
        normalizeEntityId(group.ownerDisplayName || group.ownerName || group.owner?.displayName) ||
        normalizeEntityId(friendsById[group.ownerId]?.displayName) ||
        normalizeEntityId(group.ownerId);
    const canJoin =
        !isMember &&
        memberStatus !== 'requested' &&
        memberStatus !== 'userblocked' &&
        (joinState === 'open' || joinState === 'request' || memberStatus === 'invited');

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
            const nextStatus = normalizeEntityId(response.json?.membershipStatus).toLowerCase();
            await refreshGroupProfile().catch(() => {
                if (response.json && typeof response.json === 'object') {
                    commitGroupSnapshot(response.json);
                }
            });
            toast.success(nextStatus === 'requested' ? 'Group join request sent.' : 'Group joined.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to join group.');
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
            toast.error(error instanceof Error ? error.message : 'Failed to leave group.');
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function cancelJoinRequest() {
        if (memberStatus !== 'requested' || actionStatusRef.current !== 'idle') {
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
            toast.error(error instanceof Error ? error.message : 'Failed to cancel group join request.');
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
            toast.error(error instanceof Error ? error.message : 'Failed to refresh group.');
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
            toast.success(enabled ? 'Group represented.' : 'Group unrepresented.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update group representation.');
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
            toast.error(error instanceof Error ? error.message : 'Failed to update group member settings.');
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
            toast.error(error instanceof Error ? error.message : 'Failed to update group block state.');
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
            onSubscribe={(enabled) => void updateGroupMemberProps({ isSubscribedToAnnouncements: enabled }, enabled ? 'Subscribed to announcements.' : 'Unsubscribed from announcements.')}
            onVisibility={(visibility) => void updateGroupMemberProps({ visibility }, 'Group visibility updated.')}
            onBlock={(enabled) => void updateGroupBlock(enabled)}
            onOpenPage={() => openExternalLink(group.url)}
        />
    );

}
