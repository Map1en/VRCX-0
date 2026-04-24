import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const gameState = useMemo(
        () => ({
            currentLocation: runtimeCurrentLocation,
            currentDestination: runtimeCurrentDestination,
            currentLocationPlayerIds,
            isGameRunning
        }),
        [
            currentLocationPlayerIds,
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
        cardScale,
        changeCardScalePreference,
        changeShowSameInstance,
        changeSpacingScalePreference,
        showSameInstance,
        sidebarFavoritePrefs,
        sidebarSortMethods,
        spacingScale
    } = useFriendsLocationsPreferences();
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const scrollRef = useRef(null);
    const [scrollMetrics, setScrollMetrics] = useState({
        scrollTop: 0,
        viewportHeight: 0,
        width: 0
    });
    useFriendsLocationsPageEffects({
        ResizeObserver,
        activeSegment,
        deferredSearchQuery,
        scrollRef,
        setActiveSegment,
        setScrollMetrics,
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
        friendsMap,
        hasVisibleSections,
        isLoading,
        positionedRows,
        segmentOptions,
        visibleVirtualRows
    } = useFriendsLocationsPageDerivedState({
        activeIds,
        activeSegment,
        cardScale,
        collapsedFavoriteGroups,
        currentUserId,
        currentUserSnapshot,
        deferredSearchQuery,
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
        sidebarSortMethods,
        spacingScale
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
        cardScale,
        spacingScale,
        setActiveSegment,
        setSearchQuery,
        changeShowSameInstance,
        changeCardScalePreference,
        changeSpacingScalePreference,
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
