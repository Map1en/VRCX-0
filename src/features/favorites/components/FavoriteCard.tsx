import {
    GlobeIcon,
    LockIcon,
    MoreHorizontalIcon,
    PersonStandingIcon,
    TriangleAlertIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Location } from '@/components/Location';
import { cn } from '@/lib/utils';
import {
    openAvatarDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import { copyTextToClipboard } from '@/services/entityMediaService';
import { checkCanInvite } from '@/shared/utils/invite';
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';
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

import {
    normalizeFavoriteEntityId as normalizeEntityId,
    resolveCurrentInviteLocation
} from '../favoritesItems';

function resolvePresenceLocation(profile: any) {
    return resolveFriendPresenceLocation(profile);
}

const FavoriteCard = memo(function FavoriteCard({
    item,
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
}: any) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state: any) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state: any) => state.gameState.currentDestination
    );
    const isGameRunning = useRuntimeStore(
        (state: any) => state.gameState.isGameRunning
    );
    const gameState = useMemo(
        () => ({
            currentLocation: runtimeCurrentLocation,
            currentDestination: runtimeCurrentDestination,
            isGameRunning
        }),
        [isGameRunning, runtimeCurrentDestination, runtimeCurrentLocation]
    );
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUserSnapshot),
        [currentUserSnapshot, gameState]
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(currentInviteLocation, {
                currentUserId,
                lastLocationStr: currentInviteLocation,
                cachedInstances: new Map()
            }),
        [currentInviteLocation, currentUserId]
    );
    const canSendInvite = Boolean(
        isGameRunning && currentInviteLocation && canInviteFromCurrentLocation
    );
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
    const friendActionLocation =
        item.kind === 'friend' ? resolvePresenceLocation(item.seedData) : '';
    const parsedFriendLocation: any = friendActionLocation
        ? parseLocation(friendActionLocation)
        : {};
    const canUseFriendLocation = Boolean(
        parsedFriendLocation.isRealInstance &&
        parsedFriendLocation.worldId &&
        parsedFriendLocation.instanceId
    );
    const isCurrentUser = Boolean(
        item.id && item.id === normalizeEntityId(currentUserId)
    );
    const isFriendOnline = Boolean(
        item.seedData?.state === 'online' ||
        item.seedData?.stateBucket === 'online' ||
        item.seedData?.status === 'active'
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
        await copyTextToClipboard(item.id);
        toast.success(t('message.world.id_copied'));
    };
    const handleCardKeyDown = (event: any) => {
        if (!openHandler || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }
        event.preventDefault();
        openHandler();
    };
    const stopCardInteraction = (event: any) => {
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
                        onClick={(event: any) => event.stopPropagation()}
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
                    onCheckedChange={(checked: any) =>
                        onToggleSelect?.(item.key, Boolean(checked))
                    }
                />
            ) : hasCardActions ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
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
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        onClick={stopCardInteraction}
                        onKeyDown={stopCardInteraction}
                        onPointerDown={stopCardInteraction}
                    >
                        <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={() => openHandler?.()}>
                                {t('common.actions.view_details')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        {item.kind === 'friend' ? (
                            <>
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        disabled={
                                            isCurrentUser ||
                                            !isFriendOnline ||
                                            !onFriendRequestInvite
                                        }
                                        onSelect={() =>
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
                                        onSelect={() => onFriendInvite?.(item)}
                                    >
                                        {t('dialog.user.actions.invite')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        disabled={
                                            isCurrentUser ||
                                            !canBoop ||
                                            !onFriendBoop
                                        }
                                        onSelect={() => onFriendBoop?.(item)}
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
                                        onSelect={() => onFriendLaunch?.(item)}
                                    >
                                        {t('dialog.launch.open_ingame')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        disabled={
                                            !canUseFriendLocation ||
                                            !onFriendSelfInvite
                                        }
                                        onSelect={() =>
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
                                    onSelect={() => onWorldNewInstance?.(item)}
                                >
                                    {t('dialog.world.actions.new_instance')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={!onWorldSelfInvite}
                                    onSelect={() => onWorldSelfInvite?.(item)}
                                >
                                    {t(worldFollowUpActionLabelKey)}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        ) : null}
                        {canCopyUnavailableWorldId ? (
                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    onSelect={() => {
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
                                    onSelect={() => onAvatarSelect?.(item)}
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
                                        onSelect={() => {
                                            if (canRemoveLocal) {
                                                onRemoveLocal(item);
                                                return;
                                            }
                                            onRemoveRemote(item);
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
