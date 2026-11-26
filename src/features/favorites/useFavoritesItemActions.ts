import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import type { FavoriteKind } from '@/domain/favorites/types';
import { resolveFriendPresenceLocation } from '@/domain/friends/presence';
import type { FriendRecord, FriendRosterById } from '@/domain/friends/types';
import type { AvatarCacheOutput } from '@/platform/tauri/bindings';
import avatarLocalRepository from '@/repositories/avatarLocalRepository';
import favoritePersistenceRepository from '@/repositories/favoritePersistenceRepository';
import { selectAvatar as selectCurrentAvatar } from '@/services/avatarSelectionService';
import { copyTextToClipboard } from '@/services/clipboardService';
import { openWorldDialog } from '@/services/dialogService';
import { tryOpenLaunchLocation } from '@/services/directAccessService';
import {
    boopFriend,
    requestInviteFromFriend
} from '@/services/friendActionService';
import { sendInviteToLocation } from '@/services/inviteDeliveryService';
import { selfInviteToInstance } from '@/services/launchService';
import { toast } from '@/services/toastService';
import { checkCanInviteSelf } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';
import { useModalStore } from '@/state/modalStore';

import { normalizeFavoriteEntityId as normalizeEntityId } from './favoritesItems';
import type {
    FavoriteGroupView,
    FavoriteItem,
    FavoriteSeedData,
    FavoriteSource
} from './favoritesTypes';

type FavoriteFriendRecord = FavoriteSeedData | FriendRecord;

export function useFavoritesItemActions({
    avatarHistoryLoading,
    canInviteFromCurrentLocation,
    currentInviteLocation,
    currentUserId,
    friendsById,
    friendsMap,
    kind,
    localGroups,
    newLocalGroupName,
    refreshing,
    selectedContentItems,
    selectedSource,
    setAvatarHistory,
    setAvatarHistoryLoading,
    setCreatingLocalGroup,
    setNewLocalGroupName,
    setSelectedGroupKey,
    setSelectedSource
}: {
    avatarHistoryLoading: boolean;
    canInviteFromCurrentLocation: boolean;
    currentInviteLocation: string;
    currentUserId: string;
    friendsById: FriendRosterById;
    friendsMap: Map<string, FriendRecord>;
    kind: FavoriteKind;
    localGroups: FavoriteGroupView[];
    newLocalGroupName: string;
    refreshing: boolean;
    selectedContentItems: FavoriteItem[];
    selectedSource: FavoriteSource;
    setAvatarHistory: Dispatch<SetStateAction<AvatarCacheOutput[]>>;
    setAvatarHistoryLoading(value: boolean): void;
    setCreatingLocalGroup(value: boolean): void;
    setNewLocalGroupName(value: string): void;
    setSelectedGroupKey(value: string): void;
    setSelectedSource(value: FavoriteSource): void;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    function friendText(value: unknown): string {
        return typeof value === 'string' ? value : String(value ?? '');
    }

    async function refreshAvatarHistory() {
        if (kind !== 'avatar' || !currentUserId || avatarHistoryLoading) {
            return;
        }
        setAvatarHistoryLoading(true);
        try {
            const rows = await avatarLocalRepository.getAvatarHistory(
                currentUserId,
                100
            );
            setAvatarHistory(rows);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.favorites.toast.failed_to_refresh_avatar_history'
                          )
            });
        } finally {
            setAvatarHistoryLoading(false);
        }
    }

    async function handleAvatarHistoryClear() {
        const result = await confirm({
            title: t('view.favorites.modal.clear_avatar_history'),
            description: t('view.favorites.modal.clear_local_avatar_history'),
            destructive: true,
            confirmText: t('common.actions.clear'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            await avatarLocalRepository.clearAvatarHistory(currentUserId);
            setAvatarHistory([]);
            if (selectedSource === 'history') {
                setSelectedGroupKey('');
            }
            toast.add({
                type: 'success',
                title: t('view.favorite.success.avatar_history_cleared')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.favorites.toast.failed_to_clear_avatar_history'
                          )
            });
        }
    }

    function getFavoriteFriend(item: FavoriteItem): FavoriteFriendRecord {
        const userId = normalizeEntityId(item.id);
        const seedData = item.seedData;
        if (seedData) {
            return seedData;
        }
        const knownFriend = friendsById[userId];
        if (knownFriend) {
            return knownFriend;
        }
        return {
            id: userId,
            displayName: item.title || userId,
            username: '',
            location: ''
        };
    }

    async function launchFavoriteFriendLocation(item: FavoriteItem) {
        const friend = getFavoriteFriend(item);
        const location = resolveFriendPresenceLocation(friend, {
            preferTraveling: false
        });
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return;
        }
        try {
            const opened = await tryOpenLaunchLocation(
                location,
                parsedLocation.shortName || ''
            );
            if (opened) {
                toast.add({
                    type: 'success',
                    title: t('view.favorite.success.vrchat_launch_request_sent')
                });
                return;
            }
            toast.add({
                type: 'error',
                title: t(
                    'view.favorite.error.unable_to_open_this_instance_in_vrchat'
                )
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.favorites.toast.failed_to_launch_instance')
            });
        }
    }

    async function selfInviteFavoriteFriendLocation(item: FavoriteItem) {
        const friend = getFavoriteFriend(item);
        const location = resolveFriendPresenceLocation(friend, {
            preferTraveling: false
        });
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return;
        }
        if (
            !checkCanInviteSelf(location, {
                currentUserId,
                cachedInstances: new Map(),
                friends: friendsMap
            })
        ) {
            toast.add({
                type: 'error',
                title: t(
                    'view.favorite.error.cannot_self_invite_to_this_instance'
                )
            });
            return;
        }
        try {
            await selfInviteToInstance(
                location,
                parsedLocation.shortName || ''
            );
            toast.add({
                type: 'success',
                title: t('message.invite.self_sent')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.favorites.toast.failed_to_send_self_invite')
            });
        }
    }

    async function sendFavoriteFriendInvite(item: FavoriteItem) {
        const friend = getFavoriteFriend(item);
        const friendId = normalizeEntityId(friend.id || item.id);
        if (!friendId || friendId === normalizeEntityId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.add({
                type: 'error',
                title: t(
                    'view.favorite.error.cannot_invite_no_current_vrchat_location_is_available'
                )
            });
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.add({
                type: 'error',
                title: t(
                    'view.favorite.error.cannot_invite_from_the_current_instance_type'
                )
            });
            return;
        }
        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.add({
                type: 'error',
                title: t(
                    'view.favorite.error.cannot_invite_current_location_is_not_a_concrete_instance'
                )
            });
            return;
        }
        const result = await confirm({
            title: t('view.favorites.modal.send_invite'),
            description:
                friend.displayName || t('view.favorites.description.this_user'),
            confirmText: t('view.favorites.modal.invite'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            const inviteLocation = parsedLocation.tag || currentInviteLocation;
            await sendInviteToLocation({
                receiverUserId: friendId,
                instanceId: inviteLocation,
                worldId: parsedLocation.worldId,
                rsvp: true
            });
            toast.add({ type: 'success', title: t('message.invite.sent') });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.favorites.toast.failed_to_send_invite')
            });
        }
    }

    function requestFavoriteFriendInvite(item: FavoriteItem) {
        const friend = getFavoriteFriend(item);
        return requestInviteFromFriend({
            id: friend.id || item.id,
            label:
                normalizeEntityId(friend.displayName) ||
                t('view.favorites.description.this_user')
        });
    }

    function sendFavoriteFriendBoop(item: FavoriteItem) {
        const friend = getFavoriteFriend(item);
        return boopFriend({
            id: friend.id || item.id,
            label: friendText(friend.displayName) || friendText(friend.username)
        });
    }

    function openWorldNewInstance(
        item: FavoriteItem,
        selfInvite = false
    ): void {
        if (!item.id) {
            return;
        }
        openWorldDialog({
            worldId: item.id,
            title: item.title || undefined,
            seedData: item.seedData ?? null,
            initialAction: selfInvite ? 'newInstanceSelfInvite' : 'newInstance'
        });
    }

    async function selectFavoriteAvatar(item: FavoriteItem) {
        if (!item.id) {
            return;
        }
        try {
            const result = await selectCurrentAvatar(item.id);
            if (!result.applied) {
                return;
            }
            toast.add({
                type: 'success',
                title: t('view.favorite.success.avatar_selected')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.favorites.toast.failed_to_select_avatar')
            });
        }
    }

    async function confirmCreateLocalGroup() {
        if (refreshing) {
            return;
        }
        const nextName = newLocalGroupName.trim();
        if (!nextName) {
            setCreatingLocalGroup(false);
            setNewLocalGroupName('');
            return;
        }
        if (localGroups.some((group) => group.label === nextName)) {
            toast.add({
                type: 'error',
                title: t(
                    'view.favorites.dynamic.local_group_value_already_exists',
                    {
                        value: nextName
                    }
                )
            });
            return;
        }
        try {
            const group =
                await favoritePersistenceRepository.createLocalFavoriteGroup({
                    kind,
                    name: nextName
                });
            setSelectedSource('local');
            setSelectedGroupKey(String(group.id));
            setCreatingLocalGroup(false);
            setNewLocalGroupName('');
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.favorites.toast.failed_to_create_local_favorite_group'
                          )
            });
        }
    }

    async function copySelection() {
        if (!selectedContentItems.length) {
            return;
        }
        await copyTextToClipboard(
            selectedContentItems.map((item) => `${item.id}\n`).join(''),
            {
                successMessage: t(
                    'view.favorite.success.copied_selected_favorite_ids'
                ),
                errorMessage: (error) =>
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.favorites.toast.failed_to_copy_selected_favorites'
                          )
            }
        );
    }

    return {
        confirmCreateLocalGroup,
        copySelection,
        handleAvatarHistoryClear,
        launchFavoriteFriendLocation,
        openWorldNewInstance,
        refreshAvatarHistory,
        requestFavoriteFriendInvite,
        selectFavoriteAvatar,
        selfInviteFavoriteFriendLocation,
        sendFavoriteFriendBoop,
        sendFavoriteFriendInvite
    };
}
