import {
    ExternalLinkIcon,
    GlobeIcon,
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

function getInitials(value: any) {
    const source = String(value || '').trim();
    if (!source) {
        return '??';
    }

    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
    }

    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

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
    dotSize: 10,
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
        displayInstanceInfo &&
        (Boolean(locationValue) ||
            (Boolean(locationLabel) &&
                normalizeStatusText(locationLabel) !== 'offline'));
    const hoverUserId = source?.id || friend?.id;
    const avatarNode = (
        <UserHoverCard userId={hoverUserId} seed={source}>
            <div className="relative shrink-0">
                {avatarUrl ? (
                    <img
                        src={avatarUrl}
                        alt={
                            friend?.displayName ||
                            friend?.id ||
                            t(
                                'component.friend_location_card.label.friend_avatar'
                            )
                        }
                        loading="lazy"
                        className="rounded-full object-cover"
                        style={{
                            width: `${resolvedDensityConfig.avatarSize}px`,
                            height: `${resolvedDensityConfig.avatarSize}px`
                        }}
                    />
                ) : (
                    <div
                        className="bg-muted text-muted-foreground flex items-center justify-center rounded-full"
                        style={{
                            width: `${resolvedDensityConfig.avatarSize}px`,
                            height: `${resolvedDensityConfig.avatarSize}px`
                        }}
                    >
                        <span className="text-sm font-semibold">
                            {getInitials(friend?.displayName || friend?.id)}
                        </span>
                    </div>
                )}
                {showStatusDot ? (
                    <UserStatusDot
                        statusDotClassName={tone.dotClassName}
                        className="absolute -right-0.5 -bottom-0.5 z-10 size-3.75"
                    />
                ) : null}
            </div>
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
                    'w-fit max-w-full truncate',
                    isDense && 'leading-5'
                )}
                style={{
                    fontSize: `${resolvedDensityConfig.titleFontSize}px`
                }}
            >
                {friend?.displayName || ''}
            </CardTitle>
        </UserHoverCard>
    );

    return (
        <ContextMenu>
            <ContextMenuTrigger
                render={
                    <Card
                        size="sm"
                        className={cn(
                            'border-border/70 bg-card/40 hover:bg-muted/40 h-full cursor-pointer overflow-hidden backdrop-blur',
                            isDense
                                ? 'flex-row items-center gap-[var(--friend-card-gap)] rounded-lg p-[var(--friend-card-padding)]'
                                : 'gap-[var(--friend-card-gap)] py-[var(--friend-card-padding)]'
                        )}
                        onClick={onOpenUser}
                        style={{
                            '--friend-card-padding': `${resolvedDensityConfig.cardPadding}px`,
                            '--friend-card-gap': `${resolvedDensityConfig.cardGap}px`,
                            '--friend-card-inner-gap': `${resolvedDensityConfig.cardInnerGap}px`
                        }}
                    >
                        {isDense ? (
                            <>
                                <CardHeader className="flex shrink-0 p-0">
                                    {avatarNode}
                                </CardHeader>
                                <CardContent className="flex min-w-0 flex-1 flex-col gap-0.5 px-0">
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
                                </CardContent>
                            </>
                        ) : (
                            <>
                                <CardHeader className="flex flex-row gap-[var(--friend-card-gap)] px-[var(--friend-card-padding)]">
                                    {avatarNode}
                                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                                        {titleNode}
                                    </div>
                                </CardHeader>

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

                                    {resolvedDensityConfig.showStatusDescription ? (
                                        <CardDescription className="text-muted-foreground/70 flex items-start gap-2">
                                            {friend?.statusDescription ? (
                                                <PencilIcon className="mt-0.5 size-4 shrink-0" />
                                            ) : null}
                                            <span
                                                className={cn(
                                                    'min-w-0 text-xs leading-5 break-words',
                                                    statusLineClampClass
                                                )}
                                            >
                                                {friend?.statusDescription ||
                                                    '\u00a0'}
                                            </span>
                                        </CardDescription>
                                    ) : null}
                                </CardContent>
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
