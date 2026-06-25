import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import avatarCacheRepository from '@/repositories/avatarCacheRepository';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import configRepository from '@/repositories/configRepository';
import favoritePersistenceRepository from '@/repositories/favoritePersistenceRepository';
import { openWorldDialog } from '@/services/dialogService';
import { tryOpenLaunchLocation } from '@/services/directAccessService';
import {
    sendBoopToUser,
    sendInviteToLocation,
    sendRequestInviteToUser
} from '@/services/inviteDeliveryService';
import { selfInviteToInstance } from '@/services/launchService';
import { checkCanInviteSelf } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useModalStore } from '@/state/modalStore';

import { normalizeFavoriteEntityId as normalizeEntityId } from './favoritesItems';
import { resolveFavoritePresenceLocation } from './favoritesPageData';
import type {
    FavoriteGroup,
    FavoriteItem,
    FavoriteKind,
    FavoriteSource
} from './favoritesTypes';

type FavoriteFriendRecord = Record<string, unknown> & {
    displayName?: unknown;
    id?: unknown;
    location?: unknown;
    username?: unknown;
};

export function useFavoritesItemActions({
    avatarHistoryLoading,
    canInviteFromCurrentLocation,
    currentEndpoint,
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
    currentEndpoint: string;
    currentInviteLocation: string;
    currentUserId: string;
    friendsById: Record<string, unknown>;
    friendsMap: Map<string, unknown>;
    kind: FavoriteKind;
    localGroups: FavoriteGroup[];
    newLocalGroupName: string;
    refreshing: boolean;
    selectedContentItems: FavoriteItem[];
    selectedSource: FavoriteSource;
    setAvatarHistory(
        value: unknown[] | ((current: unknown[]) => unknown[])
    ): void;
    setAvatarHistoryLoading(value: boolean): void;
    setCreatingLocalGroup(value: boolean): void;
    setNewLocalGroupName(value: string): void;
    setSelectedGroupKey(value: string): void;
    setSelectedSource(value: FavoriteSource): void;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state: any) => state.confirm);
    const boopPrompt = useModalStore((state: any) => state.boopPrompt);
    const createLocalFavoriteGroup = useFavoriteStore(
        (state: any) => state.createLocalFavoriteGroup
    );

    function isFavoriteFriendRecord(
        value: unknown
    ): value is FavoriteFriendRecord {
        return Boolean(value && typeof value === 'object');
    }

    function friendText(value: unknown): string {
        return typeof value === 'string' ? value : String(value ?? '');
    }

    async function refreshAvatarHistory() {
        if (kind !== 'avatar' || !currentUserId || avatarHistoryLoading) {
            return;
        }
        setAvatarHistoryLoading(true);
        try {
            const rows = await avatarCacheRepository.getAvatarHistory(
                currentUserId,
                100
            );
            setAvatarHistory(Array.isArray(rows) ? rows : []);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.toast.failed_to_refresh_avatar_history')
            );
        } finally {
            setAvatarHistoryLoading(false);
        }
    }

    async function handleAvatarHistoryClear() {
        const result = await confirm({
            title: t('view.favorites.modal.clear_avatar_history'),
            description: t(
                'view.favorites.modal.clear_local_avatar_history_and_cached_avatar_metadata'
            ),
            destructive: true,
            confirmText: t('common.actions.clear'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            await avatarCacheRepository.clearAvatarHistory(currentUserId);
            setAvatarHistory([]);
            if (selectedSource === 'history') {
                setSelectedGroupKey('');
            }
            toast.success(t('view.favorite.success.avatar_history_cleared'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.toast.failed_to_clear_avatar_history')
            );
        }
    }

    function getFavoriteFriend(item: any) {
        const userId = normalizeEntityId(item?.id);
        const seedData = item?.seedData;
        if (isFavoriteFriendRecord(seedData)) {
            return seedData;
        }
        const knownFriend = friendsById[userId];
        if (isFavoriteFriendRecord(knownFriend)) {
            return knownFriend;
        }
        return {
            id: userId,
            displayName: item?.title || userId,
            username: '',
            location: ''
        };
    }

    async function launchFavoriteFriendLocation(item: any) {
        const friend = getFavoriteFriend(item);
        const location = resolveFavoritePresenceLocation(friend);
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
                parsedLocation.shortName || '',
                currentEndpoint
            );
            if (opened) {
                toast.success(
                    t('view.favorite.success.vrchat_launch_request_sent')
                );
                return;
            }
            toast.error(
                t('view.favorite.error.unable_to_open_this_instance_in_vrchat')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.toast.failed_to_launch_instance')
            );
        }
    }

    async function selfInviteFavoriteFriendLocation(item: any) {
        const friend = getFavoriteFriend(item);
        const location = resolveFavoritePresenceLocation(friend);
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
            toast.error(
                t('view.favorite.error.cannot_self_invite_to_this_instance')
            );
            return;
        }
        try {
            await selfInviteToInstance(
                location,
                parsedLocation.shortName || '',
                currentEndpoint
            );
            toast.success(t('message.invite.self_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.toast.failed_to_send_self_invite')
            );
        }
    }

    async function sendFavoriteFriendInvite(item: any) {
        const friend = getFavoriteFriend(item);
        const friendId = normalizeEntityId(friend?.id || item?.id);
        if (!friendId || friendId === normalizeEntityId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error(
                t(
                    'view.favorite.error.cannot_invite_no_current_vrchat_location_is_available'
                )
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(
                t(
                    'view.favorite.error.cannot_invite_from_the_current_instance_type'
                )
            );
            return;
        }
        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t(
                    'view.favorite.error.cannot_invite_current_location_is_not_a_concrete_instance'
                )
            );
            return;
        }
        const result = await confirm({
            title: t('view.favorites.modal.send_invite'),
            description:
                friendText(friend?.displayName) ||
                t('view.favorites.description.this_user'),
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
                endpoint: currentEndpoint,
                instanceId: inviteLocation,
                worldId: parsedLocation.worldId,
                rsvp: true
            });
            toast.success(t('message.invite.sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.toast.failed_to_send_invite')
            );
        }
    }

    async function requestFavoriteFriendInvite(item: any) {
        const friend = getFavoriteFriend(item);
        const friendId = normalizeEntityId(friend?.id || item?.id);
        if (!friendId || friendId === normalizeEntityId(currentUserId)) {
            return;
        }
        const result = await confirm({
            title: t('view.favorites.modal.request_invite'),
            description:
                friend?.displayName ||
                t('view.favorites.description.this_user'),
            confirmText: t('view.favorites.modal.request_invite_2'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            await sendRequestInviteToUser({
                receiverUserId: friendId,
                endpoint: currentEndpoint
            });
            toast.success(t('view.favorite.success.invite_request_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.toast.failed_to_request_invite')
            );
        }
    }

    async function sendFavoriteFriendBoop(item: any) {
        const friend = getFavoriteFriend(item);
        const friendId = normalizeEntityId(friend?.id || item?.id);
        if (!friendId || friendId === normalizeEntityId(currentUserId)) {
            return;
        }
        try {
            const result = await boopPrompt({
                endpoint: currentEndpoint,
                targetLabel:
                    friendText(friend?.displayName) ||
                    friendText(friend?.username) ||
                    friendId
            });
            if (!result.ok) {
                return;
            }
            await sendBoopToUser({
                userId: friendId,
                emojiId: result.value,
                endpoint: currentEndpoint
            });
            toast.success(t('view.favorite.success.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.toast.failed_to_send_boop')
            );
        }
    }

    function openWorldNewInstance(item: any, selfInvite: any = false) {
        if (!item?.id) {
            return;
        }
        openWorldDialog({
            worldId: item.id,
            title: item.title || undefined,
            seedData: item.seedData ?? null,
            initialAction: selfInvite ? 'newInstanceSelfInvite' : 'newInstance'
        });
    }

    async function selectFavoriteAvatar(item: any) {
        if (!item?.id) {
            return;
        }
        const shouldConfirm = await configRepository.getBool(
            'showConfirmationOnSwitchAvatar',
            true
        );
        if (shouldConfirm) {
            const result = await confirm({
                title: t('view.favorites.modal.select_avatar'),
                description:
                    item.title || t('view.favorites.empty.avatar_fallback'),
                confirmText: t('common.actions.select'),
                cancelText: t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }
        }
        try {
            await avatarProfileRepository.selectAvatar({
                avatarId: item.id,
                endpoint: currentEndpoint
            });
            toast.success(t('view.favorite.success.avatar_selected'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.toast.failed_to_select_avatar')
            );
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
        if (localGroups.some((group: any) => group.key === nextName)) {
            toast.error(
                t('view.favorites.dynamic.local_group_value_already_exists', {
                    value: nextName
                })
            );
            return;
        }
        try {
            await favoritePersistenceRepository.createLocalFavoriteGroup({
                kind,
                groupName: nextName
            });
            createLocalFavoriteGroup({
                kind,
                groupName: nextName
            });
            setSelectedSource('local');
            setSelectedGroupKey(nextName);
            setCreatingLocalGroup(false);
            setNewLocalGroupName('');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.toast.failed_to_create_local_favorite_group'
                      )
            );
        }
    }

    async function copySelection() {
        if (!selectedContentItems.length) {
            return;
        }
        try {
            await navigator.clipboard.writeText(
                selectedContentItems.map((item: any) => `${item.id}\n`).join('')
            );
            toast.success(
                t('view.favorite.success.copied_selected_favorite_ids')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.toast.failed_to_copy_selected_favorites'
                      )
            );
        }
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
