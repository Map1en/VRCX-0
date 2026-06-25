import { buildGameLogSessions, type GameLogRow } from '@/shared/utils/gameLog';
import { normalizeString } from '@/shared/utils/string';

import configRepository from './configRepository';
import gameLogPersistenceRepository from './gameLogPersistenceRepository';

export const GAME_LOG_FILTER_TYPES = Object.freeze([
    'Location',
    'OnPlayerJoined',
    'OnPlayerLeft',
    'PortalSpawn',
    'VideoPlay',
    'Event',
    'External',
    'StringLoad',
    'ImageLoad'
] as const);

const SESSION_EVENT_FILTER_TYPES = Object.freeze([
    'OnPlayerJoined',
    'OnPlayerLeft',
    'VideoPlay'
] as const);
const SESSION_GLOBAL_SEARCH_INITIAL_LOCATIONS = 500;

type GameLogFilterType = (typeof GAME_LOG_FILTER_TYPES)[number];
type SessionEventFilterType = (typeof SESSION_EVENT_FILTER_TYPES)[number];
type UnknownRecord = Record<string, unknown>;

interface GameLogMember extends UnknownRecord {
    displayName?: string;
    userId?: string;
}

interface GameLogEvent extends GameLogRow {
    type?: string;
    displayName?: string;
    userId?: string;
    videoName?: string;
    videoUrl?: string;
    videoId?: string;
    members?: GameLogMember[];
    count?: number;
    isFavorite?: boolean;
}

interface GameLogSession extends GameLogRow {
    created_at?: string;
    location?: string;
    worldId?: string;
    worldName?: string;
    groupName?: string;
    events?: GameLogEvent[];
}

interface GameLogLocationSegment extends GameLogRow {
    id?: string | number;
    created_at?: string;
    location?: string;
}

interface QueryGameLogInput {
    currentUserId?: unknown;
    search?: unknown;
    filters?: unknown;
    favoriteUserIds?: unknown;
}

interface QueryLatestSessionsInput extends QueryGameLogInput {
    dateFrom?: unknown;
    dateTo?: unknown;
    limit?: unknown;
}

interface SessionFilters {
    filters: GameLogFilterType[];
    favoriteUserIds: Set<string>;
    search?: unknown;
}

interface FilterSessionEventsOptions {
    eventFilters: SessionEventFilterType[];
    favoriteUserIds: Set<string>;
    searchQuery: string;
}

interface ResolveSessionFetchLimitInput {
    normalizedLimit: number;
    normalizedFilters: GameLogFilterType[];
    normalizedSearch: string;
    favoriteUserIds: Set<string>;
    maxTableSize: number;
    searchLimit: number;
}

function isRecord(value: unknown): value is UnknownRecord {
    return Boolean(value && typeof value === 'object');
}

function toGameLogRow(value: unknown): GameLogRow {
    return isRecord(value) ? value : {};
}

function normalizeFavoriteSet(favoriteUserIds: unknown = []) {
    return new Set(
        (Array.isArray(favoriteUserIds) ? favoriteUserIds : [])
            .map((value) => normalizeString(value))
            .filter(Boolean)
    );
}

function normalizeFilterList(filters: unknown = []): GameLogFilterType[] {
    if (!Array.isArray(filters)) {
        return [];
    }

    return filters.filter(
        (filter, index, source): filter is GameLogFilterType => {
            if (typeof filter !== 'string') {
                return false;
            }

            if (!GAME_LOG_FILTER_TYPES.includes(filter as GameLogFilterType)) {
                return false;
            }

            return source.indexOf(filter) === index;
        }
    );
}

function normalizeSessionLimit(value: unknown, fallback = 25) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(parsed, 1000);
}

function normalizeConfigInt(value: unknown, fallback: number) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return parsed;
}

function dateToEpoch(value: unknown) {
    const epoch = Date.parse(String(value ?? ''));
    return Number.isFinite(epoch) ? epoch : 0;
}

function normalizeDateBoundary(value: unknown, boundary: 'start' | 'end') {
    const normalized = normalizeString(value);
    if (!normalized) {
        return '';
    }

    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        if (boundary === 'end') {
            date.setHours(23, 59, 59, 999);
        } else {
            date.setHours(0, 0, 0, 0);
        }
    }

    return date.toISOString();
}

function getSessionEventFilterType(event: GameLogEvent): string {
    if (event?.type === 'JoinGroup') {
        return 'OnPlayerJoined';
    }
    if (event?.type === 'LeftGroup') {
        return 'OnPlayerLeft';
    }
    return event?.type || '';
}

function sessionEventMatchesType(
    event: GameLogEvent,
    filters: SessionEventFilterType[]
) {
    if (filters.length === 0) {
        return true;
    }

    return filters.includes(
        getSessionEventFilterType(event) as SessionEventFilterType
    );
}

function filterSessionEventByFavorite(
    event: GameLogEvent,
    favoriteUserIds: Set<string>
): GameLogEvent | null {
    if (favoriteUserIds.size === 0) {
        return event;
    }

    if (event?.type === 'VideoPlay') {
        return event;
    }

    const userId = normalizeString(event?.userId);
    if (userId && favoriteUserIds.has(userId)) {
        return event;
    }

    if (Array.isArray(event?.members)) {
        const members = event.members.filter((member) =>
            favoriteUserIds.has(normalizeString(member?.userId))
        );
        if (members.length > 0) {
            return {
                ...event,
                members,
                count: members.length
            };
        }
    }

    return null;
}

function sessionHeaderMatchesSearch(session: GameLogSession, query: string) {
    if (!query) {
        return true;
    }

    return [
        session?.created_at,
        session?.location,
        session?.worldId,
        session?.worldName,
        session?.groupName
    ].some((value) =>
        String(value || '')
            .toLowerCase()
            .includes(query)
    );
}

function sessionEventValueMatchesSearch(event: GameLogEvent, query: string) {
    if (!query) {
        return true;
    }

    return [
        event?.type,
        event?.displayName,
        event?.userId,
        event?.videoName,
        event?.videoUrl,
        event?.videoId
    ].some((value) =>
        String(value || '')
            .toLowerCase()
            .includes(query)
    );
}

function sessionMemberMatchesSearch(member: GameLogMember, query: string) {
    if (!query) {
        return true;
    }

    return [member?.displayName, member?.userId].some((value) =>
        String(value || '')
            .toLowerCase()
            .includes(query)
    );
}

function filterSessionEventBySearch(
    event: GameLogEvent,
    query: string
): GameLogEvent | null {
    if (!query) {
        return event;
    }

    if (sessionEventValueMatchesSearch(event, query)) {
        return event;
    }

    if (Array.isArray(event?.members)) {
        const members = event.members.filter((member) =>
            sessionMemberMatchesSearch(member, query)
        );
        if (members.length > 0) {
            return {
                ...event,
                members,
                count: members.length
            };
        }
    }

    return null;
}

function filterSessionEvents(
    session: GameLogSession,
    { eventFilters, favoriteUserIds, searchQuery }: FilterSessionEventsOptions
) {
    const filteredEvents: GameLogEvent[] = [];

    for (const event of session?.events ?? []) {
        if (!sessionEventMatchesType(event, eventFilters)) {
            continue;
        }

        const favoriteFilteredEvent = filterSessionEventByFavorite(
            event,
            favoriteUserIds
        );
        if (!favoriteFilteredEvent) {
            continue;
        }

        const searchFilteredEvent = filterSessionEventBySearch(
            favoriteFilteredEvent,
            searchQuery
        );
        if (!searchFilteredEvent) {
            continue;
        }

        filteredEvents.push(searchFilteredEvent);
    }

    return filteredEvents;
}

function normalizeSessionFilters(filters: GameLogFilterType[]) {
    const hasLocationFilter = filters.includes('Location');
    const eventFilters = filters.filter(
        (filter): filter is SessionEventFilterType =>
            SESSION_EVENT_FILTER_TYPES.includes(
                filter as SessionEventFilterType
            )
    );

    return {
        hasLocationFilter,
        hasUnsupportedOnlyFilter:
            filters.length > 0 &&
            !hasLocationFilter &&
            eventFilters.length === 0,
        eventFilters
    };
}

function filterSessions(
    sessions: unknown,
    { filters, favoriteUserIds, search }: SessionFilters
) {
    const searchQuery = String(search || '')
        .trim()
        .toLowerCase();
    const { hasLocationFilter, hasUnsupportedOnlyFilter, eventFilters } =
        normalizeSessionFilters(filters);

    if (hasUnsupportedOnlyFilter) {
        return [];
    }

    const sourceSessions = Array.isArray(sessions) ? sessions : [];

    return sourceSessions.reduce<GameLogSession[]>((result, session) => {
        const currentSession = toGameLogRow(session) as GameLogSession;
        const headerMatchesSearch = sessionHeaderMatchesSearch(
            currentSession,
            searchQuery
        );
        const nextEvents = filterSessionEvents(currentSession, {
            eventFilters,
            favoriteUserIds,
            searchQuery: headerMatchesSearch ? '' : searchQuery
        });
        const matchesFilter =
            filters.length === 0 || hasLocationFilter || nextEvents.length > 0;
        const matchesFavorites =
            favoriteUserIds.size === 0 || nextEvents.length > 0;
        const matchesSearch =
            !searchQuery || headerMatchesSearch || nextEvents.length > 0;

        if (matchesFilter && matchesFavorites && matchesSearch) {
            result.push({
                ...currentSession,
                events: nextEvents
            });
        }

        return result;
    }, []);
}

function resolveSessionFetchLimit({
    normalizedLimit,
    normalizedFilters,
    normalizedSearch,
    favoriteUserIds,
    maxTableSize,
    searchLimit
}: ResolveSessionFetchLimitInput) {
    const hasFiltering =
        Boolean(normalizedSearch) ||
        normalizedFilters.length > 0 ||
        favoriteUserIds.size > 0;

    if (!hasFiltering) {
        return normalizedLimit;
    }

    return Math.max(
        normalizedLimit,
        Math.min(
            Math.max(maxTableSize, normalizedLimit),
            Math.max(normalizedLimit, Math.min(searchLimit, 2000))
        )
    );
}

async function loadSessionEvents(
    locationSegments: unknown,
    favoriteUserIds: Set<string>
) {
    if (!Array.isArray(locationSegments) || locationSegments.length === 0) {
        return [];
    }

    const segments: GameLogLocationSegment[] = locationSegments
        .filter(isRecord)
        .map((segment) => segment as GameLogLocationSegment);

    const epochs = segments
        .map((segment) => dateToEpoch(segment?.created_at))
        .filter((epoch) => epoch > 0);
    const minEpoch = epochs.length ? Math.min(...epochs) : Date.now();
    const maxEpoch = epochs.length ? Math.max(...epochs) : Date.now();
    const dateWindowMs = 24 * 60 * 60 * 1000;
    const locationTags = Array.from(
        new Set(
            segments
                .map((segment) => normalizeString(segment?.location))
                .filter(Boolean)
        )
    );
    const events =
        await gameLogPersistenceRepository.getSessionsEventsForSegments(
            locationTags,
            new Date(minEpoch - dateWindowMs).toISOString(),
            new Date(maxEpoch + dateWindowMs).toISOString()
        );

    return events.map((event: unknown) => {
        const currentEvent = toGameLogRow(event) as GameLogEvent;
        const userId = normalizeString(currentEvent.userId);
        return {
            ...currentEvent,
            isFavorite: userId ? favoriteUserIds.has(userId) : false
        };
    });
}

async function queryGameLog({
    currentUserId = '',
    search = '',
    filters = [],
    favoriteUserIds = []
}: QueryGameLogInput) {
    const [maxTableSizeValue, searchLimitValue] = await Promise.all([
        configRepository.getInt('maxTableSize_v2', 500),
        configRepository.getInt('searchLimit', 50000)
    ]);
    const maxTableSize = normalizeConfigInt(maxTableSizeValue, 500);
    const searchLimit = normalizeConfigInt(searchLimitValue, 50000);

    const normalizedFilters = normalizeFilterList(filters);
    const normalizedFavorites = Array.from(
        new Set(
            (Array.isArray(favoriteUserIds) ? favoriteUserIds : [])
                .map((value) => normalizeString(value))
                .filter(Boolean)
        )
    );
    const normalizedSearch = String(search || '').trim();

    if (normalizedSearch) {
        return gameLogPersistenceRepository.searchGameLogDatabase(
            normalizedSearch,
            normalizedFilters,
            normalizedFavorites,
            searchLimit,
            normalizeString(currentUserId)
        );
    }

    return gameLogPersistenceRepository.lookupGameLogDatabase(
        normalizedFilters,
        normalizedFavorites,
        maxTableSize
    );
}

async function queryLatestSessions({
    search = '',
    filters = [],
    favoriteUserIds = [],
    dateFrom = '',
    dateTo = '',
    limit = 25
}: QueryLatestSessionsInput = {}) {
    const [maxTableSizeValue, searchLimitValue] = await Promise.all([
        configRepository.getInt('maxTableSize_v2', 500),
        configRepository.getInt('searchLimit', 50000)
    ]);
    const maxTableSize = normalizeConfigInt(maxTableSizeValue, 500);
    const searchLimit = normalizeConfigInt(searchLimitValue, 50000);
    const normalizedLimit = normalizeSessionLimit(limit);
    const normalizedFilters = normalizeFilterList(filters);
    const normalizedFavoriteSet = normalizeFavoriteSet(favoriteUserIds);
    const normalizedSearch = String(search || '').trim();
    const normalizedDateFrom = normalizeDateBoundary(dateFrom, 'start');
    const normalizedDateTo = normalizeDateBoundary(dateTo, 'end');
    const fetchLimit = resolveSessionFetchLimit({
        normalizedLimit,
        normalizedFilters,
        normalizedSearch,
        favoriteUserIds: normalizedFavoriteSet,
        maxTableSize,
        searchLimit
    });
    if (normalizedSearch && !normalizedDateFrom && !normalizedDateTo) {
        const fetchCount = SESSION_GLOBAL_SEARCH_INITIAL_LOCATIONS + 1;
        const allLocationSegments: GameLogRow[] = [];
        const allEvents: GameLogRow[] = [];
        let beforeId: unknown = null;
        let hasMore = true;
        let latestFiltered: GameLogSession[] = [];

        while (
            hasMore &&
            latestFiltered.length < normalizedLimit &&
            allLocationSegments.length < searchLimit
        ) {
            const batch =
                await gameLogPersistenceRepository.getSessionsLocationSegments(
                    beforeId,
                    fetchCount
                );
            if (!Array.isArray(batch) || batch.length === 0) {
                break;
            }

            const hasExtraTail = batch.length >= fetchCount;
            if (hasExtraTail) {
                batch.pop();
            }
            if (batch.length === 0) {
                break;
            }

            const batchEvents = await loadSessionEvents(
                batch,
                normalizedFavoriteSet
            );
            const batchRows = batch.map(toGameLogRow);
            allLocationSegments.push(...batchRows);
            allEvents.push(...batchEvents);
            beforeId = toGameLogRow(batch[batch.length - 1]).id;
            hasMore = hasExtraTail && allLocationSegments.length < searchLimit;

            const result = buildGameLogSessions(allLocationSegments, allEvents);
            latestFiltered = filterSessions(result.segments ?? [], {
                filters: normalizedFilters,
                favoriteUserIds: normalizedFavoriteSet,
                search: normalizedSearch
            }).slice(0, normalizedLimit);
        }

        return latestFiltered;
    }

    const locationSegments =
        normalizedDateFrom || normalizedDateTo
            ? await gameLogPersistenceRepository.getSessionsLocationSegmentsByDateRange(
                  normalizedDateFrom || '1970-01-01T00:00:00.000Z',
                  normalizedDateTo || new Date().toISOString(),
                  fetchLimit
              )
            : await gameLogPersistenceRepository.getSessionsLocationSegments(
                  null,
                  fetchLimit
              );

    if (!Array.isArray(locationSegments) || locationSegments.length === 0) {
        return [];
    }

    const annotatedEvents = await loadSessionEvents(
        locationSegments,
        normalizedFavoriteSet
    );
    const result = buildGameLogSessions(
        locationSegments.map(toGameLogRow),
        annotatedEvents
    );

    return filterSessions(result.segments ?? [], {
        filters: normalizedFilters,
        favoriteUserIds: normalizedFavoriteSet,
        search: normalizedSearch
    }).slice(0, normalizedLimit);
}

async function deleteGameLogEntry(row: Record<string, unknown>) {
    await gameLogPersistenceRepository.deleteGameLogEntry(row);
}

async function getUserIdFromDisplayName(displayName: unknown) {
    return gameLogPersistenceRepository.getUserIdFromDisplayName(displayName);
}

async function getPreviousInstancesByWorldId({
    worldId
}: {
    worldId?: unknown;
}) {
    const rows =
        await gameLogPersistenceRepository.getPreviousInstancesByWorldId({
            id: worldId
        });
    if (rows instanceof Map) {
        return Array.from(rows.values());
    }
    return Array.isArray(rows) ? rows : [];
}

async function getWorldNameByWorldId(worldId: unknown) {
    const normalizedWorldId = normalizeString(worldId);
    if (!normalizedWorldId) {
        return '';
    }
    return gameLogPersistenceRepository
        .getGameLogWorldNameByWorldId(normalizedWorldId)
        .catch(() => '');
}

async function getAllUserStats({
    userIds = [],
    displayNames = []
}: {
    userIds?: unknown;
    displayNames?: unknown;
} = {}) {
    return gameLogPersistenceRepository.getAllUserStats(
        (Array.isArray(userIds) ? userIds : [])
            .map((value) => normalizeString(value))
            .filter(Boolean),
        (Array.isArray(displayNames) ? displayNames : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    );
}

const gameLogRepository = Object.freeze({
    ...gameLogPersistenceRepository,
    queryGameLog,
    queryLatestSessions,
    deleteGameLogEntry,
    getUserIdFromDisplayName,
    getPreviousInstancesByWorldId,
    getWorldNameByWorldId,
    getAllUserStats
});

export {
    queryGameLog,
    queryLatestSessions,
    deleteGameLogEntry,
    getUserIdFromDisplayName,
    getPreviousInstancesByWorldId,
    getWorldNameByWorldId,
    getAllUserStats
};
export default gameLogRepository;
