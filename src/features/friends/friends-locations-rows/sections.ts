import { resolveFavoriteGroupLabels } from './favorites';
import { localized } from './normalization';
import { resolveLocationSummary, resolveLocationTarget } from './targets';
import type {
    FriendLocationFriend,
    FriendLocationSection,
    FriendLocationSectionDescriptor,
    FriendSectionsInput,
    SameInstanceSectionsInput,
    TranslationFn
} from './types';

export function resolveInstanceSectionDescriptor(
    friend: FriendLocationFriend | null | undefined,
    t: TranslationFn | null = null
): FriendLocationSectionDescriptor {
    const target = resolveLocationTarget(friend);
    const summary = resolveLocationSummary(friend, t);
    const descriptor: FriendLocationSectionDescriptor = {
        key: 'instance:unknown',
        title: '',
        description: '',
        worldId: '',
        groupId: '',
        rawLocation: ''
    };

    if (target.isOffline) {
        return {
            ...descriptor,
            key: 'instance:offline',
            title: localized(t, 'location.offline', 'Offline')
        };
    }

    if (target.isPrivate) {
        return {
            ...descriptor,
            key: `instance:private:${target.worldId || target.rawLocation || 'private'}`,
            title: localized(t, 'location.private', 'Private'),
            description: '',
            worldId: target.worldId,
            rawLocation: target.rawLocation
        };
    }

    if (target.isTraveling) {
        return {
            ...descriptor,
            key: `instance:traveling:${target.rawLocation || 'traveling'}`,
            title: localized(t, 'location.traveling', 'Traveling'),
            description: summary.meta || '',
            worldId: target.worldId,
            groupId: target.groupId,
            rawLocation: target.rawLocation
        };
    }

    if (target.worldId) {
        return {
            ...descriptor,
            key: `instance:${target.rawLocation || target.worldId}`,
            title:
                summary.label ||
                target.worldId ||
                localized(t, 'view.friend_list.label.world', 'World'),
            description: [summary.meta].filter(Boolean).join(' · '),
            worldId: target.worldId,
            groupId: target.groupId,
            rawLocation: target.rawLocation
        };
    }

    return {
        ...descriptor,
        key: `instance:${summary.label || target.rawLocation || 'unknown'}`,
        title: summary.label || '',
        description: summary.meta || '',
        rawLocation: target.rawLocation
    };
}

export function buildSameInstanceSections<
    TFriend extends FriendLocationFriend
>({
    sameInstanceGroups,
    displayInstanceInfo = true,
    t
}: SameInstanceSectionsInput<TFriend>): FriendLocationSection<TFriend>[] {
    return sameInstanceGroups
        .map(({ location, friends }) => {
            const descriptor = resolveInstanceSectionDescriptor(
                {
                    ...friends[0],
                    location,
                    travelingToLocation: ''
                },
                t
            );

            return {
                ...descriptor,
                key: `instance:${location}`,
                rawLocation: location,
                displayInstanceInfo,
                friends
            };
        })
        .filter((section) => section.friends.length > 0);
}

function upsertSection<TFriend extends FriendLocationFriend>(
    sectionMap: Map<string, FriendLocationSection<TFriend>>,
    descriptor: FriendLocationSectionDescriptor,
    friend: TFriend
) {
    const existing = sectionMap.get(descriptor.key);
    if (existing) {
        existing.friends.push(friend);
        return;
    }

    sectionMap.set(descriptor.key, {
        ...descriptor,
        friends: [friend]
    });
}

export function buildFriendSections<TFriend extends FriendLocationFriend>({
    friends,
    groupingMode,
    favoriteIds,
    favoriteGroupLabelsByFriendId,
    t
}: FriendSectionsInput<TFriend>): FriendLocationSection<TFriend>[] {
    if (groupingMode === 'flat') {
        return [
            {
                key: 'flat',
                title: localized(
                    t,
                    'view.friends_locations.all_matching_friends',
                    'All matching friends'
                ),
                description: '',
                friends,
                worldId: '',
                groupId: '',
                rawLocation: ''
            }
        ];
    }

    const sectionsByKey = new Map<string, FriendLocationSection<TFriend>>();

    for (const friend of friends) {
        if (groupingMode === 'favoriteGroup') {
            const labels = resolveFavoriteGroupLabels(
                friend,
                favoriteGroupLabelsByFriendId,
                favoriteIds,
                t
            );
            const label =
                labels.length > 0
                    ? labels.join(' / ')
                    : localized(
                          t,
                          'view.friends_locations.no_favorite_group',
                          'No favorite group'
                      );
            upsertSection(
                sectionsByKey,
                {
                    key: `favorite:${label}`,
                    title: label,
                    description:
                        labels.length > 0
                            ? localized(
                                  t,
                                  'view.friends_locations.favorite_group_segment',
                                  'Favorite group segment'
                              )
                            : localized(
                                  t,
                                  'view.friends_locations.friend_is_not_in_hydrated_favorite_group',
                                  'Friend is not in a hydrated favorite group.'
                              ),
                    worldId: '',
                    groupId: '',
                    rawLocation: ''
                },
                friend
            );
            continue;
        }

        upsertSection(
            sectionsByKey,
            resolveInstanceSectionDescriptor(friend, t),
            friend
        );
    }

    return Array.from(sectionsByKey.values()).sort((left, right) => {
        if (
            left.key.startsWith('instance:offline') &&
            !right.key.startsWith('instance:offline')
        ) {
            return 1;
        }
        if (
            right.key.startsWith('instance:offline') &&
            !left.key.startsWith('instance:offline')
        ) {
            return -1;
        }
        return left.title.localeCompare(right.title, undefined, {
            sensitivity: 'base'
        });
    });
}
