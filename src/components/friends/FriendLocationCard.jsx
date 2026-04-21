import {
    ExternalLinkIcon,
    GlobeIcon,
    PencilIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { Location } from '@/components/Location.jsx';
import { copyTextToClipboard, userImage } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import {
    normalizeLocationValue,
    parseLocation
} from '@/shared/utils/location.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Card, CardContent } from '@/ui/shadcn/card';
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
            dotClassName:
                'bg-[var(--status-joinme)] shadow-[0_0_8px_var(--status-joinme)]',
            label: 'Join Me'
        };
    }

    if (status === 'ask me') {
        return {
            dotClassName:
                'bg-[var(--status-askme)] shadow-[0_0_8px_var(--status-askme)]',
            label: 'Ask Me'
        };
    }

    if (status === 'busy') {
        return {
            dotClassName:
                'bg-[var(--status-busy)] shadow-[0_0_8px_var(--status-busy)]',
            label: 'Busy'
        };
    }

    if (status === 'online') {
        return {
            dotClassName:
                'bg-[var(--status-online)] shadow-[0_0_8px_var(--status-online)]',
            label: 'Online'
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
                ? 'border-[var(--status-joinme)] shadow-[0_0_8px_var(--status-joinme)]'
                : status === 'active-ask'
                  ? 'border-[var(--status-askme)] shadow-[0_0_8px_var(--status-askme)]'
                  : status === 'active-busy'
                    ? 'border-[var(--status-busy)] shadow-[0_0_8px_var(--status-busy)]'
                    : 'border-[var(--status-online)] shadow-[0_0_8px_var(--status-online)]';
        return {
            dotClassName: cn('border-2 bg-transparent', colorClassName),
            label: 'Active'
        };
    }

    return {
        dotClassName:
            status === 'offline' ? 'bg-[var(--status-offline-card)]' : 'hidden',
        label: 'Offline'
    };
}

export function FriendLocationCard({
    friend,
    locationLabel = '',
    groupHint = '',
    rawLocation = '',
    cardScale = 1,
    spacingScale = 1,
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
    worldActionLabel = 'World',
    groupActionLabel = 'Group'
}) {
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

    async function copyCardText(value, label) {
        const text = String(value || '').trim();
        if (!text) {
            return;
        }
        await copyTextToClipboard(text);
        toast.success(`${label} copied.`);
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <Card
                    className="border-border/70 bg-card/80 hover:bg-muted/40 h-full cursor-pointer overflow-hidden backdrop-blur"
                    onClick={onOpenUser}
                    style={{
                        padding: `${12 * spacingScale}px`
                    }}
                >
                    <CardContent className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-0">
                        <div className="flex items-start gap-3">
                            <div className="relative shrink-0">
                                {avatarUrl ? (
                                    <img
                                        src={avatarUrl}
                                        alt={
                                            friend?.displayName ||
                                            friend?.id ||
                                            'Friend avatar'
                                        }
                                        loading="lazy"
                                        className="rounded-2xl object-cover"
                                        style={{
                                            width: `${52 * cardScale}px`,
                                            height: `${52 * cardScale}px`
                                        }}
                                    />
                                ) : (
                                    <div
                                        className="bg-muted text-muted-foreground flex items-center justify-center rounded-2xl"
                                        style={{
                                            width: `${52 * cardScale}px`,
                                            height: `${52 * cardScale}px`
                                        }}
                                    >
                                        <span className="text-sm font-semibold">
                                            {getInitials(
                                                friend?.displayName ||
                                                    friend?.id
                                            )}
                                        </span>
                                    </div>
                                )}
                                <span
                                    className={cn(
                                        'border-background absolute right-0 bottom-0 z-10 block rounded-full border-2',
                                        tone.dotClassName
                                    )}
                                    style={{
                                        width: `${12 * cardScale}px`,
                                        height: `${12 * cardScale}px`
                                    }}
                                />
                            </div>

                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <div
                                    className="truncate font-semibold"
                                    style={{ fontSize: `${16 * cardScale}px` }}
                                >
                                    {friend?.displayName || ''}
                                </div>
                            </div>
                        </div>

                        <div className="flex min-h-0 flex-col gap-2 overflow-hidden text-sm">
                            {displayInstanceInfo ? (
                                <div
                                    className="text-muted-foreground w-full min-w-0 text-left"
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <span className="text-foreground line-clamp-2 min-w-0 break-words">
                                        {locationValue ? (
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
                                            locationLabel || 'Offline'
                                        )}
                                    </span>
                                </div>
                            ) : null}

                            <div className="text-muted-foreground flex items-start gap-2">
                                {friend?.statusDescription ? (
                                    <PencilIcon className="mt-0.5 size-4 shrink-0" />
                                ) : null}
                                <div className="text-muted-foreground line-clamp-2 min-w-0 text-xs leading-5 break-words">
                                    {friend?.statusDescription || '\u00a0'}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canOpenUser}
                        onSelect={onOpenUser}
                    >
                        <UserIcon />
                        User
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canOpenWorld}
                        onSelect={onOpenWorld}
                    >
                        <GlobeIcon />
                        {worldActionLabel}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canOpenGroup}
                        onSelect={onOpenGroup}
                    >
                        <UsersIcon />
                        {groupActionLabel}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canUseFriendLocation}
                        onSelect={() => void onLaunchLocation?.()}
                    >
                        <ExternalLinkIcon />
                        Launch in VRChat
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canUseFriendLocation}
                        onSelect={() => void onSelfInviteLocation?.()}
                    >
                        <ExternalLinkIcon />
                        Self invite
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canSendInvite}
                        onSelect={() => void onSendInvite?.()}
                    >
                        Send invite
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canRequestInvite}
                        onSelect={() => void onRequestInvite?.()}
                    >
                        Request invite
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canBoop}
                        onSelect={() => void onSendBoop?.()}
                    >
                        Send boop
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!friend?.id}
                        onSelect={() =>
                            void copyCardText(friend?.id, 'User ID')
                        }
                    >
                        Copy user ID
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!rawLocation}
                        onSelect={() =>
                            void copyCardText(rawLocation, 'Location')
                        }
                    >
                        Copy location
                    </ContextMenuItem>
                </ContextMenuGroup>
            </ContextMenuContent>
        </ContextMenu>
    );
}
