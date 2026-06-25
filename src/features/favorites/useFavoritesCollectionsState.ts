import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useKnownUserFacts } from '@/domain/users/useKnownUser';
import avatarCacheRepository from '@/repositories/avatarCacheRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import {
    buildFavoriteAvatarTags,
    buildFavoriteFriendFactIds,
    selectFavoritesCollectionsState
} from './favoritesCollectionsState';
import type { FavoriteKind } from './favoritesTypes';
import { useFavoriteRemoteDetails } from './useFavoriteRemoteDetails';

export function useFavoritesCollectionsState({
    currentEndpoint,
    currentUserId,
    kind
}: {
    currentEndpoint: string;
    currentUserId: string;
    kind: FavoriteKind;
}) {
    const favoriteSelector = useMemo(
        () => selectFavoritesCollectionsState(kind),
        [kind]
    );
    const favoriteState = useFavoriteStore(useShallow(favoriteSelector));
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const [avatarHistoryLoading, setAvatarHistoryLoading] = useState(false);
    const [avatarHistory, setAvatarHistory] = useState<any[]>([]);
    const [remoteDetailsRefreshToken, setRemoteDetailsRefreshToken] =
        useState(0);
    const friendsMap = useMemo(
        () => new Map(Object.entries(friendsById || {})),
        [friendsById]
    );
    const favoriteFriendFactIds = useMemo(
        () =>
            buildFavoriteFriendFactIds({
                groupedFavoriteFriendIdsByGroupKey:
                    favoriteState.groupedFavoriteFriendIdsByGroupKey,
                kind,
                localFriendFavorites: favoriteState.localFriendFavorites
            }),
        [
            favoriteState.groupedFavoriteFriendIdsByGroupKey,
            favoriteState.localFriendFavorites,
            kind
        ]
    );
    const knownFavoriteUsersById = useKnownUserFacts(favoriteFriendFactIds, {
        endpoint: currentEndpoint
    });
    const avatarTags = useMemo(
        () =>
            buildFavoriteAvatarTags({
                kind,
                remoteFavoritesById: favoriteState.remoteFavoritesById
            }),
        [favoriteState.remoteFavoritesById, kind]
    );
    const remoteEntityDetails = useFavoriteRemoteDetails({
        type: kind === 'avatar' ? 'avatar' : 'world',
        favoriteIds:
            kind === 'world'
                ? favoriteState.favoriteWorldIds
                : kind === 'avatar'
                  ? favoriteState.favoriteAvatarIds
                  : [],
        avatarTags,
        refreshToken: remoteDetailsRefreshToken,
        enabled:
            kind !== 'friend' &&
            favoriteState.favoriteLoadStatus === 'ready' &&
            (kind === 'world'
                ? favoriteState.favoriteWorldIds.length > 0
                : favoriteState.favoriteAvatarIds.length > 0)
    });

    useEffect(() => {
        let active = true;
        if (kind !== 'avatar' || !currentUserId) {
            setAvatarHistory([]);
            return () => {
                active = false;
            };
        }
        setAvatarHistoryLoading(true);
        avatarCacheRepository
            .getAvatarHistory(currentUserId, 100)
            .then((rows: any) => {
                if (active) {
                    setAvatarHistory(Array.isArray(rows) ? rows : []);
                }
            })
            .catch(() => {
                if (active) {
                    setAvatarHistory([]);
                }
            })
            .finally(() => {
                if (active) {
                    setAvatarHistoryLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [currentUserId, kind]);

    function refreshRemoteDetails() {
        setRemoteDetailsRefreshToken((value) => value + 1);
    }

    return {
        avatarHistory,
        avatarHistoryLoading,
        favoriteDetail: favoriteState.favoriteDetail,
        favoriteLoadStatus: favoriteState.favoriteLoadStatus,
        refreshRemoteDetails,
        remoteEntityDetails,
        setAvatarHistory,
        setAvatarHistoryLoading,
        actionInputs: {
            avatarHistoryLoading,
            friendsById,
            friendsMap,
            refreshRemoteDetails,
            setAvatarHistory,
            setAvatarHistoryLoading
        },
        viewDataInputs: {
            avatarHistory,
            favoriteAvatarGroups: favoriteState.favoriteAvatarGroups,
            favoriteFriendGroups: favoriteState.favoriteFriendGroups,
            favoriteWorldGroups: favoriteState.favoriteWorldGroups,
            favoritesSortOrder: favoriteState.favoritesSortOrder,
            friendsById,
            groupedFavoriteFriendIdsByGroupKey:
                favoriteState.groupedFavoriteFriendIdsByGroupKey,
            knownUsersById: knownFavoriteUsersById,
            localAvatarDetailsById: favoriteState.localAvatarDetailsById,
            localAvatarFavoriteGroups: favoriteState.localAvatarFavoriteGroups,
            localAvatarFavorites: favoriteState.localAvatarFavorites,
            localFriendFavoriteGroups: favoriteState.localFriendFavoriteGroups,
            localFriendFavorites: favoriteState.localFriendFavorites,
            localWorldDetailsById: favoriteState.localWorldDetailsById,
            localWorldFavoriteGroups: favoriteState.localWorldFavoriteGroups,
            localWorldFavorites: favoriteState.localWorldFavorites,
            remoteEntityDetails,
            remoteFavoritesById: favoriteState.remoteFavoritesById
        }
    };
}
