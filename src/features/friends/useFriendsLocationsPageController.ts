import { useDeferredValue, useEffect, useMemo, useState } from 'react';

import { useScrollViewportMetrics } from '@/lib/useScrollViewportMetrics';
import {
    buildLocalInstanceActionGateMap,
    evaluateLocalInstanceActionGates,
    type LocalInstanceActionGateTarget
} from '@/shared/utils/invite';

import {
    normalizeFriendsLocationId as normalizeId,
    resolvePresenceLocation
} from './friendsLocationsRows';
import { useFriendsLocationsActions } from './useFriendsLocationsActions';
import { useFriendsLocationsPageDerivedState } from './useFriendsLocationsPageDerivedState';
import { useFriendsLocationsPreferences } from './useFriendsLocationsPreferences';
import { useFriendsLocationsRosterState } from './useFriendsLocationsRosterState';
import { useFriendsLocationsRuntime } from './useFriendsLocationsRuntime';

type GateFriendRecord = Record<string, unknown> & {
    id?: unknown;
    state?: unknown;
    stateBucket?: unknown;
    userId?: unknown;
};

function stringField(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function isGateFriendRecord(value: unknown): value is GateFriendRecord {
    return Boolean(value && typeof value === 'object');
}

function buildLocationGateTarget(
    friend: unknown,
    currentUserId?: string | null
): LocalInstanceActionGateTarget | null {
    if (!isGateFriendRecord(friend)) {
        return null;
    }
    const location = resolvePresenceLocation(friend);
    if (!location) {
        return null;
    }
    const userId = normalizeId(friend.id || friend.userId);
    return {
        key: location,
        userId,
        location,
        stateBucket: stringField(friend.stateBucket || friend.state),
        isCurrentUser: userId === normalizeId(currentUserId)
    };
}

export function useFriendsLocationsPageController() {
    const runtime = useFriendsLocationsRuntime();
    const roster = useFriendsLocationsRosterState();
    const [activeSegment, setActiveSegment] = useState('online');
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedFavoriteGroups, setCollapsedFavoriteGroups] = useState<
        Set<string>
    >(() => new Set<string>());
    const {
        changeDensityPreference,
        changeShowSameInstanceInOnline,
        density,
        preferencesReady,
        showSameInstanceInOnline,
        sidebarFavoritePrefs,
        sidebarSortMethods
    } = useFriendsLocationsPreferences();
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const {
        resetScrollTop,
        viewportMetrics: scrollMetrics,
        viewportRef: scrollRef
    } = useScrollViewportMetrics();

    useEffect(() => {
        resetScrollTop();
    }, [
        activeSegment,
        deferredSearchQuery,
        resetScrollTop,
        showSameInstanceInOnline
    ]);

    const derived = useFriendsLocationsPageDerivedState({
        activeIds: roster.activeIds,
        activeSegment,
        collapsedFavoriteGroups,
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
        showSameInstanceInOnline,
        sidebarFavoritePrefs,
        sidebarSortMethods
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
        currentEndpoint: runtime.currentEndpoint,
        currentInviteLocation: derived.currentInviteLocation,
        currentUserId: runtime.currentUserId ?? '',
        setCollapsedFavoriteGroups,
        instanceActionGatesByLocation
    });
    const isError = roster.rosterStatus === 'error';

    return {
        actions,
        filters: {
            activeSegment,
            searchQuery,
            setActiveSegment,
            setSearchQuery
        },
        preferences: {
            changeDensityPreference,
            changeShowSameInstanceInOnline,
            density,
            preferencesReady,
            showSameInstanceInOnline
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
