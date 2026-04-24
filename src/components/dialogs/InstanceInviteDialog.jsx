import { PlusIcon, UserIcon, UsersIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
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
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

function normalizeId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function onlineFriendIdsFromGroup(userIds, friendsById) {
    return (Array.isArray(userIds) ? userIds : [])
        .map(normalizeId)
        .filter((userId, index, source) => {
            const friend = friendsById[userId];
            return (
                userId &&
                source.indexOf(userId) === index &&
                (friend?.stateBucket === 'online' || friend?.state === 'online')
            );
        });
}

function displayNameForUser(userId, friendsById, currentUser) {
    if (currentUser?.id === userId) {
        return currentUser.displayName || currentUser.username || userId;
    }
    const friend = friendsById[userId];
    const ref =
        friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
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
    const { t } = useTranslation();

    const currentUser = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentLocationPlayerIds = useRuntimeStore(
        (state) => state.gameState.currentLocationPlayerIds
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const onlineIds = useFriendRosterStore((state) => state.onlineIds);
    const activeIds = useFriendRosterStore((state) => state.activeIds);
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore(
        (state) => state.groupedFavoriteFriendIdsByGroupKey
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
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

        worldProfileRepository
            .getWorldProfile({
                worldId: parsedLocation.worldId,
                endpoint
            })
            .then((world) => {
                if (active) {
                    setResolvedWorldName(normalizeId(world?.name));
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
            const displayName = displayNameForUser(
                userId,
                friendsById,
                currentUser
            );
            return (
                userId.toLowerCase().includes(query) ||
                displayName.toLowerCase().includes(query)
            );
        });
    }, [currentUser, friendsById, search, selectableUserIds]);

    const friendsInCurrentInstanceIds = useMemo(() => {
        const ids = new Set(
            (Array.isArray(currentLocationPlayerIds)
                ? currentLocationPlayerIds
                : []
            ).map(normalizeId)
        );
        return [...ids].filter((userId) => userId && friendsById[userId]);
    }, [currentLocationPlayerIds, friendsById]);

    const favoriteGroupItems = useMemo(() => {
        const remote = (
            Array.isArray(favoriteFriendGroups) ? favoriteFriendGroups : []
        )
            .map((group) => {
                const key = normalizeId(group?.key);
                const userIds = onlineFriendIdsFromGroup(
                    groupedFavoriteFriendIdsByGroupKey?.[key],
                    friendsById
                );
                return {
                    key: `remote:${key}`,
                    label: group?.displayName || key,
                    userIds
                };
            })
            .filter((group) => group.key && group.userIds.length);

        const local = (
            Array.isArray(localFriendFavoriteGroups)
                ? localFriendFavoriteGroups
                : []
        )
            .map((groupName) => {
                const key = normalizeId(groupName);
                const userIds = onlineFriendIdsFromGroup(
                    localFriendFavorites?.[key],
                    friendsById
                );
                return {
                    key: `local:${key}`,
                    label: key,
                    userIds
                };
            })
            .filter((group) => group.key && group.userIds.length);

        return { remote, local };
    }, [
        favoriteFriendGroups,
        friendsById,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavoriteGroups,
        localFriendFavorites
    ]);

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
        const normalizedUserIds = selectedUserIds
            .map(normalizeId)
            .filter(Boolean);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(t('dialog.invite.generated.cannot_invite_location_is_not_a_concrete_instance'));
            return;
        }
        if (!normalizedUserIds.length) {
            toast.error(t('dialog.invite.generated.select_at_least_one_user_to_invite'));
            return;
        }

        const result = await confirm({
            title: t('dialog.instance_invite.generated_modal.send_invite'),
            description: t('dialog.instance_invite.generated_dynamic.send_invites_to_value_user_value', { value: normalizedUserIds.length, value2: normalizedUserIds.length === 1 ? '' : 's' }),
            confirmText: t('dialog.instance_invite.generated_modal.invite'),
            cancelText: t('common.actions.cancel')
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
                        await selfInviteToInstance(
                            parsedLocation.tag || location,
                            launchToken || parsedLocation.shortName,
                            endpoint
                        );
                    } else {
                        await notificationRepository.sendInvite({
                            receiverUserId,
                            endpoint,
                            params: {
                                instanceId: parsedLocation.tag || location,
                                worldId: parsedLocation.worldId,
                                worldName:
                                    resolvedWorldName ||
                                    worldName ||
                                    parsedLocation.worldId
                            }
                        });
                    }
                    successCount += 1;
                } catch (error) {
                    failedUserIds.add(receiverUserId);
                    failures.push(
                        error instanceof Error
                            ? error.message
                            : 'Failed to send invite.'
                    );
                }
            }

            if (successCount) {
                toast.success(
                    successCount === 1
                        ? t('dialog.instance_invite.generated_toast.invite_sent')
                        : t('dialog.instance_invite.generated_toast.sent_value_invites', { value: successCount })
                );
            }
            if (failures.length) {
                setSelectedUserIds((current) =>
                    current.filter((userId) => failedUserIds.has(userId))
                );
                toast.error(
                    failures.length === 1
                        ? failures[0]
                        : t('dialog.instance_invite.generated_toast.failed_to_send_value_invites', { value: failures.length })
                );
            } else {
                onOpenChange?.(false);
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.instance_invite.generated_toast.failed_to_send_invite')
            );
        } finally {
            setSending(false);
        }
    }

    return (
        <Dialog open={Boolean(open)} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('dialog.invite.generated.invite')}</DialogTitle>
                    <DialogDescription>
                        {t('dialog.invite.generated.choose_online_friends_to_invite_to_this_instance')}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4 overflow-hidden">
                    <div className="bg-muted/30 rounded-md border p-3 text-sm">
                        <Location
                            location={location}
                            link={false}
                            asButton={false}
                            className="cursor-default"
                        />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!currentUserId || sending}
                            onClick={() => addUserIds([currentUserId])}
                        >
                            <UserIcon data-icon="inline-start" />
                            {t('dialog.invite.add_self')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                                !friendsInCurrentInstanceIds.length || sending
                            }
                            onClick={() =>
                                addUserIds(friendsInCurrentInstanceIds)
                            }
                        >
                            <UsersIcon data-icon="inline-start" />
                            {t('dialog.invite.add_friends_in_instance')}
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                        sending ||
                                        (!favoriteGroupItems.remote.length &&
                                            !favoriteGroupItems.local.length)
                                    }
                                >
                                    <PlusIcon data-icon="inline-start" />
                                    {t('dialog.invite.add_favorite_friends')}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56">
                                <DropdownMenuGroup>
                                    {favoriteGroupItems.remote.map((group) => (
                                        <DropdownMenuItem
                                            key={group.key}
                                            onSelect={() =>
                                                addUserIds(group.userIds)
                                            }
                                        >
                                            {group.label}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuGroup>
                                {favoriteGroupItems.remote.length &&
                                favoriteGroupItems.local.length ? (
                                    <DropdownMenuSeparator />
                                ) : null}
                                <DropdownMenuGroup>
                                    {favoriteGroupItems.local.map((group) => (
                                        <DropdownMenuItem
                                            key={group.key}
                                            onSelect={() =>
                                                addUserIds(group.userIds)
                                            }
                                        >
                                            {group.label}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <Input
                        value={search}
                        disabled={sending}
                        placeholder={t('dialog.invite.generated.search_online_friends')}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                    <div className="max-h-72 overflow-auto rounded-md border">
                        {filteredUserIds.length ? (
                            filteredUserIds.map((userId) => {
                                const friend = friendsById[userId];
                                const displayName = displayNameForUser(
                                    userId,
                                    friendsById,
                                    currentUser
                                );
                                const checked =
                                    selectedUserIds.includes(userId);
                                const imageUrl = friend
                                    ? userImage(friend, true)
                                    : userImage(currentUser, true);
                                return (
                                    <Field
                                        key={userId}
                                        orientation="horizontal"
                                        data-disabled={sending}
                                        className="cursor-pointer gap-3 border-b px-3 py-2 last:border-b-0"
                                    >
                                        <Checkbox
                                            id={`invite-user-${userId}`}
                                            checked={checked}
                                            disabled={sending}
                                            onCheckedChange={() =>
                                                toggleUserId(userId)
                                            }
                                        />
                                        <FieldLabel
                                            htmlFor={`invite-user-${userId}`}
                                            className="min-w-0 flex-1 cursor-pointer items-center gap-3 font-normal"
                                        >
                                            {imageUrl ? (
                                                <img
                                                    src={imageUrl}
                                                    alt=""
                                                    loading="lazy"
                                                    className="size-8 rounded-full object-cover"
                                                />
                                            ) : (
                                                <span className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full">
                                                    <UserIcon className="size-4" />
                                                </span>
                                            )}
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-medium">
                                                    {displayName}
                                                </span>
                                            </span>
                                        </FieldLabel>
                                    </Field>
                                );
                            })
                        ) : (
                            <Empty className="min-h-32 border-0">
                                <EmptyHeader>
                                    <EmptyTitle>{t('dialog.invite.generated.no_online_friends')}</EmptyTitle>
                                    <EmptyDescription>
                                        {t('dialog.invite.generated.no_selectable_online_friends_match_the_current_search')}
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={sending}
                        onClick={() => onOpenChange?.(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={sending || !selectedUserIds.length}
                        onClick={() => void sendInvites()}
                    >
                        {sending ? <Spinner data-icon="inline-start" /> : null}
                        {t('dialog.invite.generated.invite')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
