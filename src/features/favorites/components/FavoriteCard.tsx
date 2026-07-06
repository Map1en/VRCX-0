import {
    GlobeIcon,
    LockIcon,
    MoreHorizontalIcon,
    PersonStandingIcon,
    TriangleAlertIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/services/clipboardService';
import {
    openAvatarDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import type { LocalInstanceActionGates } from '@/shared/utils/invite';
import { resolveFriendPresenceLocation } from '@/shared/utils/location';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';

import { normalizeFavoriteEntityId as normalizeEntityId } from '../favoritesItems';

function resolvePresenceLocation(profile: unknown) {
    return resolveFriendPresenceLocation(profile);
}

type FavoriteCardSeedData = Record<string, unknown> & {
    groupName?: unknown;
    state?: unknown;
    stateBucket?: unknown;
    status?: unknown;
    travelingToWorld?: unknown;
    worldName?: unknown;
};

type FavoriteCardItem = {
    id: string;
    key: string;
    kind: 'friend' | 'world' | 'avatar' | string;
    source?: 'local' | 'remote' | 'history' | string;
    title?: string;
    subtitle?: string;
    imageUrl?: string;
    seedData?: FavoriteCardSeedData | null;
    groupLabel?: string;
    isPrivate?: boolean;
    isUnavailable?: boolean;
    titleColor?: string;
    travelingToLocation?: unknown;
};

type FavoriteCardProps = {
    item: FavoriteCardItem;
    instanceActionGate?: LocalInstanceActionGates;
    editMode?: boolean;
    selected?: boolean;
    showGroupLabel?: boolean;
    cardScale?: number;
    cardHeight?: number;
    cardSpacing?: number;
    removing?: boolean;
    onToggleSelect?: (key: string, selected: boolean) => void;
    onRemoveLocal?: (item: FavoriteCardItem) => void;
    onRemoveRemote?: (item: FavoriteCardItem) => void;
    onFriendLaunch?: (item: FavoriteCardItem) => void;
    onFriendSelfInvite?: (item: FavoriteCardItem) => void;
    onFriendInvite?: (item: FavoriteCardItem) => void;
    onFriendRequestInvite?: (item: FavoriteCardItem) => void;
    onFriendBoop?: (item: FavoriteCardItem) => void;
    onWorldNewInstance?: (item: FavoriteCardItem) => void;
    onWorldSelfInvite?: (item: FavoriteCardItem) => void;
    onAvatarSelect?: (item: FavoriteCardItem) => void;
};

const FavoriteCard = memo(function FavoriteCard({
    item,
    instanceActionGate,
    editMode,
    selected,
    showGroupLabel,
    cardScale = 1,
    cardHeight = 0,
    cardSpacing = 1,
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
    const canBoop = Boolean(currentUserSnapshot?.isBoopingEnabled);
    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';

    const Icon =
        item.kind === 'friend'
            ? UserIcon
            : item.kind === 'world'
              ? GlobeIcon
              : PersonStandingIcon;
    const openHandler =
        item.kind === 'friend'
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
    const isFriendOnline = Boolean(
        item.seedData?.state === 'online' ||
        item.seedData?.stateBucket === 'online' ||
        item.seedData?.status === 'active'
    );
    const canRequestInvite = Boolean(
        instanceActionGate?.canRequestInvite || isFriendOnline
    );
    const canSelectAvatar = Boolean(
        item.kind === 'avatar' &&
        item.id &&
        item.id !== currentAvatarId &&
        onAvatarSelect
    );
    const canUseWorldActions = Boolean(
        item.kind === 'world' && !item.isUnavailable
    );
    const worldFollowUpActionLabelKey = isGameRunning
        ? 'dialog.world.actions.new_instance_and_open_ingame'
        : 'dialog.world.actions.new_instance_and_self_invite';
    const canCopyUnavailableWorldId = Boolean(
        item.kind === 'world' && item.isUnavailable && item.id
    );
    const hasCardActions = Boolean(
        canRemoveLocal ||
        canRemoveRemote ||
        canSelectAvatar ||
        item.kind === 'friend' ||
        canUseWorldActions ||
        canCopyUnavailableWorldId
    );
    const friendLocation =
        item.kind === 'friend'
            ? resolvePresenceLocation(item.seedData || item)
            : '';
    const friendShowsLocation = Boolean(
        friendLocation && friendLocation !== 'offline'
    );
    const cardPaddingY = Math.max(4, Math.round(8 * cardScale * cardSpacing));
    const cardPaddingX = Math.max(4, Math.round(10 * cardScale * cardSpacing));
    const cardGap = Math.max(4, Math.round(8 * cardSpacing));
    const mediaSize = Math.max(28, Math.round(48 * cardScale));
    const openCard = () => openHandler?.();
    const copyWorldId = async () => {
        if (!item.id) {
            return;
        }
        await copyTextToClipboard(item.id, {
            successMessage: t('message.world.id_copied')
        });
    };
    const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!openHandler || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }
        event.preventDefault();
        openHandler();
    };
    const stopCardInteraction = (
        event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>
    ) => {
        event.stopPropagation();
    };

    return (
        <div
            className="hover:bg-muted flex w-full min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-lg border px-2.5 py-2 text-sm transition-colors"
            style={{
                gap: `${cardGap}px`,
                height: cardHeight ? `${cardHeight}px` : undefined,
                padding: `${cardPaddingY}px ${cardPaddingX}px`
            }}
            role={openHandler ? 'button' : undefined}
            tabIndex={openHandler ? 0 : undefined}
            aria-label={
                openHandler
                    ? t('view.friend_list.dynamic.open_value', {
                          value:
                              item.title ||
                              t('view.favorites.empty.favorite_fallback')
                      })
                    : undefined
            }
            onKeyDown={handleCardKeyDown}
            onClick={openHandler ? openCard : undefined}
        >
            <div
                className={cn(
                    'bg-muted flex size-12 shrink-0 items-center justify-center overflow-hidden',
                    item.kind === 'friend' ? 'rounded-full' : 'rounded-sm'
                )}
                style={{
                    width: `${mediaSize}px`,
                    height: `${mediaSize}px`
                }}
            >
                {item.imageUrl ? (
                    <img
                        src={item.imageUrl}
                        alt={item.title}
                        loading="lazy"
                        className="size-full object-cover"
                    />
                ) : item.kind === 'friend' ? (
                    <UsersIcon className="text-muted-foreground size-4" />
                ) : (
                    <Icon className="text-muted-foreground size-4" />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span
                        className="truncate font-medium"
                        style={
                            item.titleColor
                                ? { color: item.titleColor }
                                : undefined
                        }
                    >
                        {item.title}
                    </span>
                    {item.isUnavailable ? (
                        <TriangleAlertIcon className="text-destructive size-4 shrink-0" />
                    ) : null}
                    {item.isPrivate ? (
                        <LockIcon className="text-muted-foreground size-4 shrink-0" />
                    ) : null}
                </div>
                {friendShowsLocation ? (
                    <div
                        className="text-muted-foreground truncate text-xs"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <Location
                            location={friendLocation}
                            traveling={item.travelingToLocation}
                            hint={
                                item.seedData?.worldName ||
                                item.seedData?.travelingToWorld ||
                                ''
                            }
                            grouphint={item.seedData?.groupName || ''}
                            link={false}
                            asButton={false}
                            disableTooltip
                        />
                    </div>
                ) : (
                    <div className="text-muted-foreground truncate text-xs">
                        {item.subtitle}
                    </div>
                )}
                {showGroupLabel ? (
                    <div className="text-muted-foreground truncate text-xs">
                        {item.source === 'remote' ? 'VRChat' : 'Local'} /{' '}
                        {item.groupLabel}
                    </div>
                ) : null}
            </div>
            {editMode ? (
                <Checkbox
                    aria-label={`${t('common.actions.select')} ${
                        item.title ||
                        t('view.favorites.empty.favorite_fallback')
                    }`}
                    checked={selected}
                    onClick={stopCardInteraction}
                    onKeyDown={stopCardInteraction}
                    onCheckedChange={(checked) =>
                        onToggleSelect?.(item.key, Boolean(checked))
                    }
                />
            ) : hasCardActions ? (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="rounded-full"
                                aria-label={t('common.actions.configure')}
                                disabled={removing}
                                onClick={stopCardInteraction}
                            >
                                {removing ? (
                                    <Spinner data-icon="inline-start" />
                                ) : (
                                    <MoreHorizontalIcon data-icon="inline-start" />
                                )}
                            </Button>
                        }
                    />
                    <DropdownMenuContent
                        align="end"
                        onClick={stopCardInteraction}
                        onKeyDown={stopCardInteraction}
                        onPointerDown={stopCardInteraction}
                    >
                        <DropdownMenuGroup>
                            <DropdownMenuItem onClick={() => openHandler?.()}>
                                {t('common.actions.view_details')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        {item.kind === 'friend' ? (
                            <>
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        disabled={
                                            isCurrentUser ||
                                            !canRequestInvite ||
                                            !onFriendRequestInvite
                                        }
                                        onClick={() =>
                                            onFriendRequestInvite?.(item)
                                        }
                                    >
                                        {t(
                                            'dialog.user.actions.request_invite'
                                        )}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        disabled={
                                            isCurrentUser ||
                                            !canSendInvite ||
                                            !onFriendInvite
                                        }
                                        onClick={() => onFriendInvite?.(item)}
                                    >
                                        {t('dialog.user.actions.invite')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        disabled={
                                            isCurrentUser ||
                                            !canBoop ||
                                            !onFriendBoop
                                        }
                                        onClick={() => onFriendBoop?.(item)}
                                    >
                                        {t('dialog.user.actions.send_boop')}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        disabled={
                                            !canUseFriendLocation ||
                                            !onFriendLaunch
                                        }
                                        onClick={() => onFriendLaunch?.(item)}
                                    >
                                        {t('dialog.launch.open_ingame')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        disabled={
                                            !canUseFriendLocation ||
                                            !onFriendSelfInvite
                                        }
                                        onClick={() =>
                                            onFriendSelfInvite?.(item)
                                        }
                                    >
                                        {t('dialog.launch.self_invite')}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </>
                        ) : null}
                        {canUseWorldActions ? (
                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    disabled={!onWorldNewInstance}
                                    onClick={() => onWorldNewInstance?.(item)}
                                >
                                    {t('dialog.world.actions.new_instance')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={!onWorldSelfInvite}
                                    onClick={() => onWorldSelfInvite?.(item)}
                                >
                                    {t(worldFollowUpActionLabelKey)}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        ) : null}
                        {canCopyUnavailableWorldId ? (
                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    onClick={() => {
                                        copyWorldId();
                                    }}
                                >
                                    {t('dialog.world.info.copy_id')}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        ) : null}
                        {item.kind === 'avatar' ? (
                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    disabled={!canSelectAvatar}
                                    onClick={() => onAvatarSelect?.(item)}
                                >
                                    {t('dialog.avatar.actions.select')}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        ) : null}
                        {canRemoveLocal || canRemoveRemote ? (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        variant="destructive"
                                        onClick={() => {
                                            if (canRemoveLocal) {
                                                onRemoveLocal?.(item);
                                                return;
                                            }
                                            onRemoveRemote?.(item);
                                        }}
                                    >
                                        {canRemoveLocal
                                            ? t('common.actions.delete')
                                            : t(
                                                  'view.favorite.action.remove_favorite'
                                              )}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </>
                        ) : null}
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
        </div>
    );
});

export { FavoriteCard };
