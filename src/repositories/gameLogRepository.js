import { database } from '@/services/database/index.js';
import { buildGameLogSessions } from '@/shared/utils/gameLog.js';

import configRepository from './configRepository.js';

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
]);

const SESSION_EVENT_FILTER_TYPES = Object.freeze(['OnPlayerJoined', 'OnPlayerLeft', 'VideoPlay']);
const SESSION_GLOBAL_SEARCH_INITIAL_LOCATIONS = 500;

function normalizeId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeFavoriteSet(favoriteUserIds = []) {
    return new Set(
        (Array.isArray(favoriteUserIds) ? favoriteUserIds : [])
            .map((value) => normalizeId(value))
            .filter(Boolean)
    );
}

function normalizeFilterList(filters = []) {
    if (!Array.isArray(filters)) {
        return [];
    }

    return filters.filter((filter, index, source) => {
        if (typeof filter !== 'string') {
            return false;
        }

        if (!GAME_LOG_FILTER_TYPES.includes(filter)) {
            return false;
        }

        return source.indexOf(filter) === index;
    });
}

function normalizeSessionLimit(value, fallback = 25) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(parsed, 1000);
}

function dateToEpoch(value) {
    const epoch = Date.parse(value);
    return Number.isFinite(epoch) ? epoch : 0;
}

function normalizeDateBoundary(value, boundary) {
    const normalized = normalizeId(value);
    if (!normalized) {
        return '';
    }

    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    if (boundary === 'end') {
        date.setHours(23, 59, 59, 999);
    } else {
        date.setHours(0, 0, 0, 0);
    }

    return date.toISOString();
}

function getSessionEventFilterType(event) {
    if (event?.type === 'JoinGroup') {
        return 'OnPlayerJoined';
    }
    if (event?.type === 'LeftGroup') {
        return 'OnPlayerLeft';
    }
    return event?.type || '';
}

function sessionEventMatchesType(event, filters) {
    if (filters.length === 0) {
        return true;
    }

    return filters.includes(getSessionEventFilterType(event));
}

function filterSessionEventByFavorite(event, favoriteUserIds) {
    if (favoriteUserIds.size === 0) {
        return event;
    }

    if (event?.type === 'VideoPlay') {
        return event;
    }

    const userId = normalizeId(event?.userId);
    if (userId && favoriteUserIds.has(userId)) {
        return event;
    }

    if (Array.isArray(event?.members)) {
        const members = event.members.filter((member) =>
            favoriteUserIds.has(normalizeId(member?.userId))
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

function sessionHeaderMatchesSearch(session, query) {
    if (!query) {
        return true;
    }

    return [
        session?.created_at,
        session?.location,
        session?.worldId,
        session?.worldName,
        session?.groupName
    ].some((value) => String(value || '').toLowerCase().includes(query));
}

function sessionEventMatchesSearch(event, query) {
    if (!query) {
        return true;
    }

    const values = [
        event?.type,
        event?.displayName,
        event?.userId,
        event?.videoName,
        event?.videoUrl,
        event?.videoId
    ];

    if (Array.isArray(event?.members)) {
        for (const member of event.members) {
            values.push(member?.displayName, member?.userId);
        }
    }

    return values.some((value) => String(value || '').toLowerCase().includes(query));
}

function filterSessionEvents(session, { eventFilters, favoriteUserIds, searchQuery }) {
    const filteredEvents = [];

    for (const event of session?.events ?? []) {
        if (!sessionEventMatchesType(event, eventFilters)) {
            continue;
        }

        const favoriteFilteredEvent = filterSessionEventByFavorite(event, favoriteUserIds);
        if (!favoriteFilteredEvent) {
            continue;
        }

        if (!sessionEventMatchesSearch(favoriteFilteredEvent, searchQuery)) {
            continue;
        }

        filteredEvents.push(favoriteFilteredEvent);
    }

    return filteredEvents;
}

function normalizeSessionFilters(filters) {
    const hasLocationFilter = filters.includes('Location');
    const eventFilters = filters.filter((filter) => SESSION_EVENT_FILTER_TYPES.includes(filter));

    return {
        hasLocationFilter,
        hasUnsupportedOnlyFilter: filters.length > 0 && !hasLocationFilter && eventFilters.length === 0,
        eventFilters
    };
}

function filterSessions(sessions, { filters, favoriteUserIds, search }) {
    const searchQuery = String(search || '').trim().toLowerCase();
    const { hasLocationFilter, hasUnsupportedOnlyFilter, eventFilters } =
        normalizeSessionFilters(filters);

    if (hasUnsupportedOnlyFilter) {
        return [];
    }

    return sessions.reduce((result, session) => {
        const headerMatchesSearch = sessionHeaderMatchesSearch(session, searchQuery);
        const nextEvents = filterSessionEvents(session, {
            eventFilters,
            favoriteUserIds,
            searchQuery: headerMatchesSearch ? '' : searchQuery
        });
        const matchesFilter = filters.length === 0 || hasLocationFilter || nextEvents.length > 0;
        const matchesFavorites = favoriteUserIds.size === 0 || nextEvents.length > 0;
        const matchesSearch = !searchQuery || headerMatchesSearch || nextEvents.length > 0;

        if (matchesFilter && matchesFavorites && matchesSearch) {
            result.push({
                ...session,
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
}) {
    const hasFiltering =
        Boolean(normalizedSearch) || normalizedFilters.length > 0 || favoriteUserIds.size > 0;

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

async function loadSessionEvents(locationSegments, favoriteUserIds) {
    if (!Array.isArray(locationSegments) || locationSegments.length === 0) {
        return [];
    }

    const epochs = locationSegments
        .map((segment) => dateToEpoch(segment?.created_at))
        .filter((epoch) => epoch > 0);
    const minEpoch = epochs.length ? Math.min(...epochs) : Date.now();
    const maxEpoch = epochs.length ? Math.max(...epochs) : Date.now();
    const dateWindowMs = 24 * 60 * 60 * 1000;
    const locationTags = Array.from(
        new Set(locationSegments.map((segment) => normalizeId(segment?.location)).filter(Boolean))
    );
    const events = await database.getSessionsEventsForSegments(
        locationTags,
        new Date(minEpoch - dateWindowMs).toISOString(),
        new Date(maxEpoch + dateWindowMs).toISOString()
    );

    return events.map((event) => {
        const userId = normalizeId(event?.userId);
        return {
            ...event,
            isFavorite: userId ? favoriteUserIds.has(userId) : false
        };
    });
}

class GameLogRepository {
    async queryGameLog({ search = '', filters = [], favoriteUserIds = [] }) {
        const [maxTableSize, searchLimit] = await Promise.all([
            configRepository.getInt('maxTableSize_v2', 500),
            configRepository.getInt('searchLimit', 50000)
        ]);

        database.setMaxTableSize(maxTableSize);
        database.setSearchTableSize(searchLimit);

        const normalizedFilters = normalizeFilterList(filters);
        const normalizedFavorites = Array.from(
            new Set(
                (Array.isArray(favoriteUserIds) ? favoriteUserIds : [])
                    .map((value) => normalizeId(value))
                    .filter(Boolean)
            )
        );
        const normalizedSearch = String(search || '').trim();

        if (normalizedSearch) {
            return database.searchGameLogDatabase(
                normalizedSearch,
                normalizedFilters,
                normalizedFavorites,
                searchLimit
            );
        }

        return database.lookupGameLogDatabase(normalizedFilters, normalizedFavorites, maxTableSize);
    }

    async queryLatestSessions({ search = '', filters = [], favoriteUserIds = [], dateFrom = '', dateTo = '', limit = 25 } = {}) {
        const [maxTableSize, searchLimit] = await Promise.all([
            configRepository.getInt('maxTableSize_v2', 500),
            configRepository.getInt('searchLimit', 50000)
        ]);
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
            const allLocationSegments = [];
            const allEvents = [];
            let beforeId = null;
            let hasMore = true;
            let latestFiltered = [];

            while (
                hasMore &&
                latestFiltered.length < normalizedLimit &&
                allLocationSegments.length < searchLimit
            ) {
                const batch = await database.getSessionsLocationSegments(beforeId, fetchCount);
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

                const batchEvents = await loadSessionEvents(batch, normalizedFavoriteSet);
                allLocationSegments.push(...batch);
                allEvents.push(...batchEvents);
                beforeId = batch[batch.length - 1].id;
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

        const locationSegments = normalizedDateFrom || normalizedDateTo
            ? await database.getSessionsLocationSegmentsByDateRange(
                normalizedDateFrom || '1970-01-01T00:00:00.000Z',
                normalizedDateTo || new Date().toISOString(),
                fetchLimit
            )
            : await database.getSessionsLocationSegments(null, fetchLimit);

        if (!Array.isArray(locationSegments) || locationSegments.length === 0) {
            return [];
        }

        const annotatedEvents = await loadSessionEvents(locationSegments, normalizedFavoriteSet);
        const result = buildGameLogSessions(locationSegments, annotatedEvents);

        return filterSessions(result.segments ?? [], {
            filters: normalizedFilters,
            favoriteUserIds: normalizedFavoriteSet,
            search: normalizedSearch
        }).slice(0, normalizedLimit);
    }

    async deleteGameLogEntry(row) {
        await database.deleteGameLogEntry(row);
    }

    async getUserIdFromDisplayName(displayName) {
        return database.getUserIdFromDisplayName(displayName);
    }

    async getPreviousInstancesByWorldId({ worldId }) {
        const rows = await database.getPreviousInstancesByWorldId({ id: worldId });
        if (rows instanceof Map) {
            return Array.from(rows.values());
        }
        return Array.isArray(rows) ? rows : [];
    }

    async getWorldNameByWorldId(worldId) {
        const normalizedWorldId = normalizeId(worldId);
        if (!normalizedWorldId) {
            return '';
        }
        return database.getGameLogWorldNameByWorldId(normalizedWorldId).catch(() => '');
    }

    async getAllUserStats({ userIds = [], displayNames = [] } = {}) {
        return database.getAllUserStats(
            (Array.isArray(userIds) ? userIds : []).map((value) => normalizeId(value)).filter(Boolean),
            (Array.isArray(displayNames) ? displayNames : []).map((value) => String(value || '').trim()).filter(Boolean)
        );
    }

    async getMutualCountForAllUsers() {
        return database.getMutualCountForAllUsers();
    }

    async getMutualGraphMeta() {
        return database.getMutualGraphMeta();
    }
}

const gameLogRepository = new GameLogRepository();

export { GameLogRepository };
export default gameLogRepository;
