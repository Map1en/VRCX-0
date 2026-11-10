import { useDeferredValue, useEffect, useMemo, useState } from 'react';

import { presenceLiveInstanceTag } from '@/domain/friends/presence';
import type { FriendRecord } from '@/domain/friends/types';
import { useScrollViewportMetrics } from '@/lib/useScrollViewportMetrics';
import {
    buildLocalInstanceActionGateMap,
    evaluateLocalInstanceActionGates,
    type LocalInstanceActionGateTarget
} from '@/shared/utils/invite';
import { normalizeString } from '@/shared/utils/string';

import type { FriendsLocationsSegment } from './friendsLocationsConfig';
import { useFriendsLocationsActions } from './useFriendsLocationsActions';
import { useFriendsLocationsPageDerivedState } from './useFriendsLocationsPageDerivedState';
import { useFriendsLocationsPreferences } from './useFriendsLocationsPreferences';
import { useFriendsLocationsRosterState } from './useFriendsLocationsRosterState';
import { useFriendsLocationsRuntime } from './useFriendsLocationsRuntime';

function buildLocationGateTarget(
    friend: FriendRecord,
    currentUserId?: string | null
): LocalInstanceActionGateTarget | null {
    const location = presenceLiveInstanceTag(friend.$presence, {
        preferTraveling: false
    });
    if (!location) {
        return null;
    }
    return {
        key: location,
        userId: friend.id,
        location,
        presenceKind: friend.$presence.kind,
        isCurrentUser: friend.id === normalizeString(currentUserId)
    };
}

export function useFriendsLocationsPageController() {
    const runtime = useFriendsLocationsRuntime();
    const roster = useFriendsLocationsRosterState();
    const [activeSegment, setActiveSegment] =
        useState<FriendsLocationsSegment>('online');
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
        () => new Set<string>()
    );
    const {
        changeDensityPreference,
        changeShowFavoritesInOnline,
        changeShowSameInstanceInOnline,
        changeViewMode,
        density,
        preferencesReady,
        showFavoritesInOnline,
        showSameInstanceInOnline,
        sidebarFavoritePrefs,
        sidebarSortMethods,
        viewMode
    } = useFriendsLocationsPreferences();
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const {
        resetScrollTop,
        viewportMetrics: scrollMetrics,
        viewportRef: scrollRef
    } = useScrollViewportMetrics({ enabled: viewMode === 'people' });

    useEffect(() => {
        resetScrollTop();
    }, [
        activeSegment,
        deferredSearchQuery,
        resetScrollTop,
        showFavoritesInOnline,
        showSameInstanceInOnline,
        viewMode
    ]);

    const derived = useFriendsLocationsPageDerivedState({
        activeIds: roster.activeIds,
        activeSegment,
        collapsedGroups,
        currentUserId: runtime.currentUserId,
        currentUserSnapshot: runtime.currentUserSnapshot,
        deferredSearchQuery,
        density,
        favoriteFriendGroups: roster.favoriteFriendGroups,
        friendsById: roster.friendsById,
        gameState: runtime.gameState,
        groupedFavoriteFriendIdsByGroupKey:
            roster.groupedFavoriteFriendIdsByGroupKey,
        localFriendFavoriteGroups: roster.localFriendFavoriteGroups,
        localFriendFavorites: roster.localFriendFavorites,
        offlineIds: roster.offlineIds,
        onlineIds: roster.onlineIds,
        remoteFavoriteFriendIds: roster.remoteFavoriteFriendIds,
        rosterStatus: roster.rosterStatus,
        scrollMetrics,
        showFavoritesInOnline,
        showSameInstanceInOnline,
        sidebarFavoritePrefs,
        sidebarSortMethods,
        viewMode
    });
    const instanceActionGateTargets = useMemo(
        () =>
            Object.values(roster.friendsById || {})
                .map((friend) =>
                    buildLocationGateTarget(friend, runtime.currentUserId)
                )
                .filter(
                    (target): target is LocalInstanceActionGateTarget =>
                        target != null
                ),
        [roster.friendsById, runtime.currentUserId]
    );
    const instanceActionGatesByLocation = useMemo(
        () =>
            buildLocalInstanceActionGateMap(
                evaluateLocalInstanceActionGates({
                    currentUserId: runtime.currentUserId,
                    currentInviteLocation: derived.currentInviteLocation,
                    isGameRunning: Boolean(runtime.gameState?.isGameRunning),
                    friendUserIds: Object.keys(roster.friendsById || {}),
                    targets: instanceActionGateTargets
                }).targets
            ),
        [
            derived.currentInviteLocation,
            roster.friendsById,
            runtime.currentUserId,
            runtime.gameState?.isGameRunning,
            instanceActionGateTargets
        ]
    );
    const actions = useFriendsLocationsActions({
        canInviteFromCurrentLocation: derived.canInviteFromCurrentLocation,
        currentInviteLocation: derived.currentInviteLocation,
        currentUserId: runtime.currentUserId ?? '',
        setCollapsedGroups,
        instanceActionGatesByLocation
    });
    const isError = roster.rosterStatus === 'error';

    return {
        actions,
        filters: {
            activeSegment,
            collapsedGroups,
            searchQuery,
            setActiveSegment,
            setSearchQuery
        },
        preferences: {
            changeDensityPreference,
            changeShowFavoritesInOnline,
            changeShowSameInstanceInOnline,
            changeViewMode,
            density,
            preferencesReady,
            showFavoritesInOnline,
            showSameInstanceInOnline,
            viewMode
        },
        runtime: {
            canBoop: runtime.canBoop,
            currentUserId: runtime.currentUserId
        },
        load: {
            isError,
            isFavoritesLoaded: roster.isFavoritesLoaded,
            rosterDetail: roster.rosterDetail
        },
        scroll: {
            scrollRef
        },
        derived
    };
}
