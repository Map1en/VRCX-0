import { useTranslation } from 'react-i18next';

import { LoadingState } from '@/components/layout/PageScaffold.jsx';

import {
    FriendsLocationCardItem,
    FriendsLocationsEmptyState,
    FriendsLocationsFavoriteGroupHeader,
    FriendsLocationsSectionHeader
} from './FriendsLocationsViewParts.jsx';

export function FriendsLocationsVirtualList({ controller }) {
    const { t } = useTranslation();
    const {
        scrollRef,
        isLoading,
        isError,
        hasVisibleSections,
        rosterDetail,
        activeSegment,
        isFavoritesLoaded,
        positionedRows,
        visibleVirtualRows,
        cardGridGap,
        cardGridMinWidth,
        cardGridColumns,
        cardGridRowHeight,
        currentUserId,
        cardScale,
        spacingScale,
        canUseFriendLocation,
        canSendInvite,
        canBoop,
        openSectionWorld,
        openSectionGroup,
        toggleFavoriteGroup,
        openFriendUser,
        openFriendWorld,
        openFriendGroup,
        launchFriendLocation,
        selfInviteFriendLocation,
        sendFriendInvite,
        requestFriendInvite,
        sendFriendBoop
    } = controller;

    return (
        <div
            ref={scrollRef}
            className="friend-view__scroll min-h-0 flex-1 overflow-auto"
        >
            {isLoading ? (
                <LoadingState
                    label={t('view.friends_locations.loading_more')}
                />
            ) : isError ? (
                <FriendsLocationsEmptyState
                    title={t(
                        'view.friend_list.generated.friend_locations_failed_to_load'
                    )}
                    description={
                        rosterDetail ||
                        t(
                            'view.friend_list.generated.roster_bootstrap_did_not_complete'
                        )
                    }
                />
            ) : hasVisibleSections ? (
                <div
                    className="relative"
                    style={{
                        height: `${positionedRows.totalHeight}px`
                    }}
                >
                    {visibleVirtualRows.map((row) => (
                        <div
                            key={row.key}
                            className="absolute right-0 left-0"
                            style={{
                                height: `${row.height}px`,
                                transform: `translateY(${row.top}px)`
                            }}
                        >
                            {row.type === 'header' ? (
                                <FriendsLocationsSectionHeader
                                    section={row.section}
                                    t={t}
                                    onOpenWorld={openSectionWorld}
                                    onOpenGroup={openSectionGroup}
                                />
                            ) : row.type === 'group-header' ? (
                                <FriendsLocationsFavoriteGroupHeader
                                    section={row.section}
                                    onToggle={toggleFavoriteGroup}
                                />
                            ) : (
                                <div
                                    className="grid overflow-hidden"
                                    style={{
                                        gap: `${cardGridGap}px`,
                                        height: `${cardGridRowHeight}px`,
                                        gridTemplateColumns: `repeat(${cardGridColumns}, minmax(${cardGridMinWidth}px, 1fr))`
                                    }}
                                >
                                    {row.friends.map((friend) => (
                                        <FriendsLocationCardItem
                                            key={`${row.section.key}:${friend.id}`}
                                            section={row.section}
                                            friend={friend}
                                            currentUserId={currentUserId}
                                            cardScale={cardScale}
                                            spacingScale={spacingScale}
                                            canUseFriendLocation={
                                                canUseFriendLocation
                                            }
                                            canSendInvite={canSendInvite}
                                            canBoop={canBoop}
                                            onOpenUser={openFriendUser}
                                            onOpenWorld={openFriendWorld}
                                            onOpenGroup={openFriendGroup}
                                            onLaunchLocation={
                                                launchFriendLocation
                                            }
                                            onSelfInviteLocation={
                                                selfInviteFriendLocation
                                            }
                                            onSendInvite={sendFriendInvite}
                                            onRequestInvite={
                                                requestFriendInvite
                                            }
                                            onSendBoop={sendFriendBoop}
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
                        'view.friend_list.generated.no_friends_match_the_current_filters'
                    )}
                    description={
                        activeSegment === 'favorite' && !isFavoritesLoaded
                            ? t(
                                  'view.friend_list.generated.favorites_are_still_hydrating'
                              )
                            : t(
                                  'view.friend_list.generated.try_a_different_segment_or_broaden_the_search_query'
                              )
                    }
                />
            )}
        </div>
    );
}
