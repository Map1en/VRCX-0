import {
    QueriesObserver,
    useQueryClient,
    type QueryClient
} from '@tanstack/react-query';
import {
    startTransition,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';

import { toMutualFriendAvatar } from '@/components/mutual-friends/MutualFriendAvatars';
import {
    dominantMutualFriendCommunity,
    mutualFriendIdsOf,
    namedCommunityOf,
    summarizeRoomMutualCircles
} from '@/lib/mutual-friends/mutualFriendsStrangers';
import type { MutualFriendCommunity } from '@/lib/mutual-friends/mutualFriendsTypes';
import { useMutualFriendGraphContext } from '@/lib/mutual-friends/useMutualFriendGraphContext';
import { userMutualFriendsQueryOptions } from '@/lib/mutual-friends/useUserMutualFriends';
import type { UserMutualFriendRow } from '@/repositories/userProfileRepository';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRoomMutualScanStore } from '@/state/roomMutualScanStore';

import type { PlayerListMutuals, PlayerListRow } from './playerListTypes';

const CELL_AVATAR_LIMIT = 3;

const STRANGER_STATE_FLUSH_MS = 250;

type RoomScan = { context: string; ids: string[] };

type StrangerStates = {
    ids: readonly string[];
    byId: ReadonlyMap<
        string,
        {
            data: UserMutualFriendRow[] | undefined;
            isError: boolean;
            isFetching: boolean;
        }
    >;
};

function readStrangerStates(
    queryClient: QueryClient,
    ids: readonly string[]
): StrangerStates {
    return {
        ids,
        byId: new Map(
            ids.map((userId) => {
                const state = queryClient.getQueryState(
                    userMutualFriendsQueryOptions(userId).queryKey
                );
                return [
                    userId,
                    {
                        data: state?.data,
                        isError: state?.status === 'error',
                        isFetching: state?.fetchStatus === 'fetching'
                    }
                ];
            })
        )
    };
}

function useStrangerStates(ids: readonly string[]) {
    const queryClient = useQueryClient();
    const [snapshot, setSnapshot] = useState(() =>
        readStrangerStates(queryClient, ids)
    );
    const flushNowRef = useRef(() => {});

    useEffect(() => {
        const observer = new QueriesObserver(
            queryClient,
            ids.map((userId) => ({
                ...userMutualFriendsQueryOptions(userId),
                enabled: false
            }))
        );
        let timer: ReturnType<typeof setTimeout> | null = null;
        const read = () => setSnapshot(readStrangerStates(queryClient, ids));
        const flush = () => {
            timer = null;
            startTransition(read);
        };
        flushNowRef.current = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            read();
        };
        flush();
        const unsubscribe = observer.subscribe(() => {
            timer ??= setTimeout(flush, STRANGER_STATE_FLUSH_MS);
        });
        return () => {
            unsubscribe();
            flushNowRef.current = () => {};
            if (timer) {
                clearTimeout(timer);
            }
        };
    }, [ids, queryClient]);

    const flushNow = useCallback(() => flushNowRef.current(), []);

    return {
        byId:
            snapshot.ids === ids
                ? snapshot.byId
                : readStrangerStates(queryClient, ids).byId,
        flushNow
    };
}

export function usePlayerListMutuals(
    location: string,
    rows: readonly PlayerListRow[]
) {
    const queryClient = useQueryClient();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const roomScanRunning = useRoomMutualScanStore((state) => state.running);
    const [scan, setScan] = useState<RoomScan | null>(null);
    const [completedContext, setCompletedContext] = useState<string | null>(
        null
    );
    const [shownContext, setShownContext] = useState<string | null>(null);
    const scanRef = useRef<RoomScan | null>(null);
    const activeScan = scan?.context === location ? scan : null;
    const scanCompleted = completedContext === location;
    const columnVisible = shownContext === location;
    const graph = useMutualFriendGraphContext(
        columnVisible || Boolean(activeScan) || scanCompleted,
        { withCommunities: true }
    );

    const strangerIdsKey = [
        ...new Set(
            rows
                .filter(
                    (row) => row.userId && !row.isFriend && !row.isCurrentUser
                )
                .map((row) => row.userId)
        )
    ].join('\n');
    const strangerIds = useMemo(
        () => (strangerIdsKey ? strangerIdsKey.split('\n') : []),
        [strangerIdsKey]
    );
    const { byId: strangerStateById, flushNow: flushStrangerStates } =
        useStrangerStates(strangerIds);

    const mutualsByUserId = useMemo(() => {
        const readyMutuals = (
            count: number,
            ids: readonly string[],
            source: ReadonlyMap<string, UserMutualFriendRow>,
            community: MutualFriendCommunity | null
        ): PlayerListMutuals => ({
            status: 'ready',
            count,
            friends: ids
                .slice(0, CELL_AVATAR_LIMIT)
                .map((id) =>
                    toMutualFriendAvatar(id, friendsById[id] ?? source.get(id))
                ),
            community
        });
        const result = new Map<string, PlayerListMutuals>();
        for (const row of rows) {
            if (!row.userId || row.isCurrentUser) {
                continue;
            }
            if (row.isFriend) {
                const node = graph.nodeById.get(row.userId);
                result.set(
                    row.userId,
                    !node?.lastFetchedAt
                        ? { status: 'idle' }
                        : node.optedOut
                          ? { status: 'unavailable' }
                          : readyMutuals(
                                node.mutualCount,
                                graph.snapshot.get(row.userId) ?? [],
                                new Map(),
                                namedCommunityOf(
                                    graph.communityIndexById.get(row.userId),
                                    graph.communities
                                )
                            )
                );
                continue;
            }
            const state = strangerStateById.get(row.userId);
            if (state?.data) {
                const ids = mutualFriendIdsOf(state.data);
                result.set(
                    row.userId,
                    readyMutuals(
                        state.data.length,
                        ids,
                        new Map(state.data.map((entry) => [entry.id, entry])),
                        dominantMutualFriendCommunity(
                            ids,
                            graph.communityIndexById,
                            graph.communities
                        )
                    )
                );
            } else {
                result.set(row.userId, {
                    status: state?.isFetching
                        ? 'loading'
                        : state?.isError
                          ? 'unavailable'
                          : 'idle'
                });
            }
        }
        return result;
    }, [
        friendsById,
        graph.communities,
        graph.communityIndexById,
        graph.nodeById,
        graph.snapshot,
        rows,
        strangerStateById
    ]);

    const enrichedRows = useMemo(
        () =>
            rows.map((row) => ({
                ...row,
                mutuals: mutualsByUserId.get(row.userId) ?? null
            })),
        [mutualsByUserId, rows]
    );

    const summary = useMemo(() => {
        if (!scanCompleted || !columnVisible) {
            return null;
        }
        const matched = strangerIds.flatMap((userId) => {
            const entry = mutualsByUserId.get(userId);
            return entry?.status === 'ready' && entry.count > 0 ? [entry] : [];
        });
        return {
            matchedCount: matched.length,
            circles: summarizeRoomMutualCircles(
                matched.map((entry) => entry.community)
            )
        };
    }, [columnVisible, mutualsByUserId, scanCompleted, strangerIds]);

    const pendingIds = strangerIds.filter((userId) => {
        const state = strangerStateById.get(userId);
        return !state?.data && !state?.isError;
    });
    const progress = activeScan
        ? {
              total: activeScan.ids.length,
              done: activeScan.ids.filter((userId) => {
                  const state = strangerStateById.get(userId);
                  return Boolean(
                      state &&
                      !state.isFetching &&
                      (state.data || state.isError)
                  );
              }).length
          }
        : null;
    const canStart =
        !roomScanRunning &&
        !graph.isGraphFetching &&
        (pendingIds.length > 0 || !columnVisible);

    const stopScan = useCallback(() => {
        const current = scanRef.current;
        if (!current) {
            return;
        }
        scanRef.current = null;
        for (const userId of current.ids) {
            void queryClient.cancelQueries({
                queryKey: userMutualFriendsQueryOptions(userId).queryKey
            });
        }
        setScan(null);
        useRoomMutualScanStore.getState().setRunning(false);
    }, [queryClient]);

    useEffect(() => stopScan, [location, stopScan]);

    function startScan() {
        if (scanRef.current || !canStart) {
            return;
        }
        if (!pendingIds.length) {
            setShownContext(location);
            setCompletedContext(location);
            return;
        }
        const nextScan = { context: location, ids: pendingIds };
        scanRef.current = nextScan;
        setScan(nextScan);
        setShownContext(location);
        useRoomMutualScanStore.getState().setRunning(true);
        void Promise.allSettled(
            nextScan.ids.map((userId) =>
                queryClient.fetchQuery(userMutualFriendsQueryOptions(userId))
            )
        ).then(() => {
            if (scanRef.current !== nextScan) {
                return;
            }
            scanRef.current = null;
            flushStrangerStates();
            setScan(null);
            setCompletedContext(nextScan.context);
            useRoomMutualScanStore.getState().setRunning(false);
        });
    }

    return {
        rows: enrichedRows,
        scan: {
            canStart,
            completed: scanCompleted,
            hasPending: pendingIds.length > 0,
            hide: () => setShownContext(null),
            show: () => setShownContext(location),
            visible: columnVisible,
            isGraphFetching: graph.isGraphFetching,
            needsGraphBuild:
                graph.needsGraphBuild && (Boolean(activeScan) || scanCompleted),
            progress,
            start: startScan,
            stop: stopScan,
            summary
        }
    };
}
