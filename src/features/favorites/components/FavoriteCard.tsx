import {
    ExternalLinkIcon,
    GlobeIcon,
    LockIcon,
    MoreHorizontalIcon,
    PersonStandingIcon,
    Share2Icon,
    Trash2Icon,
    TriangleAlertIcon,
    UserIcon
} from 'lucide-react';
import { memo, type KeyboardEvent, type MouseEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import { FadeInImage } from '@/components/media/FadeInImage';
import {
    resolveSidebarStatusDotClassName,
    type SidebarFriendRecord
} from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { UserStatusDot } from '@/components/UserStatusDot';
import { cn } from '@/lib/utils';
import { registerWorldOpenShare } from '@/repositories/worldProfileRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
import {
    openAvatarDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import { openExternalLink } from '@/services/entityMediaService';
import {
    vrchatAvatarUrl,
    vrchatWorldUrl
} from '@/shared/constants/vrchatWebUrls';
import {
    vrcxAvatarDeepLink,
    vrcxWorldDeepLink
} from '@/shared/constants/vrcxDeepLinks';
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

import type { FavoritesDensityConfig } from '../favoritesDensity';
import { normalizeFavoriteEntityId as normalizeEntityId } from '../favoritesItems';

function resolvePresenceLocation(profile: unknown) {
    return resolveFriendPresenceLocation(profile);
}

type FavoriteCardSeedData = SidebarFriendRecord & {
    groupName?: unknown;
    releaseStatus?: unknown;
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
    imageSmallUrl?: string;
    seedData?: FavoriteCardSeedData | null;
    groupLabel?: string;
    isPrivate?: boolean;
    isDeleted?: boolean;
    isUnavailable?: boolean;
    titleColor?: string;
    travelingToLocation?: unknown;
    playerCount?: number;
};

type FavoriteCardProps = {
    item: FavoriteCardItem;
    instanceActionGate?: LocalInstanceActionGates;
    selectionActive?: boolean;
    selected?: boolean;
    showGroupLabel?: boolean;
    densityConfig: FavoritesDensityConfig;
    removing?: boolean;
    onToggleSelect?: (key: string, selected: boolean, shift: boolean) => void;
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
    const canBoop = Boolean(currentUserSnapshot?.isBoopingEnabled);
    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';
    const isFriendCard = item.kind === 'friend';
    const isCoverTier = densityConfig.layout === 'cover';
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
    const avatarId = item.kind === 'avatar' ? item.id : '';
    const vrchatAvatarPageUrl = avatarId ? vrchatAvatarUrl(avatarId) : '';
    const vrcxAvatarShareUrl =
        !item.isPrivate && item.seedData?.releaseStatus === 'public'
            ? vrcxAvatarDeepLink(avatarId)
            : '';
    const canUseAvatarLinks = Boolean(avatarId);
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
    const worldId = item.kind === 'world' ? item.id : '';
    const vrchatWorldPageUrl = worldId ? vrchatWorldUrl(worldId) : '';
    const vrcxWorldShareUrl = vrcxWorldDeepLink(worldId);
    const hasCardActions = Boolean(
        canRemoveLocal ||
        canRemoveRemote ||
        canSelectAvatar ||
        canUseAvatarLinks ||
        item.kind === 'friend' ||
        canUseWorldActions ||
        canCopyWorldId
    );
    const friendLocation = isFriendCard
        ? resolvePresenceLocation(item.seedData || item)
        : '';
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
              ...(item.seedData || {}),
              id: item.seedData?.id || item.id,
              displayName: item.seedData?.displayName || item.title
          }
        : null;
    const statusDotClassName = friendStatusSource
        ? resolveSidebarStatusDotClassName(
              friendStatusSource,
              currentUserSnapshot,
              isCurrentUser,
              { isGameRunning }
          )
        : '';
    const isSelectionActive = Boolean(selectionActive);
    const shiftPressedRef = useRef(false);
    const copyWorldId = async () => {
        if (!item.id) {
            return;
        }
        await copyTextToClipboard(item.id, {
            successMessage: t('message.world.id_copied')
        });
    };
    const copyVrcxWorldShareLink = () => {
        if (!vrcxWorldShareUrl) {
            return;
        }
        void copyTextToClipboard(vrcxWorldShareUrl, {
            successMessage: t('dialog.world.dynamic.value_copied', {
                value: t('dialog.world.info.vrcx_url')
            })
        });
        registerWorldOpenShare(worldId);
    };
    const copyVrcxAvatarShareLink = () => {
        if (!vrcxAvatarShareUrl) {
            return;
        }
        void copyTextToClipboard(vrcxAvatarShareUrl, {
            successMessage: t('dialog.avatar.dynamic.value_copied', {
                value: t('dialog.avatar.info.vrcx_url')
            })
        });
    };
    const activateCard = (shift: boolean) => {
        if (isSelectionActive) {
            onToggleSelect?.(item.key, !selected, shift);
            return;
        }
        openHandler?.();
    };
    const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
        activateCard(event.shiftKey);
    };
    const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (
            (!openHandler && !isSelectionActive) ||
            (event.key !== 'Enter' && event.key !== ' ')
        ) {
            return;
        }
        event.preventDefault();
        activateCard(event.shiftKey);
    };
    const stopCardInteraction = (
        event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>
    ) => {
        event.stopPropagation();
    };
    const handleCheckboxClickCapture = (event: MouseEvent<HTMLElement>) => {
        shiftPressedRef.current = event.shiftKey;
    };
    const itemLabel = item.title || t('view.favorites.empty.favorite_fallback');
    const cardAriaLabel = isSelectionActive
        ? `${t('common.actions.select')} ${itemLabel}`
        : openHandler
          ? t('view.friend_list.dynamic.open_value', { value: itemLabel })
          : undefined;
    const isCardInteractive = Boolean(openHandler) || isSelectionActive;
    const cardShellProps = {
        role: isCardInteractive ? 'button' : undefined,
        tabIndex: isCardInteractive ? 0 : undefined,
        'aria-label': cardAriaLabel,
        onKeyDown: handleCardKeyDown,
        onClick: isCardInteractive ? handleCardClick : undefined
    } as const;

    const renderSelectionCheckbox = (positionClassName: string) => (
        <span
            className={cn(
                positionClassName,
                'opacity-0 transition-opacity',
                'group-focus-within/fav-card:opacity-100 group-hover/fav-card:opacity-100',
                selected && 'opacity-100'
            )}
            onClickCapture={handleCheckboxClickCapture}
            onClick={stopCardInteraction}
            onKeyDown={stopCardInteraction}
        >
            <Checkbox
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
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
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
                        {item.kind === 'world' ? (
                            <>
                                <DropdownMenuItem
                                    disabled={!vrchatWorldPageUrl}
                                    onClick={() => {
                                        void openExternalLink(
                                            vrchatWorldPageUrl
                                        );
                                    }}
                                >
                                    <ExternalLinkIcon data-icon="inline-start" />
                                    {t('common.actions.view_on_website')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={!vrcxWorldShareUrl}
                                    onClick={copyVrcxWorldShareLink}
                                >
                                    <Share2Icon data-icon="inline-start" />
                                    {t('dialog.world.info.copy_vrcx_url')}
                                </DropdownMenuItem>
                            </>
                        ) : null}
                        {canCopyWorldId ? (
                            <DropdownMenuItem
                                onClick={() => {
                                    copyWorldId();
                                }}
                            >
                                {t('dialog.world.info.copy_id')}
                            </DropdownMenuItem>
                        ) : null}
                        {item.kind === 'avatar' ? (
                            <>
                                <DropdownMenuItem
                                    disabled={!vrchatAvatarPageUrl}
                                    onClick={() => {
                                        void openExternalLink(
                                            vrchatAvatarPageUrl
                                        );
                                    }}
                                >
                                    <ExternalLinkIcon data-icon="inline-start" />
                                    {t('common.actions.view_on_website')}
                                </DropdownMenuItem>
                                {vrcxAvatarShareUrl ? (
                                    <DropdownMenuItem
                                        onClick={copyVrcxAvatarShareLink}
                                    >
                                        <Share2Icon data-icon="inline-start" />
                                        {t('dialog.avatar.info.copy_vrcx_url')}
                                    </DropdownMenuItem>
                                ) : null}
                            </>
                        ) : null}
                    </DropdownMenuGroup>
                    {item.kind === 'avatar' ? (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    disabled={!canSelectAvatar}
                                    onClick={() => onAvatarSelect?.(item)}
                                >
                                    {t('dialog.avatar.actions.select')}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        </>
                    ) : null}
                    {item.kind === 'friend' ? (
                        <>
                            <DropdownMenuSeparator />
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
                                    {t('dialog.user.actions.request_invite')}
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
                                        !canUseFriendLocation || !onFriendLaunch
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
                                    onClick={() => onFriendSelfInvite?.(item)}
                                >
                                    {t('dialog.launch.self_invite')}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        </>
                    ) : null}
                    {canUseWorldActions ? (
                        <>
                            <DropdownMenuSeparator />
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
                        </>
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
        ) : null;

    if (isCoverTier) {
        const showUnavailableCopyId = item.isUnavailable && canCopyWorldId;

        return (
            <div
                className={cn(
                    'group/fav-card hover:bg-muted flex h-full w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border text-sm transition-colors',
                    selected && 'border-primary ring-primary/50 ring-1'
                )}
                {...cardShellProps}
            >
                <div
                    className={cn(
                        'bg-muted relative w-full shrink-0 overflow-hidden',
                        item.isUnavailable && 'opacity-60 grayscale'
                    )}
                    style={{
                        aspectRatio: String(densityConfig.imageAspectRatio)
                    }}
                >
                    {item.imageUrl && !item.isUnavailable ? (
                        <FadeInImage
                            src={
                                densityConfig.value === 'compact'
                                    ? item.imageSmallUrl || item.imageUrl
                                    : item.imageUrl
                            }
                            alt={item.title}
                            loading="lazy"
                            className="size-full object-cover"
                            fallback={
                                <span className="flex size-full items-center justify-center">
                                    <Icon className="text-muted-foreground size-8" />
                                </span>
                            }
                        />
                    ) : (
                        <span className="flex size-full items-center justify-center">
                            <Icon className="text-muted-foreground size-8" />
                        </span>
                    )}
                    {showPlayerCountBadge ? (
                        <span
                            className={cn(
                                'bg-background/55 text-foreground/75 absolute top-1.5 left-1.5 z-10 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-normal tabular-nums backdrop-blur-[2px] transition-opacity',
                                'group-hover/fav-card:opacity-0',
                                selected && 'opacity-0'
                            )}
                        >
                            <span className="size-1.5 rounded-full bg-[var(--status-online)]" />
                            {item.playerCount}
                        </span>
                    ) : null}
                    {renderSelectionCheckbox('absolute top-1.5 left-1.5 z-10')}
                    {actionsMenu ? (
                        <span
                            className="absolute top-1.5 right-1.5 z-10"
                            onClick={stopCardInteraction}
                            onKeyDown={stopCardInteraction}
                        >
                            {actionsMenu}
                        </span>
                    ) : null}
                    {isWornAvatar ? (
                        <span className="bg-background/80 text-foreground absolute bottom-1.5 left-1.5 z-10 rounded-full px-1.5 py-0.5 text-xs font-medium">
                            {t('dialog.avatar.actions.current_avatar')}
                        </span>
                    ) : null}
                    {item.isDeleted || item.isPrivate ? (
                        <span className="bg-background/80 absolute right-1.5 bottom-1.5 z-10 flex size-5 items-center justify-center rounded-full">
                            {item.isDeleted ? (
                                <Trash2Icon className="text-muted-foreground size-3.5" />
                            ) : (
                                <LockIcon className="text-muted-foreground size-3.5" />
                            )}
                        </span>
                    ) : null}
                </div>
                <div className="flex min-h-0 flex-1 flex-col justify-center gap-0.5 px-2.5 py-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <UserHoverCard {...friendHoverCardProps}>
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
                        </UserHoverCard>
                        {item.isUnavailable ? (
                            <TriangleAlertIcon className="text-destructive size-4 shrink-0" />
                        ) : item.isDeleted ? (
                            <Trash2Icon className="text-muted-foreground size-4 shrink-0" />
                        ) : null}
                    </div>
                    {showUnavailableCopyId ? (
                        <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            className="w-fit"
                            onClick={(event) => {
                                stopCardInteraction(event);
                                copyWorldId();
                            }}
                        >
                            {t('dialog.world.info.copy_id')}
                        </Button>
                    ) : (
                        <div className="text-muted-foreground truncate text-xs">
                            {item.subtitle}
                        </div>
                    )}
                    {groupLabelRow}
                </div>
            </div>
        );
    }

    return (
        <div
            className={cn(
                'group/fav-card hover:bg-muted flex h-full w-full min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-lg border px-2.5 py-2 text-sm transition-colors',
                selected && 'border-primary ring-primary/50 ring-1'
            )}
            {...cardShellProps}
        >
            <UserHoverCard {...friendHoverCardProps}>
                <div
                    className={cn(
                        'relative flex shrink-0 items-center justify-center',
                        isFriendCard
                            ? 'ml-2 overflow-visible'
                            : 'bg-muted overflow-hidden rounded-sm'
                    )}
                    style={{
                        width: `${densityConfig.mediaWidth}px`,
                        height: `${densityConfig.mediaHeight}px`
                    }}
                >
                    <span
                        className={cn(
                            'flex size-full items-center justify-center overflow-hidden',
                            isFriendCard && 'bg-muted rounded-full border'
                        )}
                    >
                        {item.imageSmallUrl || item.imageUrl ? (
                            <FadeInImage
                                src={item.imageSmallUrl || item.imageUrl}
                                alt={item.title}
                                loading="lazy"
                                className="size-full object-cover"
                                fallback={
                                    <Icon className="text-muted-foreground size-4" />
                                }
                            />
                        ) : (
                            <Icon className="text-muted-foreground size-4" />
                        )}
                    </span>
                    {isFriendCard ? (
                        <UserStatusDot
                            statusDotClassName={statusDotClassName}
                            className="absolute -right-0.5 -bottom-0.5 z-10 size-3.75"
                        />
                    ) : null}
                    {renderSelectionCheckbox(
                        'absolute inset-0 z-20 flex items-center justify-center'
                    )}
                </div>
            </UserHoverCard>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                    <UserHoverCard {...friendHoverCardProps}>
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
                    </UserHoverCard>
                    {item.isUnavailable ? (
                        <TriangleAlertIcon className="text-destructive size-4 shrink-0" />
                    ) : item.isDeleted ? (
                        <Trash2Icon className="text-muted-foreground size-4 shrink-0" />
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
                        {showPlayerCountBadge ? (
                            <>
                                <span className="inline-flex items-baseline gap-1">
                                    <span className="size-1.5 shrink-0 self-center rounded-full bg-[var(--status-online)]" />
                                    {item.playerCount}
                                </span>
                                {item.subtitle ? ' · ' : ''}
                            </>
                        ) : null}
                        {item.subtitle}
                    </div>
                )}
                {groupLabelRow}
            </div>
            <div className="flex size-8 shrink-0 items-center justify-center">
                {actionsMenu}
            </div>
        </div>
    );
});

export { FavoriteCard };
export type { FavoriteCardItem };
