import { useEffect, useMemo, useState } from 'react';
import { LoaderCircleIcon, PlusIcon, UserIcon, UsersIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Location } from '@/components/Location.jsx';
import { userImage } from '@/lib/entityMedia.js';
import {
    notificationRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Button } from '@/ui/shadcn/button.jsx';
import { Checkbox } from '@/ui/shadcn/checkbox.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu.jsx';
import { Input } from '@/ui/shadcn/input.jsx';

function normalizeId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function onlineFriendIdsFromGroup(userIds, friendsById) {
    return (Array.isArray(userIds) ? userIds : [])
        .map(normalizeId)
        .filter((userId, index, source) => {
            const friend = friendsById[userId];
            return userId &&
                source.indexOf(userId) === index &&
                (friend?.stateBucket === 'online' || friend?.state === 'online');
        });
}

function displayNameForUser(userId, friendsById, currentUser) {
    if (currentUser?.id === userId) {
        return currentUser.displayName || currentUser.username || userId;
    }
    const friend = friendsById[userId];
    const ref = friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
    return ref?.displayName || ref?.username || friend?.name || userId;
}

export function InstanceInviteDialog({
    open,
    location = '',
    launchToken = '',
    worldName = '',
    endpoint = '',
    onOpenChange
}) {
    const currentUser = useRuntimeStore((state) => state.auth.currentUserSnapshot);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentLocationPlayerIds = useRuntimeStore((state) => state.gameState.currentLocationPlayerIds);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const onlineIds = useFriendRosterStore((state) => state.onlineIds);
    const activeIds = useFriendRosterStore((state) => state.activeIds);
    const favoriteFriendGroups = useFavoriteStore((state) => state.favoriteFriendGroups);
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore((state) => state.groupedFavoriteFriendIdsByGroupKey);
    const localFriendFavoriteGroups = useFavoriteStore((state) => state.localFriendFavoriteGroups);
    const localFriendFavorites = useFavoriteStore((state) => state.localFriendFavorites);
    const confirm = useModalStore((state) => state.confirm);
    const [selectedUserIds, setSelectedUserIds] = useState([]);
    const [search, setSearch] = useState('');
    const [sending, setSending] = useState(false);
    const [resolvedWorldName, setResolvedWorldName] = useState('');

    useEffect(() => {
        if (open) {
            setSelectedUserIds([]);
            setSearch('');
            setSending(false);
        }
    }, [open, location]);

    useEffect(() => {
        let active = true;
        const nextWorldName = normalizeId(worldName);
        setResolvedWorldName(nextWorldName);
        if (!open || nextWorldName) {
            return () => {
                active = false;
            };
        }

        const parsedLocation = parseLocation(location);
        if (!parsedLocation.worldId) {
            return () => {
                active = false;
            };
        }

        worldProfileRepository.getWorldProfile({
            worldId: parsedLocation.worldId,
            endpoint
        })
            .then((response) => {
                if (active) {
                    setResolvedWorldName(normalizeId(response.json?.name));
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [endpoint, location, open, worldName]);

    const selectableUserIds = useMemo(() => {
        const ids = [];
        if (currentUserId) {
            ids.push(currentUserId);
        }
        for (const userId of [...onlineIds, ...activeIds]) {
            const normalizedUserId = normalizeId(userId);
            if (normalizedUserId && !ids.includes(normalizedUserId)) {
                ids.push(normalizedUserId);
            }
        }
        return ids;
    }, [activeIds, currentUserId, onlineIds]);

    const filteredUserIds = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) {
            return selectableUserIds;
        }
        return selectableUserIds.filter((userId) => {
            const displayName = displayNameForUser(userId, friendsById, currentUser);
            return userId.toLowerCase().includes(query) || displayName.toLowerCase().includes(query);
        });
    }, [currentUser, friendsById, search, selectableUserIds]);

    const friendsInCurrentInstanceIds = useMemo(() => {
        const ids = new Set((Array.isArray(currentLocationPlayerIds) ? currentLocationPlayerIds : []).map(normalizeId));
        return [...ids].filter((userId) => userId && friendsById[userId]);
    }, [currentLocationPlayerIds, friendsById]);

    const favoriteGroupItems = useMemo(() => {
        const remote = (Array.isArray(favoriteFriendGroups) ? favoriteFriendGroups : [])
            .map((group) => {
                const key = normalizeId(group?.key);
                const userIds = onlineFriendIdsFromGroup(groupedFavoriteFriendIdsByGroupKey?.[key], friendsById);
                return {
                    key: `remote:${key}`,
                    label: group?.displayName || key,
                    userIds
                };
            })
            .filter((group) => group.key && group.userIds.length);

        const local = (Array.isArray(localFriendFavoriteGroups) ? localFriendFavoriteGroups : [])
            .map((groupName) => {
                const key = normalizeId(groupName);
                const userIds = onlineFriendIdsFromGroup(localFriendFavorites?.[key], friendsById);
                return {
                    key: `local:${key}`,
                    label: key,
                    userIds
                };
            })
            .filter((group) => group.key && group.userIds.length);

        return { remote, local };
    }, [favoriteFriendGroups, friendsById, groupedFavoriteFriendIdsByGroupKey, localFriendFavoriteGroups, localFriendFavorites]);

    function addUserIds(userIds) {
        const ids = (Array.isArray(userIds) ? userIds : [])
            .map(normalizeId)
            .filter(Boolean);
        if (!ids.length) {
            return;
        }
        setSelectedUserIds((current) => [...new Set([...current, ...ids])]);
    }

    function toggleUserId(userId) {
        const normalizedUserId = normalizeId(userId);
        if (!normalizedUserId) {
            return;
        }
        setSelectedUserIds((current) =>
            current.includes(normalizedUserId)
                ? current.filter((entry) => entry !== normalizedUserId)
                : [...current, normalizedUserId]
        );
    }

    async function sendInvites() {
        const parsedLocation = parseLocation(location);
        const normalizedUserIds = selectedUserIds.map(normalizeId).filter(Boolean);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error('Cannot invite: location is not a concrete instance.');
            return;
        }
        if (!normalizedUserIds.length) {
            toast.error('Select at least one user to invite.');
            return;
        }

        const result = await confirm({
            title: 'Send invite?',
            description: `Send invites to ${normalizedUserIds.length} user${normalizedUserIds.length === 1 ? '' : 's'}?`,
            confirmText: 'Invite',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        setSending(true);
        try {
            const failedUserIds = new Set();
            const failures = [];
            let successCount = 0;
            for (const receiverUserId of normalizedUserIds) {
                try {
                    if (receiverUserId === currentUserId) {
                        await selfInviteToInstance(parsedLocation.tag || location, launchToken || parsedLocation.shortName, endpoint);
                    } else {
                        await notificationRepository.sendInvite({
                            receiverUserId,
                            endpoint,
                            params: {
                                instanceId: parsedLocation.tag || location,
                                worldId: parsedLocation.worldId,
                                worldName: resolvedWorldName || worldName || parsedLocation.worldId
                            }
                        });
                    }
                    successCount += 1;
                } catch (error) {
                    failedUserIds.add(receiverUserId);
                    failures.push(error instanceof Error ? error.message : 'Failed to send invite.');
                }
            }

            if (successCount) {
                toast.success(successCount === 1 ? 'Invite sent.' : `Sent ${successCount} invites.`);
            }
            if (failures.length) {
                setSelectedUserIds((current) => current.filter((userId) => failedUserIds.has(userId)));
                toast.error(failures.length === 1 ? failures[0] : `Failed to send ${failures.length} invites.`);
            } else {
                onOpenChange?.(false);
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send invite.');
        } finally {
            setSending(false);
        }
    }

    return (
        <Dialog open={Boolean(open)} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Invite</DialogTitle>
                    <DialogDescription>Choose online friends to invite to this instance.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 overflow-hidden">
                    <div className="rounded-md border bg-muted/30 p-3 text-sm">
                        <Location location={location} link={false} asButton={false} className="cursor-default" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" disabled={!currentUserId || sending} onClick={() => addUserIds([currentUserId])}>
                            <UserIcon className="size-4" />
                            Add Self
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={!friendsInCurrentInstanceIds.length || sending} onClick={() => addUserIds(friendsInCurrentInstanceIds)}>
                            <UsersIcon className="size-4" />
                            Add Friends In Instance
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button type="button" size="sm" variant="outline" disabled={sending || (!favoriteGroupItems.remote.length && !favoriteGroupItems.local.length)}>
                                    <PlusIcon className="size-4" />
                                    Add Favorite Friends
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56">
                                {favoriteGroupItems.remote.map((group) => (
                                    <DropdownMenuItem key={group.key} onSelect={() => addUserIds(group.userIds)}>
                                        {group.label}
                                    </DropdownMenuItem>
                                ))}
                                {favoriteGroupItems.remote.length && favoriteGroupItems.local.length ? <DropdownMenuSeparator /> : null}
                                {favoriteGroupItems.local.map((group) => (
                                    <DropdownMenuItem key={group.key} onSelect={() => addUserIds(group.userIds)}>
                                        {group.label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <Input
                        value={search}
                        disabled={sending}
                        placeholder="Search online friends"
                        onChange={(event) => setSearch(event.target.value)}
                    />
                    <div className="max-h-72 overflow-auto rounded-md border">
                        {filteredUserIds.length ? (
                            filteredUserIds.map((userId) => {
                                const friend = friendsById[userId];
                                const displayName = displayNameForUser(userId, friendsById, currentUser);
                                const checked = selectedUserIds.includes(userId);
                                const imageUrl = friend ? userImage(friend, true) : userImage(currentUser, true);
                                return (
                                    <label key={userId} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0">
                                        <Checkbox checked={checked} disabled={sending} onCheckedChange={() => toggleUserId(userId)} />
                                        {imageUrl ? (
                                            <img src={imageUrl} alt="" loading="lazy" className="size-8 rounded-full object-cover" />
                                        ) : (
                                            <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                                <UserIcon className="size-4" />
                                            </span>
                                        )}
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">{displayName}</span>
                                        </span>
                                    </label>
                                );
                            })
                        ) : (
                            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                                No online friends.
                            </div>
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" disabled={sending} onClick={() => onOpenChange?.(false)}>
                        Cancel
                    </Button>
                    <Button type="button" disabled={sending || !selectedUserIds.length} onClick={() => void sendInvites()}>
                        {sending ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
                        Invite
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
