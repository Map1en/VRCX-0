import {
    ExternalLinkIcon,
    GlobeIcon,
    MoreHorizontalIcon,
    PencilIcon,
    UserIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { UserStatusDot } from '@/components/UserStatusDot';
import { cn } from '@/lib/utils';
import { userImage } from '@/services/entityMediaService';
import { normalizeLocationValue, parseLocation } from '@/shared/utils/location';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

function normalizeStatusText(value: any) {
    const status =
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : String(value ?? '')
                  .trim()
                  .toLowerCase();
    if (status === 'joinme') {
        return 'join me';
    }
    if (status === 'askme') {
        return 'ask me';
    }
    if (status === 'offline:offline' || status.startsWith('offline ')) {
        return 'offline';
    }
    if (status === 'private:private') {
        return 'private';
    }
    if (status === 'traveling:traveling') {
        return 'traveling';
    }
    return status;
}

function readFriendRef(friend: any) {
    return friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
}

function hasFriendRef(friend: any) {
    return Boolean(friend?.ref && typeof friend.ref === 'object');
}

function isLiveBucketState(value: any) {
    const state = normalizeStatusText(value);
    return state === 'online' || state === 'active';
}

function isStaleOfflineLocationForLiveState(location: any, state: any) {
    return (
        isLiveBucketState(state) &&
        normalizeLocationStatus(location) === 'offline'
    );
}

function resolveRawCardLocation(rawLocation: any, friend: any) {
    const source = readFriendRef(friend);
    return (
        normalizeLocationValue(source?.location) ||
        (hasFriendRef(friend) ? '' : normalizeLocationValue(rawLocation)) ||
        ''
    );
}

function resolveCardLocation(rawLocation: any, friend: any) {
    const source = readFriendRef(friend);
    const state = normalizeStatusText(source?.stateBucket || source?.state);
    const explicitLocation = resolveRawCardLocation(rawLocation, friend);
    if (isStaleOfflineLocationForLiveState(explicitLocation, state)) {
        return '';
    }
    const parsedExplicitLocation = parseLocation(explicitLocation);
    if (parsedExplicitLocation.isOffline) {
        return 'offline';
    }
    if (parsedExplicitLocation.isPrivate) {
        return 'private';
    }
    if (parsedExplicitLocation.isTraveling) {
        return 'traveling';
    }
    if (explicitLocation) {
        return explicitLocation;
    }
    return '';
}

function normalizeLocationStatus(value: any) {
    const parsedLocation = parseLocation(value);
    if (parsedLocation.isOffline) {
        return 'offline';
    }
    if (parsedLocation.isPrivate) {
        return 'private';
    }
    if (parsedLocation.isTraveling) {
        return 'traveling';
    }
    return normalizeStatusText(value);
}

function resolveFriendLocationStatus(friend: any, currentUser: any) {
    const source = readFriendRef(friend);
    if (!source) {
        return '';
    }
    const userId = normalizeStatusText(source.id || source.userId);
    const rawStatus = normalizeStatusText(source.status);
    const friendStatus = normalizeStatusText(source.status);
    const state = normalizeStatusText(source.stateBucket || source.state);
    const location = normalizeLocationStatus(source.location);
    const isOnlineByCurrentSnapshot = (
        currentUser?.onlineFriends || []
    ).includes(userId);
    const isActiveByCurrentSnapshot = (
        currentUser?.activeFriends || []
    ).includes(userId);

    if (friend?.pendingOffline || source?.pendingOffline) {
        return 'offline';
    }
    if (
        rawStatus !== 'active' &&
        location === 'private' &&
        state === '' &&
        userId &&
        !isOnlineByCurrentSnapshot
    ) {
        return isActiveByCurrentSnapshot ? 'active-state' : 'offline';
    }
    if (state === 'active') {
        if (friendStatus === 'join me') {
            return 'active-join';
        }
        if (friendStatus === 'ask me') {
            return 'active-ask';
        }
        if (friendStatus === 'busy') {
            return 'active-busy';
        }
        return 'active-state';
    }
    if (state === 'offline' || (location === 'offline' && state !== 'online')) {
        return 'offline';
    }
    if (rawStatus === 'active') {
        return 'online';
    }
    if (rawStatus === 'join me') {
        return 'join me';
    }
    if (rawStatus === 'ask me') {
        return 'ask me';
    }
    if (rawStatus === 'busy') {
        return 'busy';
    }
    return '';
}

function resolveStatusTone(friend: any, currentUser: any) {
    const status = resolveFriendLocationStatus(friend, currentUser);

    if (status === 'join me') {
        return {
            dotClassName: 'bg-[var(--status-joinme)]'
        };
    }

    if (status === 'ask me') {
        return {
            dotClassName: 'bg-[var(--status-askme)]'
        };
    }

    if (status === 'busy') {
        return {
            dotClassName: 'bg-[var(--status-busy)]'
        };
    }

    if (status === 'online') {
        return {
            dotClassName: 'bg-[var(--status-online)]'
        };
    }

    if (
        status === 'active-state' ||
        status === 'active-join' ||
        status === 'active-ask' ||
        status === 'active-busy'
    ) {
        const colorClassName =
            status === 'active-join'
                ? 'border-[var(--status-joinme)]'
                : status === 'active-ask'
                  ? 'border-[var(--status-askme)]'
                  : status === 'active-busy'
                    ? 'border-[var(--status-busy)]'
                    : 'border-[var(--status-online)]';
        return {
            dotClassName: cn('bg-background', colorClassName)
        };
    }

    return {
        dotClassName:
            status === 'offline' ? 'bg-[var(--status-offline)]' : 'hidden'
    };
}

const DEFAULT_CARD_DENSITY_CONFIG: any = {
    value: 'compact',
    layout: 'card',
    avatarSize: 36,
    dotSize: 15,
    titleFontSize: 14,
    cardPadding: 8,
    cardGap: 8,
    cardInnerGap: 5,
    locationLineClamp: 1,
    statusLineClamp: 1,
    showStatusDescription: true
};

function resolveLineClampClass(lineClamp: any) {
    return lineClamp > 1 ? 'line-clamp-2' : 'line-clamp-1';
}

export function FriendLocationCard({
    friend,
    locationLabel = '',
    groupHint = '',
    rawLocation = '',
    densityConfig = DEFAULT_CARD_DENSITY_CONFIG,
    contentMode = 'full',
    displayInstanceInfo = true,
    isTraveling = false,
    travelingLocation = '',
    canUseFriendLocation = false,
    canSendInvite = false,
    canRequestInvite = false,
    canBoop = false,
    onOpenUser,
    onOpenWorld,
    onLaunchLocation,
    onSelfInviteLocation,
    onSendInvite,
    onRequestInvite,
    onSendBoop,
    worldActionLabel
}: any) {
    const { t } = useTranslation();

    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const avatarUrl = userImage(friend, true);
    const tone = resolveStatusTone(friend, currentUserSnapshot);
    const canOpenUser = typeof onOpenUser === 'function';
    const canOpenWorld = typeof onOpenWorld === 'function';
    const cardLocation = resolveCardLocation(rawLocation, friend);
    const source = readFriendRef(friend);
    const hasRef = hasFriendRef(friend);
    const sourceState = normalizeStatusText(
        source?.stateBucket || source?.state
    );
    const rawSourceLocation = resolveRawCardLocation(rawLocation, friend);
    const sourceLocation = isStaleOfflineLocationForLiveState(
        rawSourceLocation,
        sourceState
    )
        ? ''
        : rawSourceLocation;
    const sourceTravelingLocation =
        normalizeLocationValue(
            source?.travelingToLocation || source?.$travelingToLocation
        ) ||
        (hasRef ? '' : normalizeLocationValue(travelingLocation)) ||
        '';
    const isCardTraveling =
        normalizeLocationStatus(sourceLocation) === 'traveling' ||
        (!hasRef && Boolean(isTraveling));
    const locationValue = isCardTraveling ? 'traveling' : cardLocation;
    const travelingValue = isCardTraveling
        ? sourceTravelingLocation || undefined
        : undefined;
    const resolvedDensityConfig = densityConfig || DEFAULT_CARD_DENSITY_CONFIG;
    const isDense = resolvedDensityConfig.layout === 'item';
    const resolvedWorldActionLabel =
        worldActionLabel || t('view.friend_list.label.world');
    const locationLineClampClass = resolveLineClampClass(
        resolvedDensityConfig.locationLineClamp
    );
    const statusLineClampClass = resolveLineClampClass(
        resolvedDensityConfig.statusLineClamp
    );
    const showStatusDot = !tone.dotClassName.includes('hidden');
    const showLocationInfo =
        contentMode === 'full' &&
        displayInstanceInfo &&
        (Boolean(locationValue) ||
            (Boolean(locationLabel) &&
                normalizeStatusText(locationLabel) !== 'offline'));
    const showStatusDescription =
        contentMode !== 'identity' &&
        resolvedDensityConfig.showStatusDescription;
    const hoverUserId = source?.id || friend?.id;
    const avatarNode = (
        <UserHoverCard userId={hoverUserId} seed={source}>
            <Avatar className="size-[var(--friend-card-avatar-size)]">
                {avatarUrl ? (
                    <AvatarImage
                        src={avatarUrl}
                        alt={
                            friend?.displayName ||
                            friend?.id ||
                            t(
                                'component.friend_location_card.label.friend_avatar'
                            )
                        }
                        loading="lazy"
                    />
                ) : null}
                <AvatarFallback>
                    <UserIcon aria-hidden="true" />
                </AvatarFallback>
                {showStatusDot ? (
                    <UserStatusDot
                        statusDotClassName={tone.dotClassName}
                        className="absolute -right-0.5 -bottom-0.5 z-10 size-[var(--friend-card-dot-size)]"
                    />
                ) : null}
            </Avatar>
        </UserHoverCard>
    );
    const locationNode = locationValue ? (
        <Location
            location={locationValue}
            traveling={travelingValue}
            hint={locationLabel}
            grouphint={groupHint}
            link={canOpenWorld}
            stopPropagation
            asButton={false}
            className="text-xs leading-4"
        />
    ) : (
        locationLabel
    );
    const titleNode = (
        <UserHoverCard userId={hoverUserId} seed={source}>
            <CardTitle
                className={cn(
                    'w-fit max-w-full truncate text-[length:var(--friend-card-title-font-size)]',
                    isDense && 'leading-5'
                )}
            >
                {friend?.displayName || ''}
            </CardTitle>
        </UserHoverCard>
    );
    const statusDescriptionNode = showStatusDescription ? (
        <CardDescription className="text-muted-foreground/70 flex min-w-0 items-start gap-2">
            {friend?.statusDescription ? (
                <PencilIcon className="mt-0.5 size-4 shrink-0" />
            ) : null}
            <span
                className={cn(
                    'min-w-0 text-xs leading-5 break-words',
                    statusLineClampClass
                )}
            >
                {friend?.statusDescription || '\u00a0'}
            </span>
        </CardDescription>
    ) : null;
    const cardActions = (
        <div
            className="pointer-events-none absolute top-[var(--friend-card-padding)] right-[var(--friend-card-padding)] z-20 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 ease-out group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100 motion-reduce:transition-none"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
        >
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={
                        <Button
                            type="button"
                            size="icon-xs"
                            variant="secondary"
                            aria-label={t('accessibility.more')}
                        >
                            <MoreHorizontalIcon />
                        </Button>
                    }
                />
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            disabled={!canOpenUser}
                            onClick={onOpenUser}
                        >
                            <UserIcon />
                            {t('table.playerList.user')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!canOpenWorld}
                            onClick={onOpenWorld}
                        >
                            <GlobeIcon />
                            {resolvedWorldActionLabel}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            disabled={!canUseFriendLocation}
                            onClick={() => onLaunchLocation?.()}
                        >
                            <ExternalLinkIcon />
                            {t('dialog.launch.open_ingame')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!canUseFriendLocation}
                            onClick={() => onSelfInviteLocation?.()}
                        >
                            <ExternalLinkIcon />
                            {t('dialog.launch.self_invite')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            disabled={!canSendInvite}
                            onClick={() => onSendInvite?.()}
                        >
                            {t('dialog.user.actions.invite')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!canRequestInvite}
                            onClick={() => onRequestInvite?.()}
                        >
                            {t('dialog.user.actions.request_invite')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!canBoop}
                            onClick={() => onSendBoop?.()}
                        >
                            {t('dialog.user.actions.send_boop')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );

    return (
        <ContextMenu>
            <ContextMenuTrigger
                render={
                    <Card
                        size="sm"
                        className={cn(
                            'border-border/45 hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-ring/50 relative h-full overflow-hidden bg-transparent backdrop-blur transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out outline-none focus-visible:ring-3 active:scale-[0.985] motion-reduce:transform-none motion-reduce:transition-colors',
                            canOpenUser && 'cursor-pointer',
                            isDense
                                ? 'flex-row items-center gap-[calc(var(--friend-card-gap)+2px)] rounded-lg p-[var(--friend-card-padding)]'
                                : 'gap-[var(--friend-card-gap)] py-[var(--friend-card-padding)]'
                        )}
                        onClick={onOpenUser}
                        onKeyDown={(event) => {
                            if (
                                event.target === event.currentTarget &&
                                (event.key === 'Enter' || event.key === ' ')
                            ) {
                                event.preventDefault();
                                onOpenUser?.();
                            }
                        }}
                        role={canOpenUser ? 'button' : undefined}
                        tabIndex={canOpenUser ? 0 : undefined}
                        aria-label={
                            canOpenUser
                                ? `${t('common.actions.view_details')}: ${friend?.displayName || ''}`
                                : undefined
                        }
                        style={{
                            '--friend-card-padding': `${resolvedDensityConfig.cardPadding}px`,
                            '--friend-card-gap': `${resolvedDensityConfig.cardGap}px`,
                            '--friend-card-inner-gap': `${resolvedDensityConfig.cardInnerGap}px`,
                            '--friend-card-avatar-size': `${resolvedDensityConfig.avatarSize}px`,
                            '--friend-card-dot-size': `${resolvedDensityConfig.dotSize}px`,
                            '--friend-card-title-font-size': `${resolvedDensityConfig.titleFontSize}px`
                        }}
                    >
                        {cardActions}
                        {isDense ? (
                            <>
                                <CardHeader className="flex shrink-0 p-0">
                                    {avatarNode}
                                </CardHeader>
                                <CardContent className="flex min-w-0 flex-1 flex-col gap-0.5 px-0 transition-[padding] duration-150 group-focus-within/card:pr-8 group-hover/card:pr-8 motion-reduce:transition-none">
                                    {titleNode}
                                    {showLocationInfo ? (
                                        <div
                                            className="text-muted-foreground min-w-0 text-left text-xs leading-4"
                                            onClick={(event) =>
                                                event.stopPropagation()
                                            }
                                        >
                                            <span
                                                className={cn(
                                                    'min-w-0 break-words',
                                                    locationLineClampClass
                                                )}
                                            >
                                                {locationNode}
                                            </span>
                                        </div>
                                    ) : null}
                                    {statusDescriptionNode}
                                </CardContent>
                            </>
                        ) : (
                            <>
                                <CardHeader
                                    className={cn(
                                        'flex flex-row gap-[var(--friend-card-gap)] px-[var(--friend-card-padding)]',
                                        !showLocationInfo &&
                                            !showStatusDescription &&
                                            'items-center'
                                    )}
                                >
                                    {avatarNode}
                                    <div className="flex min-w-0 flex-1 flex-col gap-1 transition-[padding] duration-150 group-focus-within/card:pr-8 group-hover/card:pr-8 motion-reduce:transition-none">
                                        {titleNode}
                                    </div>
                                </CardHeader>

                                {showLocationInfo || statusDescriptionNode ? (
                                    <CardContent className="flex min-h-0 flex-1 flex-col gap-[var(--friend-card-inner-gap)] overflow-hidden px-[var(--friend-card-padding)]">
                                        {showLocationInfo ? (
                                            <div
                                                className="text-muted-foreground w-full min-w-0 text-left text-xs leading-4"
                                                onClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                            >
                                                <span
                                                    className={cn(
                                                        'text-foreground min-w-0 break-words',
                                                        locationLineClampClass
                                                    )}
                                                >
                                                    {locationNode}
                                                </span>
                                            </div>
                                        ) : null}

                                        {statusDescriptionNode}
                                    </CardContent>
                                ) : null}
                            </>
                        )}
                    </Card>
                }
            />
            <ContextMenuContent className="w-56">
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canOpenUser}
                        onClick={onOpenUser}
                    >
                        <UserIcon />
                        {t('table.playerList.user')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canOpenWorld}
                        onClick={onOpenWorld}
                    >
                        <GlobeIcon />
                        {resolvedWorldActionLabel}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canUseFriendLocation}
                        onClick={() => {
                            onLaunchLocation?.();
                        }}
                    >
                        <ExternalLinkIcon />
                        {t('dialog.launch.open_ingame')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canUseFriendLocation}
                        onClick={() => {
                            onSelfInviteLocation?.();
                        }}
                    >
                        <ExternalLinkIcon />
                        {t('dialog.launch.self_invite')}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canSendInvite}
                        onClick={() => {
                            onSendInvite?.();
                        }}
                    >
                        {t('dialog.user.actions.invite')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canRequestInvite}
                        onClick={() => {
                            onRequestInvite?.();
                        }}
                    >
                        {t('dialog.user.actions.request_invite')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canBoop}
                        onClick={() => {
                            onSendBoop?.();
                        }}
                    >
                        {t('dialog.user.actions.send_boop')}
                    </ContextMenuItem>
                </ContextMenuGroup>
            </ContextMenuContent>
        </ContextMenu>
    );
}
