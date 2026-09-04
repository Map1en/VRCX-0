import {
    ExternalLinkIcon,
    GlobeIcon,
    MoreHorizontalIcon,
    UserIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FriendInstanceTimer } from '@/components/friends/FriendInstanceTimer';
import { LaunchModeContextMenuGroup } from '@/components/launch/LaunchModeContextMenuGroup';
import { Location } from '@/components/Location';
import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { UserStatusDot } from '@/components/UserStatusDot';
import type { FriendRecord } from '@/domain/friends/types';
import { useFriendLocationTimeEpoch } from '@/lib/useFriendLocationTimeEpoch';
import { cn } from '@/lib/utils';
import type { FriendLocationTimeSource } from '@/platform/tauri/bindings';
import { userImage } from '@/services/entityMediaService';
import {
    normalizeUserStatus,
    SOLID_USER_STATUS_DOT_CLASS_NAMES,
    USER_STATUS_INDICATOR_CLASS_NAMES
} from '@/shared/utils/friendStatus';
import { normalizeLocationValue, parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { useRuntimeStore } from '@/state/runtimeStore';
import type { CurrentUserSnapshotState } from '@/state/runtimeStore';
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

import type { FriendLocationRecord } from '../friends-locations-rows/types';
import type {
    FriendsLocationsCardContentMode,
    getFriendsLocationsDensityConfig
} from '../friendsLocationsDensity';

type FriendLocationCardSource = Pick<
    FriendLocationRecord,
    | 'id'
    | 'userId'
    | 'location'
    | 'state'
    | 'stateBucket'
    | 'status'
    | 'travelingToLocation'
    | '$travelingToLocation'
> & { pendingOffline?: boolean };

export type FriendLocationCardFriend = FriendRecord & {
    ref?: FriendLocationCardSource | null;
    pendingOffline?: boolean;
    travelingToLocation?: string | null;
};

export type FriendLocationCardDensity = Pick<
    ReturnType<typeof getFriendsLocationsDensityConfig>,
    | 'value'
    | 'layout'
    | 'avatarSize'
    | 'dotSize'
    | 'titleFontSize'
    | 'cardPadding'
    | 'cardGap'
    | 'cardInnerGap'
    | 'locationLineClamp'
    | 'statusLineClamp'
    | 'showStatusDescription'
>;

function normalizeStatusText(value: unknown) {
    const status = normalizeUserStatus(value);
    if (status === 'private:private') {
        return 'private';
    }
    if (status === 'traveling:traveling') {
        return 'traveling';
    }
    return status;
}

function readFriendRef(friend: FriendLocationCardFriend) {
    return friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
}

function hasFriendRef(friend: FriendLocationCardFriend) {
    return Boolean(friend?.ref && typeof friend.ref === 'object');
}

function isLiveBucketState(value: unknown) {
    const state = normalizeStatusText(value);
    return state === 'online' || state === 'active';
}

function isStaleOfflineLocationForLiveState(location: unknown, state: unknown) {
    return (
        isLiveBucketState(state) &&
        normalizeLocationStatus(location) === 'offline'
    );
}

function resolveRawCardLocation(
    rawLocation: unknown,
    friend: FriendLocationCardFriend
) {
    const source = readFriendRef(friend);
    return (
        normalizeLocationValue(source?.location) ||
        (hasFriendRef(friend) ? '' : normalizeLocationValue(rawLocation)) ||
        ''
    );
}

function resolveCardLocation(
    rawLocation: unknown,
    friend: FriendLocationCardFriend
) {
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

function normalizeLocationStatus(value: unknown) {
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

function resolveFriendLocationStatus(
    friend: FriendLocationCardFriend,
    currentUser: CurrentUserSnapshotState | null
) {
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

function resolveStatusTone(
    friend: FriendLocationCardFriend,
    currentUser: CurrentUserSnapshotState | null
) {
    const status = resolveFriendLocationStatus(friend, currentUser);

    if (status === 'join me') {
        return {
            dotClassName: SOLID_USER_STATUS_DOT_CLASS_NAMES['join me']
        };
    }

    if (status === 'ask me') {
        return {
            dotClassName: SOLID_USER_STATUS_DOT_CLASS_NAMES['ask me']
        };
    }

    if (status === 'busy') {
        return {
            dotClassName: SOLID_USER_STATUS_DOT_CLASS_NAMES.busy
        };
    }

    if (status === 'online') {
        return {
            dotClassName: SOLID_USER_STATUS_DOT_CLASS_NAMES.active
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
        let statusClassName = USER_STATUS_INDICATOR_CLASS_NAMES.active;
        if (status === 'active-join') {
            statusClassName = USER_STATUS_INDICATOR_CLASS_NAMES['join me'];
        } else if (status === 'active-ask') {
            statusClassName = USER_STATUS_INDICATOR_CLASS_NAMES['ask me'];
        } else if (status === 'active-busy') {
            statusClassName = USER_STATUS_INDICATOR_CLASS_NAMES.busy;
        }
        return {
            dotClassName: cn(statusClassName, 'bg-background', colorClassName)
        };
    }

    return {
        dotClassName:
            status === 'offline'
                ? SOLID_USER_STATUS_DOT_CLASS_NAMES.offline
                : 'hidden'
    };
}

const DEFAULT_CARD_DENSITY_CONFIG: FriendLocationCardDensity = {
    value: 'compact',
    layout: 'card',
    avatarSize: 36,
    dotSize: 15,
    titleFontSize: 14,
    cardPadding: 8,
    cardGap: 6,
    cardInnerGap: 4,
    locationLineClamp: 1,
    statusLineClamp: 1,
    showStatusDescription: true
};

function resolveLineClampClass(lineClamp: number) {
    return lineClamp > 1 ? 'line-clamp-2' : 'line-clamp-1';
}

export interface FriendLocationCardLocationModel {
    source?: FriendLocationTimeSource;
    label?: string;
    groupHint?: string;
    raw?: string | null;
    traveling?: boolean;
    travelingTo?: string | null;
    timerLocation?: string | null;
}

export interface FriendLocationCardPresentation {
    density?: FriendLocationCardDensity;
    contentMode?: FriendsLocationsCardContentMode;
    displayInstanceInfo?: boolean;
}

export interface FriendLocationCardCapabilities {
    useLocation?: boolean;
    sendInvite?: boolean;
    requestInvite?: boolean;
    boop?: boolean;
}

export interface FriendLocationCardActions {
    openUser?: () => void;
    openWorld?: () => void;
    launchLocation?: () => void;
    selfInviteLocation?: () => void;
    sendInvite?: () => void;
    requestInvite?: () => void;
    sendBoop?: () => void;
}

export interface FriendLocationCardProps {
    friend: FriendLocationCardFriend;
    location?: FriendLocationCardLocationModel;
    presentation?: FriendLocationCardPresentation;
    capabilities?: FriendLocationCardCapabilities;
    actions?: FriendLocationCardActions;
    worldActionLabel?: string;
}

export function FriendLocationCard({
    friend,
    location = {},
    presentation = {},
    capabilities = {},
    actions = {},
    worldActionLabel
}: FriendLocationCardProps) {
    const { t } = useTranslation();
    const {
        label: locationLabel = '',
        groupHint = '',
        raw: rawLocation = '',
        traveling: isTraveling = false,
        travelingTo: travelingLocation = '',
        timerLocation = ''
    } = location;
    const {
        density: densityConfig = DEFAULT_CARD_DENSITY_CONFIG,
        contentMode = 'full',
        displayInstanceInfo = true
    } = presentation;
    const {
        useLocation: canUseFriendLocation = false,
        sendInvite: canSendInvite = false,
        requestInvite: canRequestInvite = false,
        boop: canBoop = false
    } = capabilities;
    const {
        openUser: onOpenUser,
        openWorld: onOpenWorld,
        launchLocation: onLaunchLocation,
        selfInviteLocation: onSelfInviteLocation,
        sendInvite: onSendInvite,
        requestInvite: onRequestInvite,
        sendBoop: onSendBoop
    } = actions;

    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const avatarUrl = userImage(friend, true);
    const tone = resolveStatusTone(friend, currentUserSnapshot);
    const canOpenUser = typeof onOpenUser === 'function';
    const canOpenWorld = typeof onOpenWorld === 'function';
    const localLocation =
        location.source === 'gameLog'
            ? normalizeLocationValue(rawLocation)
            : '';
    const cardLocation =
        localLocation || resolveCardLocation(rawLocation, friend);
    const source = readFriendRef(friend);
    const hasRef = hasFriendRef(friend);
    const sourceState = normalizeStatusText(
        source?.stateBucket || source?.state
    );
    const rawSourceLocation =
        localLocation || resolveRawCardLocation(rawLocation, friend);
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
    const launchLocation = normalizeLocationValue(rawLocation);
    const launchShortName = parseLocation(launchLocation).shortName || '';
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
        resolvedDensityConfig.showStatusDescription &&
        Boolean(friend.statusDescription);
    const hoverUserId = normalizeString(source?.id || friend?.id);
    const instanceEpoch = useFriendLocationTimeEpoch(
        hoverUserId,
        timerLocation || ''
    );
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
        <div
            className={cn(
                'flex min-w-0',
                isDense ? 'items-center gap-2' : 'flex-col items-start'
            )}
        >
            <UserHoverCard userId={hoverUserId} seed={source}>
                <CardTitle
                    className={cn(
                        'min-w-0 truncate text-[length:var(--friend-card-title-font-size)]',
                        isDense ? 'flex-1 leading-5' : 'w-full'
                    )}
                >
                    {friend?.displayName || ''}
                </CardTitle>
            </UserHoverCard>
            {instanceEpoch ? (
                <span className="text-muted-foreground shrink-0 text-xs leading-4 font-normal tabular-nums">
                    <FriendInstanceTimer
                        epoch={instanceEpoch}
                        traveling={false}
                        format={isDense ? 'short' : 'default'}
                    />
                </span>
            ) : null}
        </div>
    );
    const statusDescriptionNode = showStatusDescription ? (
        <CardDescription className="min-w-0">
            <span
                className={cn(
                    'min-w-0 text-xs leading-5 break-words',
                    statusLineClampClass
                )}
            >
                {friend.statusDescription}
            </span>
        </CardDescription>
    ) : null;
    const cardActions = (
        <div
            role="presentation"
            className="pointer-events-none absolute top-[var(--friend-card-padding)] right-[var(--friend-card-padding)] z-20 flex items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-fast) ease-(--ease-out-ui) group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100 motion-reduce:transition-none"
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
                            'bg-object-surface ring-border hover:bg-object-surface-hover focus-visible:ring-ring/50 relative h-full rounded-lg transition-colors duration-(--motion-fast) ease-(--ease-out-ui) outline-none focus-visible:ring-3 motion-reduce:transition-none',
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
                                <CardHeader className="flex w-[var(--friend-card-avatar-size)] shrink-0 p-0">
                                    {avatarNode}
                                </CardHeader>
                                <CardContent className="flex min-w-0 flex-1 flex-col gap-0.5 px-0 group-focus-within/card:pr-8 group-hover/card:pr-8">
                                    {titleNode}
                                    {showLocationInfo ? (
                                        <div
                                            role="presentation"
                                            className="text-muted-foreground min-w-0 text-left text-xs leading-4"
                                            onClick={(event) =>
                                                event.stopPropagation()
                                            }
                                            onKeyDown={(event) =>
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
                                <CardHeader className="flex flex-row items-center gap-[var(--friend-card-gap)] px-[var(--friend-card-padding)]">
                                    {avatarNode}
                                    <div className="flex min-w-0 flex-1 flex-col gap-1 group-focus-within/card:pr-8 group-hover/card:pr-8">
                                        {titleNode}
                                    </div>
                                </CardHeader>

                                {showLocationInfo || statusDescriptionNode ? (
                                    <CardContent className="flex min-h-0 flex-1 flex-col gap-[var(--friend-card-inner-gap)] overflow-hidden px-[var(--friend-card-padding)]">
                                        {showLocationInfo ? (
                                            <div
                                                role="presentation"
                                                className="text-muted-foreground w-full min-w-0 text-left text-xs leading-4"
                                                onClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                                onKeyDown={(event) =>
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
                <LaunchModeContextMenuGroup
                    disabled={!canUseFriendLocation}
                    errorMessage={t(
                        'view.friends.toast.failed_to_launch_instance'
                    )}
                    location={launchLocation}
                    shortName={launchShortName}
                />
                <ContextMenuSeparator />
                <ContextMenuGroup>
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
