import {
    ChevronDownIcon,
    GlobeIcon,
    LayersIcon,
    UsersIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FriendLocationCard } from '@/components/friends/FriendLocationCard';
import { EmptyState } from '@/components/layout/PageScaffold';
import { Location } from '@/components/Location';
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

export function FriendsLocationsEmptyState({ title, description }: any) {
    return <EmptyState title={title} description={description} />;
}

export function FriendsLocationsSectionHeader({
    section,
    onOpenWorld,
    onOpenGroup
}: any) {
    const { t } = useTranslation();

    return (
        <div className="bg-card/50 flex h-full min-h-0 flex-col gap-1.5 overflow-hidden rounded-lg border px-3 py-2 md:flex-row md:items-center md:justify-between">
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
                    <Badge variant="outline" className="shrink-0">
                        {section.friends.length}
                    </Badge>
                </div>
            </div>
            {section.worldId || section.groupId ? (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {section.worldId ? (
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

export function FriendsLocationsFavoriteGroupHeader({
    section,
    onToggle
}: any) {
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
}: any) {
    const { t } = useTranslation();
    const location = resolveLocationSummary(friend, t);
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
