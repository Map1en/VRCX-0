import {
    useCallback,
    useDeferredValue,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';

import { useTodayDate } from '@/lib/useTodayDate';
import configRepository from '@/repositories/configRepository';
import { GAME_LOG_FILTER_TYPES } from '@/repositories/gameLogRepository';

import {
    GAME_LOG_SESSION_FILTER_TYPES,
    type GameLogFilterType,
    type GameLogViewMode
} from './gameLogTypes';

function normalizeFilters(
    filters: unknown,
    allowedFilters: readonly string[]
): GameLogFilterType[] {
    if (!Array.isArray(filters)) {
        return [];
    }
    return filters.filter(
        (entry): entry is string =>
            typeof entry === 'string' && allowedFilters.includes(entry)
    );
}

function normalizeViewMode(value: unknown): GameLogViewMode {
    return value === 'sessions' || value === 'table' ? value : 'table';
}

export function useGameLogFilters() {
    const preferencesReadyRef = useRef(false);
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [refreshToken, setRefreshToken] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchDraft, setSearchDraft] = useState('');
    const [tableSelectedTypes, setTableSelectedTypes] = useState<
        GameLogFilterType[]
    >([]);
    const [sessionSelectedTypes, setSessionSelectedTypes] = useState<
        GameLogFilterType[]
    >([]);
    const [tableFavoritesOnly, setTableFavoritesOnly] = useState(false);
    const [sessionFavoritesOnly, setSessionFavoritesOnly] = useState(false);
    const [sessionDateFrom, setSessionDateFrom] = useState('');
    const [sessionDateTo, setSessionDateTo] = useState('');
    const [viewMode, setViewMode] = useState<GameLogViewMode>('sessions');
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const todayDate = useTodayDate();

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getString('gameLogTableFilters', '[]'),
            configRepository.getBool('VRCX_gameLogTableVIPFilter', false),
            configRepository.getString('gameLogSessionsFilters', '[]'),
            configRepository.getBool('VRCX_gameLogSessionsVIPFilter', false),
            configRepository.getString('gameLogSessionsDateFrom', ''),
            configRepository.getString('gameLogSessionsDateTo', ''),
            configRepository.getString('gameLogViewMode', 'sessions')
        ])
            .then(
                ([
                    nextTableTypeFilters,
                    nextTableFavoritesOnly,
                    nextSessionTypeFilters,
                    nextSessionFavoritesOnly,
                    nextSessionDateFrom,
                    nextSessionDateTo,
                    nextViewMode
                ]) => {
                    if (!active) {
                        return;
                    }
                    setTableSelectedTypes(
                        normalizeFilters(
                            safeParse(nextTableTypeFilters),
                            GAME_LOG_FILTER_TYPES
                        )
                    );
                    setSessionSelectedTypes(
                        normalizeFilters(
                            safeParse(nextSessionTypeFilters),
                            GAME_LOG_SESSION_FILTER_TYPES
                        )
                    );
                    setTableFavoritesOnly(Boolean(nextTableFavoritesOnly));
                    setSessionFavoritesOnly(Boolean(nextSessionFavoritesOnly));
                    setSessionDateFrom(String(nextSessionDateFrom || ''));
                    setSessionDateTo(String(nextSessionDateTo || ''));
                    setViewMode(normalizeViewMode(nextViewMode));
                    preferencesReadyRef.current = true;
                    setPreferencesReady(true);
                }
            )
            .catch(() => {
                if (active) {
                    preferencesReadyRef.current = true;
                    setPreferencesReady(true);
                }
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }
        configRepository.setString(
            'VRCX_gameLogTableFilters',
            JSON.stringify(tableSelectedTypes)
        );
    }, [tableSelectedTypes]);

    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }
        configRepository.setBool(
            'VRCX_gameLogTableVIPFilter',
            tableFavoritesOnly
        );
    }, [tableFavoritesOnly]);

    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }
        configRepository.setString(
            'VRCX_gameLogSessionsFilters',
            JSON.stringify(sessionSelectedTypes)
        );
    }, [sessionSelectedTypes]);

    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }
        configRepository.setBool(
            'VRCX_gameLogSessionsVIPFilter',
            sessionFavoritesOnly
        );
    }, [sessionFavoritesOnly]);

    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }
        configRepository.setString(
            'VRCX_gameLogSessionsDateFrom',
            sessionDateFrom
        );
    }, [sessionDateFrom]);

    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }
        configRepository.setString('VRCX_gameLogSessionsDateTo', sessionDateTo);
    }, [sessionDateTo]);

    useEffect(() => {
        setSearchDraft(searchQuery);
    }, [searchQuery]);

    const sessionDateRange = useMemo(
        () => ({
            from: sessionDateFrom ? new Date(sessionDateFrom) : null,
            to: sessionDateTo ? new Date(sessionDateTo) : null
        }),
        [sessionDateFrom, sessionDateTo]
    );

    const tableQueryFilterTypes = useMemo(
        () =>
            tableSelectedTypes.filter((type) =>
                (GAME_LOG_FILTER_TYPES as readonly string[]).includes(type)
            ),
        [tableSelectedTypes]
    );
    const sessionQueryFilterTypes = useMemo(
        () =>
            sessionSelectedTypes.filter((type) =>
                (GAME_LOG_SESSION_FILTER_TYPES as readonly string[]).includes(
                    type
                )
            ),
        [sessionSelectedTypes]
    );
    const availableFilterTypes =
        viewMode === 'sessions'
            ? GAME_LOG_SESSION_FILTER_TYPES
            : GAME_LOG_FILTER_TYPES;
    const queryFilterTypes =
        viewMode === 'sessions'
            ? sessionQueryFilterTypes
            : tableQueryFilterTypes;
    const favoritesOnly =
        viewMode === 'sessions' ? sessionFavoritesOnly : tableFavoritesOnly;

    const setActiveSelectedTypes = useCallback(
        (nextTypes: GameLogFilterType[]) => {
            if (viewMode === 'sessions') {
                setSessionSelectedTypes(nextTypes);
                return;
            }
            setTableSelectedTypes(nextTypes);
        },
        [viewMode]
    );

    const changeViewMode = useCallback((nextViewMode: GameLogViewMode) => {
        setViewMode(nextViewMode);
        configRepository.setString('gameLogViewMode', nextViewMode);
    }, []);

    const toggleFavoritesOnly = useCallback(() => {
        if (viewMode === 'sessions') {
            setSessionFavoritesOnly((current) => !current);
            return;
        }
        setTableFavoritesOnly((current) => !current);
    }, [viewMode]);

    const commitSearchDraft = useCallback(() => {
        setSearchQuery(searchDraft);
    }, [searchDraft]);

    const clearSearch = useCallback(() => {
        setSearchDraft('');
        setSearchQuery('');
    }, []);

    const setSessionDateTimeRange = useCallback(
        (value: { from: Date | null; to: Date | null }) => {
            if (!value.from) {
                setSessionDateFrom('');
                setSessionDateTo('');
                return;
            }
            setSessionDateFrom(value.from.toISOString());
            setSessionDateTo((value.to || value.from).toISOString());
        },
        []
    );

    const refreshGameLog = useCallback(() => {
        setRefreshToken((value) => value + 1);
    }, []);

    return {
        availableFilterTypes,
        deferredSearchQuery,
        favoritesOnly,
        preferencesReady,
        queryFilterTypes,
        refreshToken,
        searchDraft,
        sessionDateFrom,
        sessionDateRange,
        sessionDateTo,
        sessionFavoritesOnly,
        sessionSelectedTypes,
        tableFavoritesOnly,
        tableSelectedTypes,
        todayDate,
        viewMode,
        changeViewMode,
        clearSearch,
        commitSearchDraft,
        refreshGameLog,
        setActiveSelectedTypes,
        setSearchDraft,
        setSessionDateTimeRange,
        toggleFavoritesOnly
    };
}

function safeParse(value: unknown) {
    if (typeof value !== 'string') {
        return [];
    }
    try {
        return JSON.parse(value);
    } catch {
        return [];
    }
}
