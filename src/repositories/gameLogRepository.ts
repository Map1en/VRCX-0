import { commands } from '@/platform/tauri/bindings';
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

type GameLogFilterType = (typeof GAME_LOG_FILTER_TYPES)[number];

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
    // Read config with a 0 sentinel ("unset") and let the backend own the
    // default table/search limits — keeps those magic numbers in one place.
    const [maxTableSizeValue, searchLimitValue] = await Promise.all([
        configRepository.getInt('maxTableSize_v2', 0),
        configRepository.getInt('searchLimit', 0)
    ]);

    return commands.appGameLogSessionsQuery({
        search: String(search ?? '').trim(),
        filters: normalizeFilterList(filters),
        favoriteUserIds: Array.from(normalizeFavoriteSet(favoriteUserIds)),
        dateFrom: normalizeDateBoundary(dateFrom, 'start'),
        dateTo: normalizeDateBoundary(dateTo, 'end'),
        limit: normalizeSessionLimit(limit),
        maxTableSize: normalizeConfigInt(maxTableSizeValue, 0),
        searchLimit: normalizeConfigInt(searchLimitValue, 0)
    });
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
