import { GlobeIcon, PersonStandingIcon, UserIcon } from 'lucide-react';
import { memo, type KeyboardEvent, type MouseEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
    resolveSidebarStatusDotClassName,
    type SidebarFriendRecord
} from '@/components/friends/friendStatusModel';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/services/clipboardService';
import {
    openAvatarDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import {
    TILE_SELECT_BOX,
    TILE_SELECT_TOGGLE,
    TILE_SELECT_TOGGLE_VISIBLE
} from '@/shared/constants/selectableTile';
import type { LocalInstanceActionGates } from '@/shared/utils/invite';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Checkbox } from '@/ui/shadcn/checkbox';

import type { FavoritesDensityConfig } from '../favoritesDensity';
import { normalizeFavoriteEntityId as normalizeEntityId } from '../favoritesItems';
import type { FavoriteItem } from '../favoritesTypes';
import { FavoriteCardActionMenu } from './FavoriteCardActionMenu';
import { FavoriteCardView } from './FavoriteCardView';

type FavoriteCardItem = FavoriteItem;

type FavoriteCardProps = {
    item: FavoriteItem;
    instanceActionGate?: LocalInstanceActionGates;
    selectionActive?: boolean;
    selected?: boolean;
    showGroupLabel?: boolean;
    densityConfig: FavoritesDensityConfig;
    removing?: boolean;
    onToggleSelect?: (key: string, selected: boolean, shift: boolean) => void;
    onRemoveLocal?: (item: FavoriteItem) => void;
    onRemoveRemote?: (item: FavoriteItem) => void;
    onFriendLaunch?: (item: FavoriteItem) => void;
    onFriendSelfInvite?: (item: FavoriteItem) => void;
    onFriendInvite?: (item: FavoriteItem) => void;
    onFriendRequestInvite?: (item: FavoriteItem) => void;
    onFriendBoop?: (item: FavoriteItem) => void;
    onWorldNewInstance?: (item: FavoriteItem) => void;
    onWorldSelfInvite?: (item: FavoriteItem) => void;
    onAvatarSelect?: (item: FavoriteItem) => void;
};

const FavoriteCard = memo(function FavoriteCard({
    item,
    instanceActionGate,
    selectionActive,
    selected,
    showGroupLabel,
    densityConfig,
    removing = false,
    onToggleSelect,
    onRemoveLocal,
    onRemoveRemote,
    onFriendLaunch,
    onFriendSelfInvite,
    onFriendInvite,
    onFriendRequestInvite,
    onFriendBoop,
    onWorldNewInstance,
    onWorldSelfInvite,
    onAvatarSelect
}: FavoriteCardProps) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const normalizedCurrentUserId = normalizeEntityId(currentUserId);
    const canSendInvite = Boolean(instanceActionGate?.canInvite);
    const canBoop = currentUserSnapshot?.isBoopingEnabled === true;
    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';
    const isFriendCard = item.kind === 'friend';
    const friendHoverCardProps = {
        userId: item.id,
        seed: item.seedData ?? null,
        disabled: !isFriendCard
    };
    const Icon = isFriendCard
        ? UserIcon
        : item.kind === 'world'
          ? GlobeIcon
          : PersonStandingIcon;
    const openHandler = isFriendCard
        ? () =>
              openUserDialog({
                  userId: item.id,
                  title: item.title || undefined,
                  seedData: item.seedData ?? null
              })
        : item.kind === 'world'
          ? () =>
                openWorldDialog({
                    worldId: item.id,
                    title: item.title || undefined,
                    seedData: item.seedData ?? null
                })
          : item.kind === 'avatar'
            ? () =>
                  openAvatarDialog({
                      avatarId: item.id,
                      title: item.title || undefined,
                      seedData: item.seedData ?? null
                  })
            : null;
    const canRemoveLocal =
        item.source === 'local' && typeof onRemoveLocal === 'function';
    const canRemoveRemote =
        item.source === 'remote' && typeof onRemoveRemote === 'function';
    const canUseFriendLocation = Boolean(instanceActionGate?.canJoin);
    const isCurrentUser = Boolean(
        item.id && item.id === normalizedCurrentUserId
    );
    const canSelectAvatar = Boolean(
        item.kind === 'avatar' &&
        item.id &&
        item.id !== currentAvatarId &&
        onAvatarSelect
    );
    const canUseWorldActions = Boolean(
        item.kind === 'world' && !item.isUnavailable && !item.isDeleted
    );
    const worldFollowUpActionLabelKey = isGameRunning
        ? 'dialog.world.actions.new_instance_and_open_ingame'
        : 'dialog.world.actions.new_instance_and_self_invite';
    const canCopyWorldId = Boolean(
        item.kind === 'world' &&
        (item.isUnavailable || item.isDeleted) &&
        item.id
    );
    const hasCardActions = Boolean(
        canRemoveLocal ||
        canRemoveRemote ||
        item.kind === 'avatar' ||
        item.kind === 'friend' ||
        canUseWorldActions ||
        canCopyWorldId
    );
    const friendLocation = isFriendCard ? item.location || '' : '';
    const friendShowsLocation = Boolean(
        friendLocation && friendLocation !== 'offline'
    );
    const isWornAvatar = Boolean(
        item.kind === 'avatar' && item.id && item.id === currentAvatarId
    );
    const showPlayerCountBadge = Boolean(
        item.kind === 'world' && (item.playerCount || 0) > 0
    );
    const friendStatusSource: SidebarFriendRecord | null = isFriendCard
        ? {
              ...item.seedData,
              id: item.seedData?.id || item.id,
              displayName: item.seedData?.displayName || item.title
          }
        : null;
    const statusDotClassName = friendStatusSource
        ? resolveSidebarStatusDotClassName(friendStatusSource)
        : '';
    const isSelectionActive = Boolean(selectionActive);
    const shiftPressedRef = useRef(false);

    async function copyWorldId() {
        if (!item.id) {
            return;
        }
        await copyTextToClipboard(item.id, {
            successMessage: t('message.world.id_copied')
        });
    }

    function activateCard(shift: boolean) {
        if (isSelectionActive) {
            onToggleSelect?.(item.key, !selected, shift);
            return;
        }
        openHandler?.();
    }

    function handleCardClick(event: MouseEvent<HTMLDivElement>) {
        activateCard(event.shiftKey);
    }

    function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (
            (!openHandler && !isSelectionActive) ||
            (event.key !== 'Enter' && event.key !== ' ')
        ) {
            return;
        }
        event.preventDefault();
        activateCard(event.shiftKey);
    }

    function stopCardInteraction(
        event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>
    ) {
        event.stopPropagation();
    }

    function handleCheckboxClickCapture(event: MouseEvent<HTMLElement>) {
        shiftPressedRef.current = event.shiftKey;
    }

    const itemLabel = item.title || t('view.favorites.empty.favorite_fallback');
    const cardAriaLabel = isSelectionActive
        ? `${t('common.actions.select')} ${itemLabel}`
        : openHandler
          ? t('view.friend_list.dynamic.open_value', { value: itemLabel })
          : undefined;
    const isCardInteractive = Boolean(openHandler) || isSelectionActive;
    const selectionCheckbox = (
        <span
            role="presentation"
            className={cn(
                TILE_SELECT_TOGGLE,
                selected && TILE_SELECT_TOGGLE_VISIBLE
            )}
            onClickCapture={handleCheckboxClickCapture}
            onClick={stopCardInteraction}
            onKeyDown={stopCardInteraction}
        >
            <Checkbox
                className={TILE_SELECT_BOX}
                aria-label={`${t('common.actions.select')} ${itemLabel}`}
                checked={selected}
                onClick={stopCardInteraction}
                onKeyDown={stopCardInteraction}
                onCheckedChange={(checked) =>
                    onToggleSelect?.(
                        item.key,
                        Boolean(checked),
                        shiftPressedRef.current
                    )
                }
            />
        </span>
    );
    const groupLabelRow = showGroupLabel ? (
        <div className="text-muted-foreground truncate text-xs">
            {item.source === 'remote' ? 'VRChat' : 'Local'} / {item.groupLabel}
        </div>
    ) : null;
    const actionsMenu =
        !isSelectionActive && hasCardActions ? (
            <FavoriteCardActionMenu
                model={{
                    item,
                    removing,
                    canRemoveLocal,
                    canRemoveRemote,
                    canSelectAvatar,
                    canUseFriendLocation,
                    canSendInvite,
                    canBoop,
                    canUseWorldActions,
                    canCopyWorldId,
                    isCurrentUser,
                    worldFollowUpActionLabelKey
                }}
                actions={{
                    openDetails: openHandler,
                    copyWorldId: () => {
                        void copyWorldId();
                    },
                    removeLocal: onRemoveLocal,
                    removeRemote: onRemoveRemote,
                    friendLaunch: onFriendLaunch,
                    friendSelfInvite: onFriendSelfInvite,
                    friendInvite: onFriendInvite,
                    friendRequestInvite: onFriendRequestInvite,
                    friendBoop: onFriendBoop,
                    worldNewInstance: onWorldNewInstance,
                    worldSelfInvite: onWorldSelfInvite,
                    avatarSelect: onAvatarSelect,
                    stopInteraction: stopCardInteraction
                }}
            />
        ) : null;

    return (
        <FavoriteCardView
            model={{
                item,
                density: densityConfig,
                selected: Boolean(selected),
                isFriend: isFriendCard,
                isWornAvatar,
                showPlayerCountBadge,
                friendShowsLocation,
                friendLocation,
                statusDotClassName,
                icon: Icon,
                friendHoverCard: friendHoverCardProps
            }}
            slots={{
                selection: selectionCheckbox,
                actions: actionsMenu,
                groupLabel: groupLabelRow
            }}
            interactions={{
                shell: {
                    role: isCardInteractive ? 'button' : undefined,
                    tabIndex: isCardInteractive ? 0 : undefined,
                    'aria-label': cardAriaLabel,
                    onKeyDown: handleCardKeyDown,
                    onClick: isCardInteractive ? handleCardClick : undefined
                },
                stop: stopCardInteraction,
                copyWorldId: () => {
                    void copyWorldId();
                }
            }}
        />
    );
});

export { FavoriteCard };
export type { FavoriteCardItem };
