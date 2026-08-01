import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { bootstrapFriendRoster } from '@/services/friendBootstrapService';
import {
    cancelMutualGraphFetch,
    startMutualGraphFetch
} from '@/services/mutualGraphFetchService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { MutualFriendsFetchProgress } from './mutualFriendsTypes';

interface GraphFetchOptions {
    currentUserId: string;
    reloadSnapshot: (detail: string, ownerUserId: string) => Promise<void>;
    setDetail: (detail: string) => void;
}

function readMutualGraphFriendIds(ownerUserId: string): string[] {
    const roster = useFriendRosterStore.getState();
    if (roster.currentUserId !== ownerUserId) {
        return [];
    }

    return roster.orderedFriendIds
        .map((friendId) => roster.friendsById[friendId]?.id)
        .filter((friendId): friendId is string => Boolean(friendId));
}

export function useMutualFriendsGraphFetch({
    currentUserId,
    reloadSnapshot,
    setDetail
}: GraphFetchOptions) {
    const { t } = useTranslation();
    const lastHandledRunRef = useRef(0);
    const startRequestScopeRef = useRef('');
    const statusRunId = useRuntimeStore((state) => state.mutualGraph.runId);
    const statusName = useRuntimeStore((state) => state.mutualGraph.status);
    const statusOwnerUserId = useRuntimeStore(
        (state) => state.mutualGraph.ownerUserId
    );
    const processedFriends = useRuntimeStore(
        (state) => state.mutualGraph.processedFriends
    );
    const totalFriends = useRuntimeStore(
        (state) => state.mutualGraph.totalFriends
    );
    const cancelRequested = useRuntimeStore(
        (state) => state.mutualGraph.cancelRequested
    );
    const lastError = useRuntimeStore((state) => state.mutualGraph.lastError);

    const isCurrentUserFetch =
        !statusOwnerUserId || statusOwnerUserId === currentUserId;
    const isFetching =
        isCurrentUserFetch &&
        (statusName === 'running' || statusName === 'cancelling');
    const fetchProgress = useMemo<MutualFriendsFetchProgress>(
        () => ({
            isFetching,
            processedFriends: isCurrentUserFetch ? processedFriends : 0,
            totalFriends: isCurrentUserFetch ? totalFriends : 0,
            cancelRequested: cancelRequested || statusName === 'cancelling'
        }),
        [
            cancelRequested,
            isCurrentUserFetch,
            isFetching,
            processedFriends,
            statusName,
            totalFriends
        ]
    );

    useEffect(() => {
        if (
            !isCurrentUserFetch ||
            !statusRunId ||
            statusRunId === lastHandledRunRef.current
        ) {
            return;
        }

        if (statusName === 'completed') {
            lastHandledRunRef.current = statusRunId;
            reloadSnapshot('', statusOwnerUserId).catch((error: unknown) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.charts.toast.failed_to_fetch_mutual_friends_graph'
                          )
                );
            });
            return;
        }

        if (statusName === 'cancelled') {
            lastHandledRunRef.current = statusRunId;
            return;
        }

        if (statusName === 'error') {
            lastHandledRunRef.current = statusRunId;
            setDetail(
                lastError ||
                    t('view.charts.toast.failed_to_fetch_mutual_friends_graph')
            );
        }
    }, [
        isCurrentUserFetch,
        lastError,
        reloadSnapshot,
        setDetail,
        statusName,
        statusOwnerUserId,
        statusRunId,
        t
    ]);

    async function handleFetchGraph() {
        const runtimeState = useRuntimeStore.getState();
        if (
            !currentUserId ||
            runtimeState.mutualGraph.status === 'running' ||
            runtimeState.mutualGraph.status === 'cancelling'
        ) {
            return;
        }
        const ownerUserId = currentUserId;
        const initialAuth = runtimeState.auth;
        if (initialAuth.currentUserId !== ownerUserId) {
            return;
        }
        const ownerEndpoint = initialAuth.currentUserEndpoint;
        const ownerWebsocket = initialAuth.currentUserWebsocket;
        const requestScope = `${ownerUserId}\u0000${ownerEndpoint}\u0000${ownerWebsocket}`;
        if (startRequestScopeRef.current === requestScope) {
            return;
        }
        startRequestScopeRef.current = requestScope;

        try {
            let friendIds = readMutualGraphFriendIds(ownerUserId);
            if (!friendIds.length) {
                await bootstrapFriendRoster({
                    userId: ownerUserId,
                    endpoint: ownerEndpoint,
                    websocket: ownerWebsocket,
                    currentUserSnapshot: initialAuth.currentUserSnapshot
                });

                const latestAuth = useRuntimeStore.getState().auth;
                if (
                    latestAuth.currentUserId !== ownerUserId ||
                    latestAuth.currentUserEndpoint !== ownerEndpoint ||
                    latestAuth.currentUserWebsocket !== ownerWebsocket
                ) {
                    return;
                }
                friendIds = readMutualGraphFriendIds(ownerUserId);
                if (!friendIds.length) {
                    toast.info(
                        t(
                            'view.charts.empty.no_friends_are_available_for_mutual_graph_fetching'
                        )
                    );
                    return;
                }
            }

            setDetail('');

            await startMutualGraphFetch({
                ownerUserId,
                endpoint: ownerEndpoint,
                friendIds
            });
            toast.info(t('view.charts.mutual_friend.prompt.message'));
        } catch (error) {
            const latestAuth = useRuntimeStore.getState().auth;
            if (
                latestAuth.currentUserId !== ownerUserId ||
                latestAuth.currentUserEndpoint !== ownerEndpoint ||
                latestAuth.currentUserWebsocket !== ownerWebsocket
            ) {
                return;
            }
            const message =
                error instanceof Error
                    ? error.message
                    : t(
                          'view.charts.toast.failed_to_fetch_mutual_friends_graph'
                      );
            setDetail(message);
            toast.error(message);
        } finally {
            if (startRequestScopeRef.current === requestScope) {
                startRequestScopeRef.current = '';
            }
        }
    }

    function handleCancelFetch() {
        if (!currentUserId) {
            return;
        }
        cancelMutualGraphFetch(currentUserId).catch((error: unknown) => {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.charts.toast.failed_to_fetch_mutual_friends_graph'
                      )
            );
        });
    }

    return {
        fetchProgress,
        handleCancelFetch,
        handleFetchGraph
    };
}
