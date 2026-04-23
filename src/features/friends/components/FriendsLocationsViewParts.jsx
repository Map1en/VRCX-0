import {
    ChevronDownIcon,
    GlobeIcon,
    LayersIcon,
    UsersIcon
} from 'lucide-react';

import { FriendLocationCard } from '@/components/friends/FriendLocationCard.jsx';
import { EmptyState } from '@/components/layout/PageScaffold.jsx';
import { Location } from '@/components/Location.jsx';
import { cn } from '@/lib/utils.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
    isOnlineFriend,
    normalizeFriendsLocationId as normalizeId,
    resolveFriendGroupName,
    resolveLocationSummary,
    resolveLocationTarget
} from '../friendsLocationsRows.js';

export function FriendsLocationsEmptyState({ title, description }) {
    return <EmptyState title={title} description={description} />;
}

export function FriendsLocationsSectionHeader({
    section,
    onOpenWorld,
    onOpenGroup,
    t
}) {
    return (
        <div className="bg-muted/20 flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-xl border px-3 py-2 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-col gap-1 overflow-hidden">
                <div className="flex flex-wrap items-center gap-2">
                    <LayersIcon className="text-muted-foreground size-4" />
                    <div className="min-w-0 truncate font-medium">
                        {section.rawLocation &&
                        !section.key.startsWith('instance:offline') ? (
                            <Location
                                location={section.rawLocation}
                                hint={section.title}
                                link={false}
                                asButton={false}
                                disableTooltip
                            />
                        ) : (
                            section.title
                        )}
                    </div>
                    <Badge variant="outline">{section.friends.length}</Badge>
                </div>
                {section.description ? (
                    <div className="text-muted-foreground line-clamp-1 text-xs break-words">
                        {section.description}
                    </div>
                ) : null}
            </div>
            {section.worldId || section.groupId ? (
                <div className="flex shrink-0 flex-wrap gap-2">
                    {section.worldId ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onOpenWorld(section)}
                        >
                            <GlobeIcon data-icon="inline-start" />
                            {t('view.friend_list.generated.world')}
                        </Button>
                    ) : null}
                    {section.groupId ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onOpenGroup(section)}
                        >
                            <UsersIcon data-icon="inline-start" />
                            {t('view.friend_list.generated.group')}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

export function FriendsLocationsFavoriteGroupHeader({ section, onToggle }) {
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
    cardScale,
    spacingScale,
    canUseFriendLocation,
    canSendInvite,
    canBoop,
    onOpenUser,
    onOpenWorld,
    onOpenGroup,
    onLaunchLocation,
    onSelfInviteLocation,
    onSendInvite,
    onRequestInvite,
    onSendBoop
}) {
    const location = resolveLocationSummary(friend);
    const target = resolveLocationTarget(friend);
    const rawLocation = target.rawLocation;
    const groupHint = resolveFriendGroupName(friend);
    const source =
        friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
    const isTravelingLocation =
        normalizeId(source?.location).toLowerCase() === 'traveling';
    const travelingLocation =
        source?.travelingToLocation || source?.$travelingToLocation || '';
    const friendIsCurrentUser =
        normalizeId(friend?.id || friend?.userId) === normalizeId(currentUserId);
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
            cardScale={cardScale}
            spacingScale={spacingScale}
            displayInstanceInfo={section.displayInstanceInfo !== false}
            canUseFriendLocation={
                !friendIsCurrentUser && friendLocationAvailable
            }
            canSendInvite={!friendIsCurrentUser && canSendInvite}
            canRequestInvite={!friendIsCurrentUser && friendIsOnline}
            canBoop={!friendIsCurrentUser && canBoop}
            onOpenUser={() => onOpenUser(friend)}
            onOpenWorld={
                target.worldId
                    ? () => onOpenWorld(target, location)
                    : undefined
            }
            onOpenGroup={
                target.groupId ? () => onOpenGroup(target) : undefined
            }
            onLaunchLocation={() => onLaunchLocation(rawLocation)}
            onSelfInviteLocation={() => onSelfInviteLocation(rawLocation)}
            onSendInvite={() => onSendInvite(friend)}
            onRequestInvite={() => onRequestInvite(friend)}
            onSendBoop={() => onSendBoop(friend)}
        />
    );
}
