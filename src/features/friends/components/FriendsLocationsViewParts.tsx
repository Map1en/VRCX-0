import {
    ChevronDownIcon,
    GlobeIcon,
    LayersIcon,
    UsersIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FriendLocationCard } from '@/components/friends/FriendLocationCard';
import { CurrentInstanceBadge } from '@/components/instances/CurrentInstanceBadge';
import { EmptyState } from '@/components/layout/PageScaffold';
import { Location } from '@/components/Location';
import type { FriendRecord } from '@/domain/friends/friendRosterTypes';
import { isSameInstanceLocation } from '@/domain/instances/instanceRoster';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
    isOnlineFriend,
    normalizeFriendsLocationId as normalizeId,
    resolveFriendGroupName,
    resolveLocationSummary,
    resolveLocationTarget
} from '../friendsLocationsRows';
import type { FriendsLocationsSection } from '../useFriendsLocationsPageDerivedState';

type BivariantCallback<Args extends unknown[]> = {
    bivarianceHack(...args: Args): void;
}['bivarianceHack'];

type FriendsLocationsFriend = FriendRecord & {
    $travelingToLocation?: unknown;
    ref?: FriendLocationSource | null;
    travelingToLocation?: unknown;
    userId?: unknown;
};

type FriendLocationSource = {
    $travelingToLocation?: unknown;
    location?: unknown;
    travelingToLocation?: unknown;
};

type FriendsLocationsEmptyStateProps = {
    title: string;
    description: string;
};

type FriendsLocationsSectionHeaderProps = {
    section: FriendsLocationsSection;
    currentLocation?: string;
    onOpenWorld: (section: FriendsLocationsSection) => void;
    onOpenGroup: (section: FriendsLocationsSection) => void;
};

type FriendsLocationsCollapsibleGroupHeaderProps = {
    section: FriendsLocationsSection;
    onToggle: BivariantCallback<[string | undefined]>;
};

type FriendsLocationCardItemProps = {
    section: FriendsLocationsSection;
    friend: FriendsLocationsFriend;
    currentUserId?: string | null;
    densityConfig: unknown;
    canUseFriendLocation: (location: string) => boolean;
    canSendInvite: boolean;
    canBoop: boolean;
    onOpenUser: (friend: FriendRecord) => void;
    onOpenWorld: BivariantCallback<[target: unknown, location: unknown]>;
    onOpenGroup: BivariantCallback<[target: unknown]>;
    onLaunchLocation: (location: string) => void;
    onSelfInviteLocation: (location: string) => void;
    onSendInvite: (friend: FriendRecord) => void;
    onRequestInvite: (friend: FriendRecord) => void;
    onSendBoop: (friend: FriendRecord) => void;
};

function isFriendLocationSource(value: unknown): value is FriendLocationSource {
    return typeof value === 'object' && value !== null;
}

export function FriendsLocationsEmptyState({
    title,
    description
}: FriendsLocationsEmptyStateProps) {
    return (
        <EmptyState variant="page" title={title} description={description} />
    );
}

export function FriendsLocationsSectionHeader({
    section,
    currentLocation,
    onOpenWorld,
    onOpenGroup
}: FriendsLocationsSectionHeaderProps) {
    const { t } = useTranslation();

    return (
        <div className="border-border/70 flex h-full min-h-0 flex-col gap-1.5 overflow-hidden rounded-lg border-b px-2 py-2 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
                <div className="flex min-w-0 items-center gap-2">
                    <LayersIcon className="text-muted-foreground size-4 shrink-0" />
                    <div className="min-w-0 flex-1 truncate font-medium">
                        {section.rawLocation &&
                        !section.key.startsWith('instance:offline') ? (
                            <Location
                                location={section.rawLocation}
                                hint={section.title}
                                link
                                asButton={false}
                                disableTooltip
                                className="text-sm"
                            />
                        ) : (
                            section.title
                        )}
                    </div>
                    {isSameInstanceLocation(
                        section.rawLocation,
                        currentLocation
                    ) ? (
                        <CurrentInstanceBadge className="shrink-0" />
                    ) : null}
                    <Badge variant="outline" className="shrink-0">
                        {section.friends.length}
                    </Badge>
                </div>
            </div>
            {(section.worldId && section.displayInstanceInfo !== false) ||
            section.groupId ? (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {section.worldId &&
                    section.displayInstanceInfo !== false ? (
                        <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => onOpenWorld(section)}
                        >
                            <GlobeIcon data-icon="inline-start" />
                            {t('view.friend_list.label.world')}
                        </Button>
                    ) : null}
                    {section.groupId ? (
                        <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => onOpenGroup(section)}
                        >
                            <UsersIcon data-icon="inline-start" />
                            {t('view.friend_list.label.group')}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

export function FriendsLocationsCollapsibleGroupHeader({
    section,
    onToggle
}: FriendsLocationsCollapsibleGroupHeaderProps) {
    return (
        <Button
            type="button"
            variant="ghost"
            className="h-auto w-full cursor-pointer justify-start gap-1.5 px-1 py-1.5 text-left text-sm font-semibold select-none"
            onClick={() => onToggle(section.groupKey)}
        >
            <ChevronDownIcon
                data-icon="inline-start"
                className={cn(
                    'shrink-0 transition-transform duration-200 ease-in-out',
                    section.collapsed && '-rotate-90'
                )}
            />
            <span className="min-w-0 truncate">{section.title}</span>
            <span className="text-xs font-normal opacity-70">
                ({section.friends.length})
            </span>
        </Button>
    );
}

export function FriendsLocationCardItem({
    section,
    friend,
    currentUserId,
    densityConfig,
    canUseFriendLocation,
    canSendInvite,
    canBoop,
    onOpenUser,
    onOpenWorld,
    onLaunchLocation,
    onSelfInviteLocation,
    onSendInvite,
    onRequestInvite,
    onSendBoop
}: FriendsLocationCardItemProps) {
    const { t } = useTranslation();
    const location = resolveLocationSummary(friend, t);
    const target = resolveLocationTarget(friend);
    const rawLocation = target.rawLocation;
    const groupHint = resolveFriendGroupName(friend);
    const source = isFriendLocationSource(friend.ref) ? friend.ref : friend;
    const isTravelingLocation =
        normalizeId(source?.location).toLowerCase() === 'traveling';
    const travelingLocation =
        source?.travelingToLocation || source?.$travelingToLocation || '';
    const friendIsCurrentUser =
        normalizeId(friend?.id || friend?.userId) ===
        normalizeId(currentUserId);
    const friendIsOnline = isOnlineFriend(friend);
    const friendLocationAvailable = canUseFriendLocation(rawLocation);

    return (
        <FriendLocationCard
            friend={friend}
            locationLabel={location.label}
            groupHint={groupHint}
            rawLocation={rawLocation}
            isTraveling={isTravelingLocation}
            travelingLocation={travelingLocation}
            densityConfig={densityConfig}
            contentMode={section.cardContentMode}
            displayInstanceInfo={section.displayInstanceInfo !== false}
            canUseFriendLocation={
                !friendIsCurrentUser && friendLocationAvailable
            }
            canSendInvite={!friendIsCurrentUser && canSendInvite}
            canRequestInvite={!friendIsCurrentUser && friendIsOnline}
            canBoop={!friendIsCurrentUser && canBoop}
            onOpenUser={() => onOpenUser(friend)}
            onOpenWorld={
                target.worldId ? () => onOpenWorld(target, location) : undefined
            }
            onLaunchLocation={() => onLaunchLocation(rawLocation)}
            onSelfInviteLocation={() => onSelfInviteLocation(rawLocation)}
            onSendInvite={() => onSendInvite(friend)}
            onRequestInvite={() => onRequestInvite(friend)}
            onSendBoop={() => onSendBoop(friend)}
        />
    );
}
