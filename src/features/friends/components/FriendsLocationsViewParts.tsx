import {
    ChevronDownIcon,
    GlobeIcon,
    LayersIcon,
    UsersIcon
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { CurrentInstanceBadge } from '@/components/instances/CurrentInstanceBadge';
import { EmptyState } from '@/components/layout/PageScaffold';
import { Location } from '@/components/Location';
import {
    localGameLocation,
    presenceLiveInstanceTag
} from '@/domain/friends/presence';
import type { FriendRecord } from '@/domain/friends/types';
import { isSameInstanceLocation } from '@/domain/instances/instanceRoster';
import { cn } from '@/lib/utils';
import { normalizeString } from '@/shared/utils/string';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import type { getFriendsLocationsDensityConfig } from '../friendsLocationsDensity';
import {
    locationTarget,
    resolveFriendGroupName,
    resolveLocationSummary,
    friendLocationTarget,
    summarizeLocation
} from '../friendsLocationsRows';
import type { FriendsLocationsSection } from '../useFriendsLocationsPageDerivedState';
import { FriendLocationCard } from './FriendLocationCard';

type BivariantCallback<Args extends unknown[]> = {
    bivarianceHack(...args: Args): void;
}['bivarianceHack'];

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
    cardContentMode?: FriendsLocationsSection['cardContentMode'];
    displayInstanceInfo?: boolean;
    friend: FriendRecord;
    currentUserId?: string | null;
    densityConfig: ReturnType<typeof getFriendsLocationsDensityConfig>;
    canUseFriendLocation: (location: string) => boolean;
    canSendInvite: boolean;
    canBoop: boolean;
    onOpenUser: (friend: FriendRecord) => void;
    onOpenWorld: BivariantCallback<[target: unknown, location: unknown]>;
    onLaunchLocation: (location: string) => void;
    onSelfInviteLocation: (location: string) => void;
    onSendInvite: (friend: FriendRecord) => void;
    onRequestInvite: (friend: FriendRecord) => void;
    onSendBoop: (friend: FriendRecord) => void;
};

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
    const isInstanceSection = Boolean(
        section.rawLocation && !section.key.startsWith('instance:offline')
    );

    return (
        <div className="flex h-full min-h-0 items-center justify-between gap-1.5 overflow-hidden px-2 py-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
                <div className="flex min-w-0 items-center gap-2">
                    {isInstanceSection ? (
                        <LayersIcon className="text-muted-foreground size-4 shrink-0" />
                    ) : null}
                    <div className="min-w-0 truncate text-sm font-semibold">
                        {isInstanceSection ? (
                            <Location
                                location={section.rawLocation}
                                hint={section.title}
                                link
                                asButton={false}
                                disableTooltip
                                className="text-sm font-semibold"
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
                    <Badge
                        variant="outline"
                        className="text-muted-foreground shrink-0 font-normal tabular-nums"
                    >
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
            className="h-auto w-full cursor-pointer justify-start gap-2 px-2 py-2 text-left text-sm font-semibold select-none aria-expanded:bg-transparent aria-expanded:hover:bg-(--state-hover-surface)"
            aria-expanded={!section.collapsed}
            onClick={() => onToggle(section.groupKey)}
        >
            <span className="min-w-0 flex-1 truncate">{section.title}</span>{' '}
            <Badge
                variant="outline"
                className="text-muted-foreground shrink-0 font-normal tabular-nums"
            >
                {section.friends.length}
            </Badge>
            <ChevronDownIcon
                data-icon="inline-end"
                className={cn(
                    'shrink-0 transition-transform duration-200 ease-in-out',
                    section.collapsed && '-rotate-90'
                )}
            />
        </Button>
    );
}

export const FriendsLocationCardItem = memo(function FriendsLocationCardItem({
    cardContentMode,
    displayInstanceInfo,
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
    const locationTime = useFriendLocationTimeStore(
        (state) => state.byUserId[friend.id]
    );
    const showAvatarFrame = usePreferencesStore(
        (state) => state.showFriendsLocationsPeopleAvatarFrame
    );
    const showNameplate = usePreferencesStore(
        (state) => state.showFriendsLocationsPeopleNameplate
    );
    const localLocation = localGameLocation(locationTime);
    const location = localLocation
        ? summarizeLocation(localLocation, null, t)
        : resolveLocationSummary(friend, t);
    const target = localLocation
        ? locationTarget(localLocation)
        : friendLocationTarget(friend);
    const rawLocation = target.rawLocation;
    const groupHint = localLocation ? '' : resolveFriendGroupName(friend);
    const presence = friend.$presence;
    const friendIsCurrentUser =
        normalizeString(friend.id) === normalizeString(currentUserId);
    const friendLocationAvailable = canUseFriendLocation(
        localLocation ||
            presenceLiveInstanceTag(presence, { preferTraveling: false })
    );

    return (
        <FriendLocationCard
            friend={friend}
            location={{
                source: locationTime?.source,
                label: location.label,
                groupHint,
                raw: rawLocation,
                timerLocation: locationTime?.location ?? ''
            }}
            presentation={{
                density: densityConfig,
                contentMode: cardContentMode,
                displayInstanceInfo: displayInstanceInfo !== false,
                showAvatarFrame,
                showNameplate
            }}
            capabilities={{
                useLocation: !friendIsCurrentUser && friendLocationAvailable,
                sendInvite: !friendIsCurrentUser && canSendInvite,
                requestInvite: !friendIsCurrentUser,
                boop: !friendIsCurrentUser && canBoop
            }}
            actions={{
                openUser: () => onOpenUser(friend),
                openWorld: target.worldId
                    ? () => onOpenWorld(target, location)
                    : undefined,
                launchLocation: () => onLaunchLocation(rawLocation),
                selfInviteLocation: () => onSelfInviteLocation(rawLocation),
                sendInvite: () => onSendInvite(friend),
                requestInvite: () => onRequestInvite(friend),
                sendBoop: () => onSendBoop(friend)
            }}
        />
    );
});
