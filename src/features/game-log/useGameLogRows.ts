import {
    useCallback,
    useEffect,
    useEffectEvent,
    useMemo,
    useRef,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';

import {
    getGameLogRowKey,
    mergeGameLogSessionHead
} from '@/components/game-log/gameLogRows';
import {
    GAME_LOG_LIVE_REFRESH_THROTTLE_MS,
    GAME_LOG_SESSION_HEAD_QUERY_LIMIT
} from '@/components/game-log/gameLogTypes';
import type {
    GameLogLoadStatus,
    GameLogRow,
    GameLogSession,
    GameLogViewMode
} from '@/components/game-log/gameLogTypes';
import { buildFavoriteIdSet } from '@/domain/favorites/favoriteIdSet';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { useThrottledValue } from '@/lib/useThrottledValue';
import gameLogRepository, {
    type GameLogFilterType
} from '@/repositories/gameLogRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

type GameLogSessionQuery = NonNullable<
    Parameters<typeof gameLogRepository.queryLatestSessions>[0]
>;

function isGameLogRow(value: unknown): value is GameLogRow {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

type UseGameLogRowsOptions = {
    deferredSearchQuery: string;
    favoritesOnly: boolean;
    filters: readonly GameLogFilterType[];
    preferencesReady: boolean;
    refreshToken: number;
    sessionDateFrom: string;
    sessionDateTo: string;
    sessionLimit: number;
    viewMode: GameLogViewMode;
};

export function useGameLogRows({
    deferredSearchQuery,
    favoritesOnly,
    filters,
    preferencesReady,
    refreshToken,
    sessionDateFrom,
    sessionDateTo,
    sessionLimit,
    viewMode
}: UseGameLogRowsOptions) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const addGameLogEventCount = useRuntimeStore(
        (state) => state.runtimeEvents.addGameLogEvent.count
    );
    const throttledGameLogEventCount = useThrottledValue(
        addGameLogEventCount,
        GAME_LOG_LIVE_REFRESH_THROTTLE_MS
    );
    const gameLogDisabled = usePreferencesStore(
        (state) => state.gameLogDisabled
    );
    const isFavoritesLoaded = useSessionStore(
        (state) => state.isFavoritesLoaded
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const favoriteIdSet = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );
    const requestIdRef = useRef(0);
    const [rows, setRows] = useState<GameLogRow[]>([]);
    const [sessions, setSessions] = useState<GameLogSession[]>([]);
    const [loadStatus, setLoadStatus] = useState<GameLogLoadStatus>('idle');
    const [detail, setDetail] = useState('');
    const [liveReloadToken, setLiveReloadToken] = useState(0);
    const fullLoadRunningRef = useRef(false);
    const liveSessionQueryRef = useRef<GameLogSessionQuery | null>(null);
    const headRefreshQueuedRef = useRef(false);
    const headRefreshRunningRef = useRef(false);
    const seenLiveEventCountRef = useRef(throttledGameLogEventCount);

    const drainSessionHeadRefresh = useEffectEvent(() => {
        function drain() {
            if (
                !headRefreshQueuedRef.current ||
                fullLoadRunningRef.current ||
                headRefreshRunningRef.current
            ) {
                return;
            }
            headRefreshQueuedRef.current = false;
            const liveQuery = liveSessionQueryRef.current;
            if (!liveQuery) {
                return;
            }
            const requestId = requestIdRef.current;
            headRefreshRunningRef.current = true;
            void gameLogRepository
                .queryLatestSessions({
                    ...liveQuery,
                    limit: GAME_LOG_SESSION_HEAD_QUERY_LIMIT
                })
                .then((head) => {
                    if (requestIdRef.current !== requestId) {
                        return;
                    }
                    setSessions((current) =>
                        mergeGameLogSessionHead(
                            current,
                            head,
                            liveQuery.limit ?? current.length
                        )
                    );
                })
                .catch(() => {
                    if (requestIdRef.current === requestId) {
                        setLiveReloadToken((current) => current + 1);
                    }
                })
                .finally(() => {
                    headRefreshRunningRef.current = false;
                    drain();
                });
        }
        drain();
    });

    const handleLiveGameLogEvent = useEffectEvent(() => {
        if (viewMode === 'sessions' && loadStatus !== 'error') {
            headRefreshQueuedRef.current = true;
            drainSessionHeadRefresh();
            return;
        }
        setLiveReloadToken((current) => current + 1);
    });

    useEffect(() => {
        if (seenLiveEventCountRef.current === throttledGameLogEventCount) {
            return;
        }
        seenLiveEventCountRef.current = throttledGameLogEventCount;
        handleLiveGameLogEvent();
    }, [throttledGameLogEventCount]);

    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        fullLoadRunningRef.current = false;
        liveSessionQueryRef.current = null;
        if (!preferencesReady || !currentUserId) {
            if (!currentUserId) {
                setRows([]);
                setSessions([]);
                setLoadStatus('idle');
                setDetail(
                    t(
                        'view.game_log.empty.no_authenticated_user_is_available_for_the_game_log_snapshot'
                    )
                );
            }
            return;
        }
        if (favoritesOnly && !isFavoritesLoaded) {
            setRows([]);
            setSessions([]);
            setLoadStatus('idle');
            setDetail(
                t('view.game_log.description.favorites_are_still_hydrating')
            );
            return;
        }
        const favoriteUserIds = favoritesOnly ? Array.from(favoriteIdSet) : [];
        setLoadStatus('running');
        setDetail('');
        fullLoadRunningRef.current = true;
        const query = {
            currentUserId,
            search: deferredSearchQuery,
            filters,
            favoriteUserIds,
            dateFrom: viewMode === 'sessions' ? sessionDateFrom : '',
            dateTo: viewMode === 'sessions' ? sessionDateTo : '',
            limit: viewMode === 'sessions' ? sessionLimit : undefined
        };
        const loadRows = async () => {
            if (viewMode === 'sessions') {
                const nextSessions =
                    await gameLogRepository.queryLatestSessions(query);
                if (requestIdRef.current !== requestId) {
                    return;
                }
                liveSessionQueryRef.current = query;
                setSessions(nextSessions);
                setRows([]);
            } else {
                const nextRows = await gameLogRepository.queryGameLog(query);
                if (requestIdRef.current !== requestId) {
                    return;
                }
                setRows(
                    Array.isArray(nextRows) ? nextRows.filter(isGameLogRow) : []
                );
                setSessions([]);
            }
            setLoadStatus('ready');
            setDetail('');
        };
        void loadRows()
            .catch((error: unknown) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                setRows([]);
                setSessions([]);
                setLoadStatus('error');
                setDetail(
                    userFacingErrorMessage(
                        error,
                        t('view.game_log.error.game_log_failed_to_load')
                    )
                );
            })
            .finally(() => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                fullLoadRunningRef.current = false;
                drainSessionHeadRefresh();
            });
    }, [
        liveReloadToken,
        currentUserId,
        deferredSearchQuery,
        favoriteIdSet,
        favoritesOnly,
        filters,
        isFavoritesLoaded,
        preferencesReady,
        refreshToken,
        sessionDateFrom,
        sessionDateTo,
        sessionLimit,
        t,
        viewMode
    ]);

    const removeRowByKey = useCallback((rowKey: string) => {
        setRows((currentRows) =>
            currentRows.filter((entry) => getGameLogRowKey(entry) !== rowKey)
        );
    }, []);

    return {
        currentUserId,
        detail,
        gameLogDisabled,
        isFavoritesLoaded,
        loadStatus,
        rows,
        sessions,
        removeRowByKey
    };
}
