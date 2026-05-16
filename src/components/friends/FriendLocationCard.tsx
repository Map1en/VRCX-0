// @ts-nocheck
import {
    ExternalLinkIcon,
    GlobeIcon,
    PencilIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import { userImage } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import {
    normalizeLocationValue,
    parseLocation
} from '@/shared/utils/location.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
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

function getInitials(value) {
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

function normalizeStatusText(value) {
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

function readFriendRef(friend) {
    return friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
}

function hasFriendRef(friend) {
    return Boolean(friend?.ref && typeof friend.ref === 'object');
}

function isLiveBucketState(value) {
    const state = normalizeStatusText(value);
    return state === 'online' || state === 'active';
}

function isStaleOfflineLocationForLiveState(location, state) {
    return (
        isLiveBucketState(state) &&
        normalizeLocationStatus(location) === 'offline'
    );
}

function resolveRawCardLocation(rawLocation, friend) {
    const source = readFriendRef(friend);
    return (
        normalizeLocationValue(source?.location) ||
        (hasFriendRef(friend) ? '' : normalizeLocationValue(rawLocation)) ||
        ''
    );
}

function resolveCardLocation(rawLocation, friend) {
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

function normalizeLocationStatus(value) {
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

function resolveFriendLocationStatus(friend, currentUser) {
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

function resolveStatusTone(friend, currentUser) {
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
            dotClassName: cn('bg-background', colorClassName),
            activeDot: true
        };
    }

    return {
        dotClassName:
            status === 'offline' ? 'bg-[var(--status-offline)]' : 'hidden'
    };
}

const DEFAULT_CARD_DENSITY_CONFIG = {
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

function resolveLineClampClass(lineClamp) {
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
    onOpenGroup,
    onLaunchLocation,
    onSelfInviteLocation,
    onSendInvite,
    onRequestInvite,
    onSendBoop,
    worldActionLabel,
    groupActionLabel
}) {
    const { t } = useTranslation();

    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const avatarUrl = userImage(friend, true);
    const tone = resolveStatusTone(friend, currentUserSnapshot);
    const canOpenUser = typeof onOpenUser === 'function';
    const canOpenWorld = typeof onOpenWorld === 'function';
    const canOpenGroup = typeof onOpenGroup === 'function';
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
    const resolvedGroupActionLabel =
        groupActionLabel || t('view.friend_list.label.group');
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
    const avatarNode = (
        <div className="relative shrink-0">
            {avatarUrl ? (
                <img
                    src={avatarUrl}
                    alt={
                        friend?.displayName ||
                        friend?.id ||
                        t('component.friend_location_card.label.friend_avatar')
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
                <span className="border-background bg-background absolute -right-0.5 -bottom-0.5 z-10 block size-3.75 rounded-full border-3">
                    {tone.activeDot ? (
                        <span
                            className={cn(
                                'absolute inset-0 rounded-full border-2',
                                tone.dotClassName
                            )}
                        />
                    ) : (
                        <span
                            className={cn(
                                'absolute inset-0 rounded-full',
                                tone.dotClassName
                            )}
                        />
                    )}
                </span>
            ) : null}
        </div>
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
        />
    ) : (
        locationLabel
    );

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <Card
                    size="sm"
                    className={cn(
                        'border-border/70 bg-card/80 hover:bg-muted/40 h-full cursor-pointer overflow-hidden backdrop-blur',
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
                                <CardTitle
                                    className="truncate leading-5"
                                    style={{
                                        fontSize: `${resolvedDensityConfig.titleFontSize}px`
                                    }}
                                >
                                    {friend?.displayName || ''}
                                </CardTitle>
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
                                    <CardTitle
                                        className="truncate"
                                        style={{
                                            fontSize: `${resolvedDensityConfig.titleFontSize}px`
                                        }}
                                    >
                                        {friend?.displayName || ''}
                                    </CardTitle>
                                </div>
                            </CardHeader>

                            <CardContent className="flex min-h-0 flex-1 flex-col gap-[var(--friend-card-inner-gap)] overflow-hidden px-[var(--friend-card-padding)]">
                                {showLocationInfo ? (
                                    <div
                                        className="text-muted-foreground w-full min-w-0 text-left"
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
                                    <CardDescription className="flex items-start gap-2">
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
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canOpenUser}
                        onSelect={onOpenUser}
                    >
                        <UserIcon />
                        {t('table.playerList.user')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canOpenWorld}
                        onSelect={onOpenWorld}
                    >
                        <GlobeIcon />
                        {resolvedWorldActionLabel}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canOpenGroup}
                        onSelect={onOpenGroup}
                    >
                        <UsersIcon />
                        {resolvedGroupActionLabel}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canUseFriendLocation}
                        onSelect={() => void onLaunchLocation?.()}
                    >
                        <ExternalLinkIcon />
                        {t('dialog.launch.open_ingame')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canUseFriendLocation}
                        onSelect={() => void onSelfInviteLocation?.()}
                    >
                        <ExternalLinkIcon />
                        {t('dialog.launch.self_invite')}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canSendInvite}
                        onSelect={() => void onSendInvite?.()}
                    >
                        {t('dialog.user.actions.invite')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canRequestInvite}
                        onSelect={() => void onRequestInvite?.()}
                    >
                        {t('dialog.user.actions.request_invite')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canBoop}
                        onSelect={() => void onSendBoop?.()}
                    >
                        {t('dialog.user.actions.send_boop')}
                    </ContextMenuItem>
                </ContextMenuGroup>
            </ContextMenuContent>
        </ContextMenu>
    );
}
