import { LoadingState } from '@/components/layout/PageScaffold.jsx';

import {
    FriendsLocationCardItem,
    FriendsLocationsEmptyState,
    FriendsLocationsFavoriteGroupHeader,
    FriendsLocationsSectionHeader
} from './FriendsLocationsViewParts.jsx';

export function FriendsLocationsVirtualList({
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
    t,
    onOpenSectionWorld,
    onOpenSectionGroup,
    onToggleFavoriteGroup,
    onOpenFriendUser,
    onOpenFriendWorld,
    onOpenFriendGroup,
    onLaunchFriendLocation,
    onSelfInviteFriendLocation,
    onSendFriendInvite,
    onRequestFriendInvite,
    onSendFriendBoop
}) {
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
                    title={t('view.friend_list.generated.friend_locations_failed_to_load')}
                    description={
                        rosterDetail || 'The roster bootstrap did not complete.'
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
                                    onOpenWorld={onOpenSectionWorld}
                                    onOpenGroup={onOpenSectionGroup}
                                />
                            ) : row.type === 'group-header' ? (
                                <FriendsLocationsFavoriteGroupHeader
                                    section={row.section}
                                    onToggle={onToggleFavoriteGroup}
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
                                            onOpenUser={onOpenFriendUser}
                                            onOpenWorld={onOpenFriendWorld}
                                            onOpenGroup={onOpenFriendGroup}
                                            onLaunchLocation={
                                                onLaunchFriendLocation
                                            }
                                            onSelfInviteLocation={
                                                onSelfInviteFriendLocation
                                            }
                                            onSendInvite={onSendFriendInvite}
                                            onRequestInvite={
                                                onRequestFriendInvite
                                            }
                                            onSendBoop={onSendFriendBoop}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <FriendsLocationsEmptyState
                    title={t('view.friend_list.generated.no_friends_match_the_current_filters')}
                    description={
                        activeSegment === 'favorite' && !isFavoritesLoaded
                            ? 'Favorites are still hydrating.'
                            : 'Try a different segment or broaden the search query.'
                    }
                />
            )}
        </div>
    );
}
