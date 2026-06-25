import { PlusIcon, UserIcon, UsersIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Location } from '@/components/Location';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { userImage } from '@/services/entityMediaService';
import { sendInviteToLocation } from '@/services/inviteDeliveryService';
import { selfInviteToInstance } from '@/services/launchService';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Badge } from '@/ui/shadcn/badge';
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

import {
    buildFavoriteGroupItems,
    buildFavoriteGroupLabelsByUserId,
    buildFriendsInCurrentInstanceIds,
    displayNameForUser,
    filterInviteUserIds,
    sortInviteUserIdsWithSelectedFirst
} from './inviteDialogModel';

export function InstanceInviteDialog({
    open,
    location = '',
    launchToken = '',
    worldName = '',
    endpoint = '',
    onOpenChange
}: any) {
    const { t } = useTranslation();

    const currentUser = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentLocationPlayerIds = useRuntimeStore(
        (state: any) => state.gameState.currentLocationPlayerIds
    );
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const onlineIds = useFriendRosterStore((state: any) => state.onlineIds);
    const activeIds = useFriendRosterStore((state: any) => state.activeIds);
    const favoriteFriendGroups = useFavoriteStore(
        (state: any) => state.favoriteFriendGroups
    );
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore(
        (state: any) => state.groupedFavoriteFriendIdsByGroupKey
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state: any) => state.localFriendFavoriteGroups
    );
    const localFriendFavorites = useFavoriteStore(
        (state: any) => state.localFriendFavorites
    );
    const confirm = useModalStore((state: any) => state.confirm);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
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
            .then((world: any) => {
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

    const filteredUserIds = useMemo(
        () =>
            filterInviteUserIds({
                selectableUserIds,
                search,
                friendsById,
                currentUser
            }),
        [currentUser, friendsById, search, selectableUserIds]
    );

    const selectedUserIdSet = useMemo(
        () => new Set(selectedUserIds.map(normalizeId).filter(Boolean)),
        [selectedUserIds]
    );

    const sortedFilteredUserIds = useMemo(
        () =>
            sortInviteUserIdsWithSelectedFirst(
                filteredUserIds,
                selectedUserIdSet
            ),
        [filteredUserIds, selectedUserIdSet]
    );

    const favoriteGroupLabelsByUserId = useMemo(
        () =>
            buildFavoriteGroupLabelsByUserId({
                favoriteFriendGroups,
                groupedFavoriteFriendIdsByGroupKey,
                localFriendFavoriteGroups,
                localFriendFavorites
            }),
        [
            favoriteFriendGroups,
            groupedFavoriteFriendIdsByGroupKey,
            localFriendFavoriteGroups,
            localFriendFavorites
        ]
    );

    const friendsInCurrentInstanceIds = useMemo(
        () =>
            buildFriendsInCurrentInstanceIds({
                currentLocationPlayerIds,
                friendsById
            }),
        [currentLocationPlayerIds, friendsById]
    );

    const favoriteGroupItems = useMemo(
        () =>
            buildFavoriteGroupItems({
                favoriteFriendGroups,
                groupedFavoriteFriendIdsByGroupKey,
                localFriendFavoriteGroups,
                localFriendFavorites,
                friendsById
            }),
        [
            favoriteFriendGroups,
            friendsById,
            groupedFavoriteFriendIdsByGroupKey,
            localFriendFavoriteGroups,
            localFriendFavorites
        ]
    );

    function addUserIds(userIds: unknown) {
        const ids = (Array.isArray(userIds) ? userIds : [])
            .map(normalizeId)
            .filter(Boolean);
        if (!ids.length) {
            return;
        }
        setSelectedUserIds((current) => [...new Set([...current, ...ids])]);
    }

    function toggleUserId(userId: unknown) {
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
            toast.error(
                t(
                    'dialog.invite.error.cannot_invite_location_is_not_a_concrete_instance'
                )
            );
            return;
        }
        if (!normalizedUserIds.length) {
            toast.error(
                t('dialog.invite.action.select_at_least_one_user_to_invite')
            );
            return;
        }

        const result = await confirm({
            title: t('dialog.instance_invite.modal.send_invite'),
            description: t(
                normalizedUserIds.length === 1
                    ? 'dialog.instance_invite.dynamic.send_invite_to_value_user'
                    : 'dialog.instance_invite.dynamic.send_invites_to_value_users',
                {
                    value: normalizedUserIds.length
                }
            ),
            confirmText: t('dialog.instance_invite.modal.invite'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        setSending(true);
        try {
            const failedUserIds = new Set<string>();
            const failures: string[] = [];
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
                        await sendInviteToLocation({
                            receiverUserId,
                            endpoint,
                            instanceId: parsedLocation.tag || location,
                            worldId: parsedLocation.worldId,
                            worldName:
                                resolvedWorldName ||
                                worldName ||
                                parsedLocation.worldId
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
                        ? t('message.invite.sent')
                        : t('dialog.instance_invite.toast.sent_value_invites', {
                              value: successCount
                          })
                );
            }
            if (failures.length) {
                setSelectedUserIds((current) =>
                    current.filter((userId) => failedUserIds.has(userId))
                );
                toast.error(
                    failures.length === 1
                        ? failures[0]
                        : t(
                              'dialog.instance_invite.toast.failed_to_send_value_invites',
                              { value: failures.length }
                          )
                );
            } else {
                onOpenChange?.(false);
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.instance_invite.toast.failed_to_send_invite')
            );
        } finally {
            setSending(false);
        }
    }

    return (
        <Dialog open={Boolean(open)} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('dialog.invite.invite')}</DialogTitle>
                    <DialogDescription>
                        {t(
                            'dialog.invite.description.choose_online_friends_to_invite_to_this_instance'
                        )}
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
                                    {favoriteGroupItems.remote.map(
                                        (group: any) => (
                                            <DropdownMenuItem
                                                key={group.key}
                                                onSelect={() =>
                                                    addUserIds(group.userIds)
                                                }
                                            >
                                                {group.label}
                                            </DropdownMenuItem>
                                        )
                                    )}
                                </DropdownMenuGroup>
                                {favoriteGroupItems.remote.length &&
                                favoriteGroupItems.local.length ? (
                                    <DropdownMenuSeparator />
                                ) : null}
                                <DropdownMenuGroup>
                                    {favoriteGroupItems.local.map(
                                        (group: any) => (
                                            <DropdownMenuItem
                                                key={group.key}
                                                onSelect={() =>
                                                    addUserIds(group.userIds)
                                                }
                                            >
                                                {group.label}
                                            </DropdownMenuItem>
                                        )
                                    )}
                                </DropdownMenuGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <Input
                        value={search}
                        disabled={sending}
                        placeholder={t(
                            'dialog.invite.action.search_online_friends'
                        )}
                        onChange={(event: any) => setSearch(event.target.value)}
                    />
                    <div className="max-h-72 overflow-auto rounded-md border">
                        {sortedFilteredUserIds.length ? (
                            sortedFilteredUserIds.map((userId: any) => {
                                const friend = friendsById[userId];
                                const displayName = displayNameForUser(
                                    userId,
                                    friendsById,
                                    currentUser
                                );
                                const checked = selectedUserIdSet.has(
                                    normalizeId(userId)
                                );
                                const imageUrl = friend
                                    ? userImage(friend, true)
                                    : userImage(currentUser, true);
                                const favoriteGroupLabels =
                                    favoriteGroupLabelsByUserId[
                                        normalizeId(userId)
                                    ] || [];
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
                                            {favoriteGroupLabels.length ? (
                                                <span className="ml-auto flex max-w-[45%] shrink-0 flex-wrap justify-end gap-1">
                                                    {favoriteGroupLabels.map(
                                                        (label: any) => (
                                                            <Badge
                                                                key={label}
                                                                variant="outline"
                                                                className="max-w-full truncate"
                                                            >
                                                                {label}
                                                            </Badge>
                                                        )
                                                    )}
                                                </span>
                                            ) : null}
                                        </FieldLabel>
                                    </Field>
                                );
                            })
                        ) : (
                            <Empty className="min-h-32 border-0">
                                <EmptyHeader>
                                    <EmptyTitle>
                                        {t(
                                            'dialog.invite.empty.no_online_friends'
                                        )}
                                    </EmptyTitle>
                                    <EmptyDescription>
                                        {t(
                                            'dialog.invite.empty.no_selectable_online_friends_match_the_current_search'
                                        )}
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
                        onClick={() => {
                            sendInvites();
                        }}
                    >
                        {sending ? <Spinner data-icon="inline-start" /> : null}
                        {t('dialog.invite.invite')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
