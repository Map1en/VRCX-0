import {
    ExternalLinkIcon,
    GlobeIcon,
    MoreHorizontalIcon,
    UserIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FriendInstanceTimer } from '@/components/friends/FriendInstanceTimer';
import { usePendingOfflineBlink } from '@/components/friends/usePendingOfflineBlink';
import { useRecentlyOnline } from '@/components/friends/useRecentlyOnline';
import { LaunchModeContextMenuGroup } from '@/components/launch/LaunchModeContextMenuGroup';
import { Location } from '@/components/Location';
import {
    ProfileAvatarFrame,
    ProfileNameplate,
    useDecorationHover
} from '@/components/ProfileDecorations';
import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { UserStatusDot } from '@/components/UserStatusDot';
import {
    presenceDotClassName,
    presenceLocationTag,
    presenceTravelingTag
} from '@/domain/friends/presence';
import type { FriendRecord } from '@/domain/friends/types';
import { useFriendLocationTimeEpoch } from '@/lib/useFriendLocationTimeEpoch';
import { cn } from '@/lib/utils';
import type { FriendLocationTimeSource } from '@/platform/tauri/bindings';
import { userImage } from '@/services/entityMediaService';
import { normalizeUserStatus } from '@/shared/utils/friendStatus';
import { normalizeLocationValue, parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { HintTooltip } from '@/ui/hint-tooltip';
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

import type {
    FriendsLocationsCardContentMode,
    getFriendsLocationsDensityConfig
} from '../friendsLocationsDensity';

type FriendLocationCardDensity = Pick<
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
    timerLocation?: string | null;
}

interface FriendLocationCardPresentation {
    density?: FriendLocationCardDensity;
    contentMode?: FriendsLocationsCardContentMode;
    displayInstanceInfo?: boolean;
    showAvatarFrame?: boolean;
    showNameplate?: boolean;
}

interface FriendLocationCardCapabilities {
    useLocation?: boolean;
    sendInvite?: boolean;
    requestInvite?: boolean;
    boop?: boolean;
}

interface FriendLocationCardActions {
    openUser?: () => void;
    openWorld?: () => void;
    launchLocation?: () => void;
    selfInviteLocation?: () => void;
    sendInvite?: () => void;
    requestInvite?: () => void;
    sendBoop?: () => void;
}

export interface FriendLocationCardProps {
    friend: FriendRecord;
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
        timerLocation = ''
    } = location;
    const {
        density: densityConfig = DEFAULT_CARD_DENSITY_CONFIG,
        contentMode = 'full',
        displayInstanceInfo = true,
        showAvatarFrame = false,
        showNameplate = false
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

    const decorationHover = useDecorationHover();
    const recentlyOnline = useRecentlyOnline(normalizeString(friend.id));
    const iconFrameId = showAvatarFrame ? friend.iconFrame?.trim() : '';
    const nameplateId = showNameplate ? friend.nameplateEffect?.trim() : '';
    const avatarUrl = userImage(friend);
    const presence = friend.$presence;
    const statusDotClassName = presenceDotClassName(presence, friend.status);
    const canOpenUser = typeof onOpenUser === 'function';
    const canOpenWorld = typeof onOpenWorld === 'function';
    const localLocation =
        location.source === 'gameLog'
            ? normalizeLocationValue(rawLocation)
            : '';
    const locationValue =
        localLocation ||
        (presence.kind === 'active'
            ? ''
            : presenceLocationTag(presence, { preferTraveling: false }));
    const travelingValue = localLocation
        ? undefined
        : presenceTravelingTag(presence) || undefined;
    const isTraveling =
        travelingValue !== undefined && locationValue === 'traveling';
    const decorationActive =
        decorationHover.active || recentlyOnline || isTraveling;
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
    const showLocationInfo =
        contentMode === 'full' &&
        displayInstanceInfo &&
        (Boolean(locationValue) ||
            (Boolean(locationLabel) &&
                normalizeUserStatus(locationLabel) !== 'offline'));
    const isPendingOffline = presence.kind === 'pendingOffline';
    const cardRef = usePendingOfflineBlink<HTMLDivElement>(isPendingOffline);
    const statusText = isPendingOffline
        ? t('side_panel.pending_offline')
        : friend.statusDescription;
    const showStatusDescription =
        contentMode !== 'identity' &&
        resolvedDensityConfig.showStatusDescription &&
        Boolean(statusText);
    const hoverUserId = normalizeString(friend.id);
    const instanceEpoch = useFriendLocationTimeEpoch(
        hoverUserId,
        timerLocation || ''
    );
    const avatarNode = (
        <UserHoverCard userId={hoverUserId} seed={friend}>
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
                {iconFrameId ? (
                    <ProfileAvatarFrame
                        templateId={iconFrameId}
                        active={decorationActive}
                    />
                ) : null}
                <UserStatusDot
                    statusDotClassName={statusDotClassName}
                    className="absolute -right-0.5 -bottom-0.5 z-10 size-[var(--friend-card-dot-size)]"
                />
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
            <UserHoverCard userId={hoverUserId} seed={friend}>
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
                {statusText}
            </span>
        </CardDescription>
    ) : null;
    const cardActions = (
        <div
            role="presentation"
            data-dim-exempt
            className="pointer-events-none absolute top-[var(--friend-card-padding)] right-[var(--friend-card-padding)] z-20 flex items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-fast) ease-(--ease-out-ui) group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100 motion-reduce:transition-none"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
        >
            <DropdownMenu>
                <HintTooltip label={t('accessibility.more')}>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="secondary"
                            >
                                <MoreHorizontalIcon />
                            </Button>
                        }
                    />
                </HintTooltip>
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
                        ref={cardRef}
                        size="sm"
                        data-pending-offline={isPendingOffline || undefined}
                        className={cn(
                            'bg-object-surface border-border focus-visible:ring-ring/50 relative isolate h-full rounded-lg border ring-0 transition-colors duration-(--motion-fast) ease-(--ease-out-ui) outline-none hover:bg-[color-mix(in_oklch,var(--object-surface),var(--foreground)_7%)] focus-visible:ring-3 focus-visible:ring-inset motion-reduce:transition-none',
                            canOpenUser && 'cursor-pointer',
                            isDense
                                ? 'flex-row items-center gap-[calc(var(--friend-card-gap)+2px)] rounded-lg p-[var(--friend-card-padding)]'
                                : 'gap-[var(--friend-card-gap)] py-[var(--friend-card-padding)]'
                        )}
                        onClick={onOpenUser}
                        {...decorationHover.hoverProps}
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
                        {nameplateId ? (
                            <ProfileNameplate
                                templateId={nameplateId}
                                active={decorationActive}
                            />
                        ) : null}
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
            <ContextMenuContent className="w-max max-w-[calc(100vw-1rem)] min-w-56">
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
