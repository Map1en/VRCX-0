import { useTranslation } from 'react-i18next';

import { LoadingState } from '@/components/layout/PageScaffold';

import {
    FriendsLocationCardItem,
    FriendsLocationsEmptyState,
    FriendsLocationsFavoriteGroupHeader,
    FriendsLocationsSectionHeader
} from './FriendsLocationsViewParts';

export function FriendsLocationsVirtualList({
    derived,
    filters,
    load,
    locationCommands,
    runtime,
    scroll
}: any) {
    const { t } = useTranslation();

    return (
        <div
            ref={scroll.scrollRef}
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
            ) : derived.hasVisibleSections ? (
                <div
                    className="relative"
                    style={{
                        height: `${derived.positionedRows.totalHeight}px`
                    }}
                >
                    {derived.visibleVirtualRows.map((row: any) => (
                        <div
                            key={row.key}
                            className="absolute right-0 left-0 box-border"
                            style={{
                                height: `${row.height}px`,
                                transform: `translateY(${row.top}px)`,
                                paddingTop: row.topGap
                                    ? `${row.topGap}px`
                                    : undefined
                            }}
                        >
                            {row.type === 'header' ? (
                                <FriendsLocationsSectionHeader
                                    section={row.section}
                                    onOpenWorld={
                                        locationCommands.openSectionWorld
                                    }
                                    onOpenGroup={
                                        locationCommands.openSectionGroup
                                    }
                                />
                            ) : row.type === 'group-header' ? (
                                <FriendsLocationsFavoriteGroupHeader
                                    section={row.section}
                                    onToggle={
                                        locationCommands.toggleFavoriteGroup
                                    }
                                />
                            ) : row.type === 'divider' ? (
                                <div className="flex h-full items-center">
                                    <div className="border-border w-full border-t" />
                                </div>
                            ) : (
                                <div
                                    className="grid overflow-hidden p-px"
                                    style={{
                                        gap: `${derived.cardGridGap}px`,
                                        height: `${derived.cardGridRowHeight}px`,
                                        gridTemplateColumns: `repeat(${derived.cardGridColumns}, minmax(${derived.cardGridMinWidth}px, 1fr))`
                                    }}
                                >
                                    {row.friends.map((friend: any) => (
                                        <FriendsLocationCardItem
                                            key={`${row.section.key}:${friend.id}`}
                                            section={row.section}
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
                                            onOpenGroup={
                                                locationCommands.openFriendGroup
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
