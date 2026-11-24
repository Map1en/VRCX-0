import { useTranslation } from 'react-i18next';

import { LoadingState } from '@/components/layout/PageScaffold';
import type { FriendRecord } from '@/domain/friends/types';
import { Separator } from '@/ui/shadcn/separator';

import type { useFriendsLocationsPageController } from '../useFriendsLocationsPageController';
import {
    FriendsLocationCardItem,
    FriendsLocationsEmptyState,
    FriendsLocationsCollapsibleGroupHeader,
    FriendsLocationsSectionHeader
} from './FriendsLocationsViewParts';
import {
    FriendsLocationsFriendChips,
    FriendsLocationsWorldSection
} from './FriendsLocationsWorldSection';

type FriendsLocationsPageControllerState = ReturnType<
    typeof useFriendsLocationsPageController
>;

type FriendsLocationsVirtualListProps = Pick<
    FriendsLocationsPageControllerState,
    'derived' | 'filters' | 'load' | 'runtime' | 'scroll'
> & {
    locationCommands: FriendsLocationsPageControllerState['actions'];
};

export function FriendsLocationsVirtualList({
    derived,
    filters,
    load,
    locationCommands,
    runtime,
    scroll: { scrollRef }
}: FriendsLocationsVirtualListProps) {
    const { t } = useTranslation();
    const privateCollapsed = filters.collapsedGroups.has('private-location');
    const worldChipsTwoLine = derived.densityConfig.worldChipLines === 2;

    return (
        <div
            ref={scrollRef}
            className="friend-view__scroll min-h-0 flex-1 overflow-auto"
        >
            {derived.isLoading ? (
                <LoadingState
                    label={t('view.friends_locations.loading_more')}
                />
            ) : load.isError ? (
                <FriendsLocationsEmptyState
                    title={t(
                        'view.friend_list.error.friend_locations_failed_to_load'
                    )}
                    description={
                        load.rosterDetail ||
                        t(
                            'view.friend_list.success.roster_bootstrap_did_not_complete'
                        )
                    }
                />
            ) : derived.hasVisibleSections && derived.viewMode === 'worlds' ? (
                <div
                    key="worlds"
                    className="divide-border/60 flex flex-col divide-y px-1 py-1 [&>*]:py-4 [&>*:first-child]:pt-1 [&>*:last-child]:pb-1"
                >
                    {derived.worldGroups.map((group) => (
                        <FriendsLocationsWorldSection
                            key={group.worldId}
                            group={group}
                            summary={derived.worldSummaries.get(group.worldId)}
                            densityConfig={derived.densityConfig}
                            favoriteIds={derived.favoriteIds}
                            onOpenWorld={locationCommands.openWorldGroup}
                            onOpenGroup={(groupId) =>
                                locationCommands.openSectionGroup({ groupId })
                            }
                            onOpenUser={locationCommands.openFriendUser}
                        />
                    ))}
                    {derived.privateWorldFriends.length ? (
                        <div className="flex flex-col gap-2">
                            <FriendsLocationsCollapsibleGroupHeader
                                section={{
                                    key: 'worlds:private-location',
                                    type: 'collapsibleGroup',
                                    groupKey: 'private-location',
                                    title: t('location.private'),
                                    description: '',
                                    friends: derived.privateWorldFriends,
                                    worldId: '',
                                    groupId: '',
                                    collapsed: privateCollapsed
                                }}
                                onToggle={
                                    locationCommands.toggleCollapsibleGroup
                                }
                            />
                            {privateCollapsed ? null : (
                                <FriendsLocationsFriendChips
                                    friends={derived.privateWorldFriends}
                                    favoriteIds={derived.favoriteIds}
                                    twoLine={worldChipsTwoLine}
                                    onOpenUser={locationCommands.openFriendUser}
                                />
                            )}
                        </div>
                    ) : null}
                </div>
            ) : derived.hasVisibleSections ? (
                <div
                    key="people"
                    className="relative"
                    style={{
                        height: `${derived.positionedRows.totalHeight}px`
                    }}
                >
                    {derived.visibleVirtualRows.map((row) => (
                        <div
                            key={row.key}
                            className="absolute right-0 left-0 box-border"
                            style={{
                                height: `${row.height}px`,
                                transform: `translateY(${row.top}px)`,
                                paddingTop:
                                    row.type !== 'divider' && row.topGap
                                        ? `${row.topGap}px`
                                        : undefined
                            }}
                        >
                            {row.type === 'header' ? (
                                <FriendsLocationsSectionHeader
                                    section={row.section}
                                    currentLocation={derived.currentLocation}
                                    onOpenWorld={
                                        locationCommands.openSectionWorld
                                    }
                                    onOpenGroup={
                                        locationCommands.openSectionGroup
                                    }
                                />
                            ) : row.type === 'group-header' ? (
                                <FriendsLocationsCollapsibleGroupHeader
                                    section={row.section}
                                    onToggle={
                                        locationCommands.toggleCollapsibleGroup
                                    }
                                />
                            ) : row.type === 'divider' ? (
                                <div className="flex h-full items-center">
                                    <Separator />
                                </div>
                            ) : (
                                <div
                                    className="grid overflow-hidden p-px"
                                    style={{
                                        gap: `${derived.cardGridGap}px`,
                                        height: `${row.gridRowHeight}px`,
                                        gridTemplateColumns: `repeat(${derived.cardGridColumns}, minmax(${derived.cardGridMinWidth}px, 1fr))`
                                    }}
                                >
                                    {row.friends.map((friend: FriendRecord) => (
                                        <FriendsLocationCardItem
                                            key={`${row.section.key}:${friend.id}`}
                                            cardContentMode={
                                                row.section.cardContentMode
                                            }
                                            displayInstanceInfo={
                                                row.section.displayInstanceInfo
                                            }
                                            friend={friend}
                                            currentUserId={
                                                runtime.currentUserId
                                            }
                                            densityConfig={
                                                derived.densityConfig
                                            }
                                            canUseFriendLocation={
                                                locationCommands.canUseFriendLocation
                                            }
                                            canSendInvite={
                                                derived.canSendInvite
                                            }
                                            canBoop={runtime.canBoop}
                                            onOpenUser={
                                                locationCommands.openFriendUser
                                            }
                                            onOpenWorld={
                                                locationCommands.openFriendWorld
                                            }
                                            onLaunchLocation={
                                                locationCommands.launchFriendLocation
                                            }
                                            onSelfInviteLocation={
                                                locationCommands.selfInviteFriendLocation
                                            }
                                            onSendInvite={
                                                locationCommands.sendFriendInvite
                                            }
                                            onRequestInvite={
                                                locationCommands.requestFriendInvite
                                            }
                                            onSendBoop={
                                                locationCommands.sendFriendBoop
                                            }
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <FriendsLocationsEmptyState
                    title={t(
                        'view.friend_list.empty.no_friends_match_the_current_filters'
                    )}
                    description={
                        filters.activeSegment === 'favorite' &&
                        !load.isFavoritesLoaded
                            ? t(
                                  'view.friend_list.label.favorites_are_still_hydrating'
                              )
                            : t(
                                  'view.friend_list.label.try_a_different_segment_or_broaden_the_search_query'
                              )
                    }
                />
            )}
        </div>
    );
}
