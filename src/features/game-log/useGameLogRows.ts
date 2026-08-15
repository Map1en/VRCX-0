import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { useThrottledValue } from '@/lib/useThrottledValue';
import gameLogRepository from '@/repositories/gameLogRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { buildGameLogFavoriteIdSet, getGameLogRowKey } from './gameLogRows';
import { GAME_LOG_LIVE_REFRESH_THROTTLE_MS } from './gameLogTypes';
import type {
    GameLogLoadStatus,
    GameLogRow,
    GameLogSession,
    GameLogViewMode
} from './gameLogTypes';

type UseGameLogRowsOptions = {
    deferredSearchQuery: string;
    favoritesOnly: boolean;
    filters: readonly string[];
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
        () =>
            buildGameLogFavoriteIdSet(
                remoteFavoriteFriendIds,
                localFriendFavorites
            ),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );
    const requestIdRef = useRef(0);
    const [rows, setRows] = useState<GameLogRow[]>([]);
    const [sessions, setSessions] = useState<GameLogSession[]>([]);
    const [loadStatus, setLoadStatus] = useState<GameLogLoadStatus>('idle');
    const [detail, setDetail] = useState('');

    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
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
        gameLogRepository[
            viewMode === 'sessions' ? 'queryLatestSessions' : 'queryGameLog'
        ]({
            currentUserId,
            search: deferredSearchQuery,
            filters,
            favoriteUserIds,
            dateFrom: viewMode === 'sessions' ? sessionDateFrom : '',
            dateTo: viewMode === 'sessions' ? sessionDateTo : '',
            limit: viewMode === 'sessions' ? sessionLimit : undefined
        })
            .then((nextResult: unknown) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                if (viewMode === 'sessions') {
                    setSessions(
                        Array.isArray(nextResult)
                            ? (nextResult as GameLogSession[])
                            : []
                    );
                    setRows([]);
                } else {
                    setRows(
                        Array.isArray(nextResult)
                            ? (nextResult as GameLogRow[])
                            : []
                    );
                    setSessions([]);
                }
                setLoadStatus('ready');
                setDetail('');
            })
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
            });
    }, [
        throttledGameLogEventCount,
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
