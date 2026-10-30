import { useEffect, useMemo, useState } from 'react';

import { buildFavoriteIdSet } from '@/domain/favorites/favoriteIdSet';
import { applyFactDerivedFields } from '@/domain/friends/friendRosterFacts';
import {
    useFriendStatsById,
    useFriendStatsHydration
} from '@/lib/useFriendStats';
import { useKnownUserFacts } from '@/lib/useKnownUser';
import { commands, type ProfileBioOutput } from '@/platform/tauri/bindings';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    filterFriendListRows,
    type FriendListRow,
    normalizeFriendListId as normalizeId
} from './friendListRows';

function isPresent<T>(value: T | null | undefined): value is T {
    return value != null;
}

export function useFriendListRows({
    activeSearchFilterIds,
    favoritesOnly,
    searchQuery
}: {
    activeSearchFilterIds: Set<string>;
    favoritesOnly: boolean;
    searchQuery: string;
}) {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const isFavoritesLoaded = useSessionStore(
        (state) => state.isFavoritesLoaded
    );
    const friendLoadStatus = useFriendRosterStore((state) => state.loadStatus);
    const friendDetail = useFriendRosterStore((state) => state.detail);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const [userMemoById, setUserMemoById] = useState(
        () => new Map<string, string>()
    );
    const [userNoteById, setUserNoteById] = useState(
        () => new Map<string, string>()
    );
    const [profileBioById, setProfileBioById] = useState(
        () => new Map<string, ProfileBioOutput>()
    );
    const favoriteFriendIds = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );
    const factsById = useKnownUserFacts(orderedFriendIds);
    useFriendStatsHydration(true);
    const statsById = useFriendStatsById();
    const rosterRows = useMemo<FriendListRow[]>(
        () =>
            orderedFriendIds
                .map((friendId, index) => {
                    const rosterFriend = friendsById[friendId];
                    if (!rosterFriend) {
                        return null;
                    }
                    const stats = statsById[friendId];
                    const profileBio = profileBioById.get(friendId);
                    const friend: FriendListRow = {
                        ...applyFactDerivedFields(
                            rosterFriend,
                            factsById[friendId]
                        ),
                        ...(profileBio && {
                            bio: profileBio.bio,
                            bioLinks: profileBio.bioLinks
                        }),
                        $joinCount: stats?.joinCount,
                        $lastSeen: stats?.lastSeen,
                        $timeSpent: stats?.timeSpent,
                        $mutualCount: stats?.mutualCount,
                        $mutualOptedOut: stats?.mutualOptedOut
                    };
                    const friendNumber =
                        Number.parseInt(
                            String(
                                friend.$friendNumber ?? friend.friendNumber ?? 0
                            ),
                            10
                        ) || 0;
                    if (friendNumber > 0) {
                        return friend;
                    }
                    return {
                        ...friend,
                        friendNumber: index + 1,
                        $friendNumber: index + 1
                    };
                })
                .filter(isPresent),
        [friendsById, orderedFriendIds, factsById, profileBioById, statsById]
    );
    const filteredRows = useMemo(() => {
        return filterFriendListRows({
            rosterRows,
            favoritesOnly,
            favoriteFriendIds,
            searchQuery,
            activeSearchFilterIds,
            userMemoById,
            userNoteById
        });
    }, [
        activeSearchFilterIds,
        favoriteFriendIds,
        favoritesOnly,
        rosterRows,
        searchQuery,
        userMemoById,
        userNoteById
    ]);

    useEffect(() => {
        let active = true;
        Promise.all([
            memoPersistenceRepository.getAllUserMemos(),
            memoPersistenceRepository.getAllUserNotes(currentUserId)
        ])
            .then(([memoRows, noteRows]) => {
                if (!active) {
                    return;
                }
                const nextMemos = new Map<string, string>();
                for (const row of memoRows) {
                    const userId = normalizeId(row.userId);
                    if (userId) {
                        nextMemos.set(userId, row.memo);
                    }
                }
                const nextNotes = new Map<string, string>();
                for (const row of noteRows) {
                    const userId = normalizeId(row.userId);
                    if (userId) {
                        nextNotes.set(userId, row.note);
                    }
                }
                setUserMemoById(nextMemos);
                setUserNoteById(nextNotes);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [currentUserId]);

    useEffect(() => {
        let active = true;
        if (!currentUserId) {
            setProfileBioById(new Map());
            return undefined;
        }
        commands
            .appFriendProfileBioList(currentUserId)
            .then((rows) => {
                if (active) {
                    setProfileBioById(
                        new Map(rows.map((row) => [row.userId, row]))
                    );
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [currentUserId]);

    return {
        currentUserId,
        currentUserSnapshot,
        filteredRows,
        friendDetail,
        friendLoadStatus,
        friendsById,
        isFavoritesLoaded,
        rosterRows
    };
}
