// @ts-nocheck
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useCurrentInstancePresence } from '@/domain/presence/useCurrentInstancePresence.js';
import { useScrollViewportMetrics } from '@/lib/useScrollViewportMetrics.js';
import {
    notificationRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import {
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { checkCanInviteSelf } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/location.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import {
    normalizeFriendsLocationId as normalizeId,
    resolveWorldDialogTarget
} from './friendsLocationsRows.js';
import { useFriendsLocationsPageActions } from './useFriendsLocationsPageActions.js';
import { useFriendsLocationsPageDerivedState } from './useFriendsLocationsPageDerivedState.js';
import { useFriendsLocationsPageEffects } from './useFriendsLocationsPageEffects.js';
import { useFriendsLocationsPreferences } from './useFriendsLocationsPreferences.js';

const EMPTY_CURRENT_LOCATION_PLAYER_IDS = Object.freeze([]);
export function useFriendsLocationsPageController({ embedded = false } = {}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const currentLocationPlayerIds = useRuntimeStore(
        (state) => state.gameState.currentLocationPlayerIds
    );
    const domainCurrentInstancePresence = useCurrentInstancePresence();
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const effectiveCurrentLocationPlayerIds =
        currentLocationPlayerIds && currentLocationPlayerIds.length
            ? currentLocationPlayerIds
            : domainCurrentInstancePresence?.userIds ||
              EMPTY_CURRENT_LOCATION_PLAYER_IDS;
    const gameState = useMemo(
        () => ({
            currentLocation: runtimeCurrentLocation,
            currentDestination: runtimeCurrentDestination,
            currentLocationPlayerIds: effectiveCurrentLocationPlayerIds,
            isGameRunning
        }),
        [
            effectiveCurrentLocationPlayerIds,
            isGameRunning,
            runtimeCurrentDestination,
            runtimeCurrentLocation
        ]
    );
    const isFavoritesLoaded = useSessionStore(
        (state) => state.isFavoritesLoaded
    );
    const rosterStatus = useFriendRosterStore((state) => state.loadStatus);
    const rosterDetail = useFriendRosterStore((state) => state.detail);
    const onlineIds = useFriendRosterStore((state) => state.onlineIds);
    const activeIds = useFriendRosterStore((state) => state.activeIds);
    const offlineIds = useFriendRosterStore((state) => state.offlineIds);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore(
        (state) => state.groupedFavoriteFriendIdsByGroupKey
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const [activeSegment, setActiveSegment] = useState('online');
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedFavoriteGroups, setCollapsedFavoriteGroups] = useState(
        () => new Set()
    );
    const {
        changeDensityPreference,
        changeShowSameInstance,
        density,
        showSameInstance,
        sidebarFavoritePrefs,
        sidebarSortMethods
    } = useFriendsLocationsPreferences();
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const {
        resetScrollTop,
        viewportMetrics: scrollMetrics,
        viewportRef: scrollRef
    } = useScrollViewportMetrics();
    useFriendsLocationsPageEffects({
        activeSegment,
        deferredSearchQuery,
        resetScrollTop,
        setActiveSegment,
        showSameInstance
    });
    const {
        cardGridColumns,
        cardGridGap,
        cardGridMinWidth,
        cardGridRowHeight,
        canInviteFromCurrentLocation,
        canSendInvite,
        currentInviteLocation,
        densityConfig,
        friendsMap,
        hasVisibleSections,
        isLoading,
        positionedRows,
        segmentOptions,
        visibleVirtualRows
    } = useFriendsLocationsPageDerivedState({
        activeIds,
        activeSegment,
        collapsedFavoriteGroups,
        currentUserId,
        currentUserSnapshot,
        deferredSearchQuery,
        density,
        favoriteFriendGroups,
        friendsById,
        gameState,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavoriteGroups,
        localFriendFavorites,
        offlineIds,
        onlineIds,
        remoteFavoriteFriendIds,
        rosterStatus,
        scrollMetrics,
        showSameInstance,
        sidebarFavoritePrefs,
        sidebarSortMethods
    });
    const canBoop = Boolean(currentUserSnapshot?.isBoopingEnabled);
    const {
        toggleFavoriteGroup,
        canUseFriendLocation,
        launchFriendLocation,
        selfInviteFriendLocation,
        sendFriendInvite,
        requestFriendInvite,
        sendFriendBoop,
        openSectionWorld,
        openSectionGroup,
        openFriendUser,
        openFriendWorld,
        openFriendGroup
    } = useFriendsLocationsPageActions({
        canInviteFromCurrentLocation,
        checkCanInviteSelf,
        confirm,
        currentEndpoint,
        currentInviteLocation,
        currentUserId,
        friendsMap,
        normalizeId,
        notificationRepository,
        openGroupDialog,
        openUserDialog,
        openWorldDialog,
        parseLocation,
        prompt,
        resolveWorldDialogTarget,
        selfInviteToInstance,
        setCollapsedFavoriteGroups,
        t,
        toast,
        tryOpenLaunchLocation,
        vrchatSearchRepository
    });
    const isError = rosterStatus === 'error';
    return {
        embedded,
        activeSegment,
        segmentOptions,
        searchQuery,
        showSameInstance,
        density,
        setActiveSegment,
        setSearchQuery,
        changeShowSameInstance,
        changeDensityPreference,
        scrollRef,
        isLoading,
        isError,
        hasVisibleSections,
        rosterDetail,
        isFavoritesLoaded,
        positionedRows,
        visibleVirtualRows,
        cardGridGap,
        cardGridMinWidth,
        cardGridColumns,
        cardGridRowHeight,
        densityConfig,
        currentUserId,
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
    };
}
