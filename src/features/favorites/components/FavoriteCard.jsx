import {
    GlobeIcon,
    ImageIcon,
    LockIcon,
    MoreHorizontalIcon,
    TriangleAlertIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { memo } from 'react';

import { useTranslation } from 'react-i18next';
import { Location } from '@/components/Location.jsx';
import { cn } from '@/lib/utils.js';
import {
    openAvatarDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location.js';
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
import { normalizeFavoriteEntityId as normalizeEntityId } from '../favoritesItems.js';

function resolvePresenceLocation(profile) {
    return resolveFriendPresenceLocation(profile);
}

const FavoriteCard = memo(function FavoriteCard({
    item,
    editMode,
    selected,
    showGroupLabel,
    cardScale = 1,
    cardSpacing = 1,
    removing = false,
    onToggleSelect,
    onRemoveLocal,
    onRemoveRemote,
    canSendInvite = false,
    canBoop = false,
    currentUserId = '',
    currentAvatarId = '',
    onFriendLaunch,
    onFriendSelfInvite,
    onFriendInvite,
    onFriendRequestInvite,
    onFriendBoop,
    onWorldNewInstance,
    onWorldSelfInvite,
    onAvatarSelect
}) {
    const { t } = useTranslation();

    const Icon =
        item.kind === 'friend'
            ? UserIcon
            : item.kind === 'world'
              ? GlobeIcon
              : ImageIcon;
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
    const parsedFriendLocation = friendActionLocation
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
    const hasCardActions = Boolean(
        canRemoveLocal ||
        canRemoveRemote ||
        canSelectAvatar ||
        item.kind === 'friend' ||
        item.kind === 'world'
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
    const handleCardKeyDown = (event) => {
        if (!openHandler || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }
        event.preventDefault();
        openHandler();
    };

    return (
        <div
            className="hover:bg-muted flex min-w-56 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors"
            style={{
                gap: `${cardGap}px`,
                padding: `${cardPaddingY}px ${cardPaddingX}px`
            }}
            role={openHandler ? 'button' : undefined}
            tabIndex={openHandler ? 0 : undefined}
            aria-label={
                openHandler
                    ? `Open ${item.title || 'favorite item'}`
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
                    aria-label={`Select ${item.title || 'favorite item'}`}
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(checked) =>
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
                            aria-label={"Favorite item options"}
                            disabled={removing}
                            onClick={(event) => event.stopPropagation()}
                        >
                            {removing ? (
                                <Spinner data-icon="inline-start" />
                            ) : (
                                <MoreHorizontalIcon data-icon="inline-start" />
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={() => openHandler?.()}>
                                {t('view.favorite.generated.view_details')}
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
                                        {t('view.favorite.generated.request_invite')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        disabled={
                                            isCurrentUser ||
                                            !canSendInvite ||
                                            !onFriendInvite
                                        }
                                        onSelect={() => onFriendInvite?.(item)}
                                    >
                                        {t('view.favorite.generated.send_invite')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        disabled={
                                            isCurrentUser ||
                                            !canBoop ||
                                            !onFriendBoop
                                        }
                                        onSelect={() => onFriendBoop?.(item)}
                                    >
                                        {t('view.favorite.generated.send_boop')}
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
                                        {t('view.favorite.generated.launch_in_vrchat')}
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
                                        {t('view.favorite.generated.self_invite')}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </>
                        ) : null}
                        {item.kind === 'world' ? (
                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    disabled={!onWorldNewInstance}
                                    onSelect={() => onWorldNewInstance?.(item)}
                                >
                                    {t('view.favorite.generated.new_instance')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={!onWorldSelfInvite}
                                    onSelect={() => onWorldSelfInvite?.(item)}
                                >
                                    {t('view.favorite.generated.new_instance_and_self_invite')}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        ) : null}
                        {item.kind === 'avatar' ? (
                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    disabled={!canSelectAvatar}
                                    onSelect={() => onAvatarSelect?.(item)}
                                >
                                    {t('view.favorite.generated.select_avatar')}
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
                                        {item.source === 'local'
                                            ? 'Delete'
                                            : 'Unfavorite'}
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
