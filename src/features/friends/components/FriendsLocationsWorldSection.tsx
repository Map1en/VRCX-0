import { GlobeIcon, UserIcon, UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AffinityBadge } from '@/components/affinity/AffinityBadge';
import { usePendingOfflineBlink } from '@/components/friends/usePendingOfflineBlink';
import { useRecentlyOnline } from '@/components/friends/useRecentlyOnline';
import { InstanceVisitedBadge } from '@/components/instances/InstanceVisitedBadge';
import { LocationPendingText } from '@/components/location/LocationPendingText';
import { RegionCodeBadge } from '@/components/location/RegionCodeBadge';
import { useInstancePopulation } from '@/components/location/useInstancePopulation';
import { useLocationMetadata } from '@/components/location/useLocationMetadata';
import { FadeInImage } from '@/components/media/FadeInImage';
import {
    ProfileAvatarFrame,
    ProfileNameplate,
    useDecorationHover
} from '@/components/ProfileDecorations';
import { resolveSidebarStatusDotClassName } from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { UserStatusDot } from '@/components/UserStatusDot';
import { presenceTravelingTag } from '@/domain/friends/presence';
import type { FriendRecord } from '@/domain/friends/types';
import type { WorldSummary } from '@/lib/useWorldSummaries';
import { cn } from '@/lib/utils';
import { userImage } from '@/services/entityMediaService';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType';
import { parseLocation, translateAccessType } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { getFriendsLocationsDensityConfig } from '../friendsLocationsDensity';
import type {
    FriendsLocationsWorldGroup,
    FriendsLocationsWorldInstance
} from '../friendsLocationsWorlds';

type FriendsLocationsWorldSectionProps = {
    group: FriendsLocationsWorldGroup;
    summary?: WorldSummary;
    densityConfig: ReturnType<typeof getFriendsLocationsDensityConfig>;
    favoriteIds: ReadonlySet<string>;
    onOpenWorld: (group: FriendsLocationsWorldGroup, name: string) => void;
    onOpenGroup: (groupId: string) => void;
    onOpenUser: (friend: FriendRecord) => void;
};

function FriendChip({
    friend,
    isFavorite,
    statusDotClassName,
    twoLine,
    showAvatarFrame,
    showNameplate,
    onOpen
}: {
    friend: FriendRecord;
    isFavorite: boolean;
    statusDotClassName: string;
    twoLine: boolean;
    showAvatarFrame: boolean;
    showNameplate: boolean;
    onOpen: () => void;
}) {
    const { t } = useTranslation();
    const decorationHover = useDecorationHover();
    const recentlyOnline = useRecentlyOnline(normalizeString(friend.id));
    const iconFrameId = showAvatarFrame ? friend.iconFrame?.trim() : '';
    const nameplateId = showNameplate ? friend.nameplateEffect?.trim() : '';
    const avatarUrl = userImage(friend);
    const isTraveling = Boolean(presenceTravelingTag(friend.$presence));
    const decorationActive =
        decorationHover.active || recentlyOnline || isTraveling;
    const isPendingOffline = friend.$presence?.kind === 'pendingOffline';
    const chipRef = usePendingOfflineBlink<HTMLButtonElement>(isPendingOffline);
    const statusDescription = !twoLine
        ? ''
        : isPendingOffline
          ? t('side_panel.pending_offline')
          : normalizeString(friend.statusDescription);

    return (
        <UserHoverCard userId={friend.id} seed={friend}>
            <button
                ref={chipRef}
                type="button"
                data-pending-offline={isPendingOffline || undefined}
                className={cn(
                    'focus-visible:ring-ring/50 bg-foreground/4 relative isolate flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md pr-3 pl-1 text-sm outline-none hover:bg-(--state-hover-surface) focus-visible:ring-3',
                    twoLine ? 'h-10' : 'h-8'
                )}
                onClick={onOpen}
                {...decorationHover.hoverProps}
            >
                {nameplateId ? (
                    <ProfileNameplate
                        templateId={nameplateId}
                        active={decorationActive}
                    />
                ) : null}
                <Avatar
                    size={twoLine ? 'default' : 'sm'}
                    className="shrink-0 after:hidden"
                >
                    {avatarUrl ? (
                        <AvatarImage src={avatarUrl} alt="" loading="lazy" />
                    ) : null}
                    <AvatarFallback>
                        <UserIcon aria-hidden="true" className="size-3" />
                    </AvatarFallback>
                    {iconFrameId ? (
                        <ProfileAvatarFrame
                            templateId={iconFrameId}
                            active={decorationActive}
                        />
                    ) : null}
                    <UserStatusDot
                        statusDotClassName={statusDotClassName}
                        className="absolute -right-0.5 -bottom-0.5 z-10 size-3"
                    />
                </Avatar>
                <span className="flex min-w-0 flex-col items-start">
                    <span className="flex max-w-full min-w-0 items-center gap-1 leading-4">
                        {isTraveling ? (
                            <Spinner className="size-3 shrink-0" />
                        ) : null}
                        <span className="min-w-0 truncate">
                            {friend.displayName}
                        </span>
                        {isFavorite ? (
                            <AffinityBadge isFavorite iconOnly />
                        ) : null}
                    </span>
                    {statusDescription ? (
                        <span className="text-muted-foreground max-w-full truncate text-xs leading-4">
                            {statusDescription}
                        </span>
                    ) : null}
                </span>
            </button>
        </UserHoverCard>
    );
}

export function FriendsLocationsFriendChips({
    friends,
    favoriteIds,
    twoLine,
    onOpenUser
}: {
    friends: FriendRecord[];
    favoriteIds: ReadonlySet<string>;
    twoLine: boolean;
    onOpenUser: (friend: FriendRecord) => void;
}) {
    const showAvatarFrame = usePreferencesStore(
        (state) => state.showFriendsLocationsWorldsAvatarFrame
    );
    const showNameplate = usePreferencesStore(
        (state) => state.showFriendsLocationsWorldsNameplate
    );
    return (
        <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(0,200px))] gap-1.5">
            {friends.map((friend) => (
                <FriendChip
                    key={friend.id}
                    friend={friend}
                    isFavorite={favoriteIds.has(friend.id)}
                    twoLine={twoLine}
                    showAvatarFrame={showAvatarFrame}
                    showNameplate={showNameplate}
                    statusDotClassName={resolveSidebarStatusDotClassName(
                        friend,
                        {
                            hideNonFriend: false
                        }
                    )}
                    onOpen={() => onOpenUser(friend)}
                />
            ))}
        </div>
    );
}

function InstanceRow({
    instance,
    favoriteIds,
    twoLine,
    onOpenGroup,
    onOpenUser
}: {
    instance: FriendsLocationsWorldInstance;
    favoriteIds: ReadonlySet<string>;
    twoLine: boolean;
    onOpenGroup: (groupId: string) => void;
    onOpenUser: (friend: FriendRecord) => void;
}) {
    const { t } = useTranslation();
    const parsed = parseLocation(instance.location);
    const metadata = useLocationMetadata({
        locationInfo: parsed,
        currentLocation: instance.location,
        groupHint: instance.groupName
    });
    const {
        ref: metaRef,
        population,
        loading: populationLoading
    } = useInstancePopulation({
        worldId: parsed.worldId,
        instanceId: parsed.instanceId,
        enabled: parsed.isRealInstance,
        refreshKey: instance.friends.length
    });
    const groupName = metadata.groupNamePending
        ? ''
        : metadata.groupName || instance.groupName;
    const label = [
        translateAccessType(parsed.accessTypeName, t, accessTypeLocaleKeyMap),
        parsed.instanceName ? `#${parsed.instanceName}` : ''
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <div
                ref={metaRef}
                className="text-muted-foreground flex min-w-0 items-center text-xs leading-4"
            >
                <RegionCodeBadge region={parsed.region} />
                <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0">{label}</span>
                    {population ? (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <span
                                        className={cn(
                                            'inline-flex shrink-0 items-center gap-1 tabular-nums',
                                            population.full && 'text-amber-400'
                                        )}
                                    />
                                }
                            >
                                <UsersIcon
                                    aria-hidden="true"
                                    className="size-3"
                                />
                                {population.capacity
                                    ? `${population.nUsers}/${population.capacity}`
                                    : population.nUsers}
                            </TooltipTrigger>
                            <TooltipContent>
                                {population.capacity
                                    ? t(
                                          'view.friends_locations.instance_population_capacity',
                                          {
                                              users: population.nUsers,
                                              capacity: population.capacity
                                          }
                                      )
                                    : t(
                                          'view.friends_locations.instance_population',
                                          { users: population.nUsers }
                                      )}
                            </TooltipContent>
                        </Tooltip>
                    ) : populationLoading ? (
                        <Skeleton className="h-3 w-11 shrink-0" />
                    ) : null}
                    <InstanceVisitedBadge
                        location={instance.location}
                        className="shrink-0"
                    />
                    {groupName || metadata.groupNamePending ? (
                        <LocationPendingText
                            pending={metadata.groupNamePending}
                            className="flex min-w-0"
                            placeholderClassName="w-16"
                        >
                            <span
                                role="button"
                                tabIndex={0}
                                className="hover:text-foreground min-w-0 cursor-pointer truncate"
                                onClick={() => onOpenGroup(instance.groupId)}
                                onKeyDown={(event) => {
                                    if (
                                        event.key === 'Enter' ||
                                        event.key === ' '
                                    ) {
                                        event.preventDefault();
                                        onOpenGroup(instance.groupId);
                                    }
                                }}
                            >
                                ({groupName})
                            </span>
                        </LocationPendingText>
                    ) : null}
                </span>
            </div>
            <FriendsLocationsFriendChips
                friends={instance.friends}
                favoriteIds={favoriteIds}
                twoLine={twoLine}
                onOpenUser={onOpenUser}
            />
        </div>
    );
}

export function FriendsLocationsWorldSection({
    group,
    summary,
    densityConfig,
    favoriteIds,
    onOpenWorld,
    onOpenGroup,
    onOpenUser
}: FriendsLocationsWorldSectionProps) {
    const { t } = useTranslation();
    const name = summary?.name || group.nameHint || group.worldId;
    const namePending = !summary && !group.nameHint;
    const thumbnailWidth = densityConfig.worldThumbnailWidth;
    const thumbnailHeight = Math.round((thumbnailWidth * 3) / 4);

    return (
        <section className="flex min-w-0 gap-4">
            <button
                type="button"
                className="bg-muted focus-visible:ring-ring/50 after:ring-foreground/10 relative flex shrink-0 cursor-pointer items-center justify-center self-start overflow-hidden rounded-lg outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:ring-1 after:ring-inset focus-visible:ring-3"
                style={{ width: thumbnailWidth, height: thumbnailHeight }}
                aria-label={name}
                onClick={() => onOpenWorld(group, name)}
            >
                {summary?.thumbnailUrl ? (
                    <FadeInImage
                        src={summary.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                        fallback={
                            <GlobeIcon className="text-muted-foreground size-5" />
                        }
                    />
                ) : (
                    <GlobeIcon className="text-muted-foreground size-5" />
                )}
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex h-6 min-w-0 items-baseline gap-2.5">
                    <button
                        type="button"
                        className="focus-visible:ring-ring/50 min-w-0 cursor-pointer truncate rounded-sm text-left text-sm font-semibold outline-none focus-visible:ring-3"
                        onClick={() => onOpenWorld(group, name)}
                    >
                        <LocationPendingText
                            pending={namePending}
                            placeholderClassName="h-3.5 w-32"
                        >
                            {name}
                        </LocationPendingText>
                    </button>
                    {group.instances.length > 1 ? (
                        <span className="text-muted-foreground ml-auto shrink-0 pl-3 text-xs tabular-nums">
                            {t('view.friends_locations.world_instances', {
                                count: group.instances.length
                            })}
                        </span>
                    ) : null}
                </div>
                <div className="flex min-w-0 flex-col gap-3">
                    {group.instances.map((instance) => (
                        <InstanceRow
                            key={instance.location}
                            instance={instance}
                            favoriteIds={favoriteIds}
                            twoLine={densityConfig.worldChipLines === 2}
                            onOpenGroup={onOpenGroup}
                            onOpenUser={onOpenUser}
                        />
                    ))}
                </div>
            </div>
        </section>
    );
}
