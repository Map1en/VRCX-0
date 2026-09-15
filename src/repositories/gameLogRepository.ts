import { commands } from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';

import configRepository from './configRepository';
import gameLogPersistenceRepository, {
    type GameLogDatabaseRow
} from './gameLogPersistenceRepository';
export type { GameLogDatabaseRow } from './gameLogPersistenceRepository';

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

export type GameLogFilterType = (typeof GAME_LOG_FILTER_TYPES)[number];

export function isGameLogFilterType(value: string): value is GameLogFilterType {
    return (
        value === 'Location' ||
        value === 'OnPlayerJoined' ||
        value === 'OnPlayerLeft' ||
        value === 'PortalSpawn' ||
        value === 'VideoPlay' ||
        value === 'Event' ||
        value === 'External' ||
        value === 'StringLoad' ||
        value === 'ImageLoad'
    );
}

interface QueryGameLogInput {
    currentUserId?: string;
    search?: string;
    filters?: readonly GameLogFilterType[];
    favoriteUserIds?: string[];
    limit?: number;
}

interface QueryLatestSessionsInput extends QueryGameLogInput {
    dateFrom?: string;
    dateTo?: string;
}

function normalizeSessionLimit(value: number, fallback = 25) {
    if (!Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return Math.min(value, 1000);
}

function normalizeQueryLimit(value?: number) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : null;
}

function normalizeDateBoundary(value: string, boundary: 'start' | 'end') {
    const normalized = value.trim();
    if (!normalized) {
        return '';
    }

    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    const date = dateOnlyMatch
        ? new Date(
              Number(dateOnlyMatch[1]),
              Number(dateOnlyMatch[2]) - 1,
              Number(dateOnlyMatch[3])
          )
        : new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    if (dateOnlyMatch) {
        if (
            date.getFullYear() !== Number(dateOnlyMatch[1]) ||
            date.getMonth() !== Number(dateOnlyMatch[2]) - 1 ||
            date.getDate() !== Number(dateOnlyMatch[3])
        ) {
            return '';
        }
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
    favoriteUserIds = [],
    limit
}: QueryGameLogInput) {
    const [maxTableSizeValue, searchLimitValue] = await Promise.all([
        configRepository.getInt('maxTableSize_v2', 500),
        configRepository.getInt('searchLimit', 50000)
    ]);
    const requestedLimit = normalizeQueryLimit(limit);
    const configuredMaxTableSize = maxTableSizeValue;
    const configuredSearchLimit = searchLimitValue;
    const maxTableRows =
        requestedLimit === null
            ? configuredMaxTableSize
            : Math.min(configuredMaxTableSize, requestedLimit);
    const searchRows =
        requestedLimit === null
            ? configuredSearchLimit
            : Math.min(configuredSearchLimit, requestedLimit);

    const normalizedFilters = Array.from(new Set(filters));
    const normalizedFavorites = Array.from(
        new Set(favoriteUserIds.map((value) => value.trim()).filter(Boolean))
    );
    const normalizedSearch = search.trim();

    if (normalizedSearch) {
        return gameLogPersistenceRepository.searchGameLogDatabase(
            normalizedSearch,
            normalizedFilters,
            normalizedFavorites,
            configuredSearchLimit,
            currentUserId.trim(),
            searchRows
        );
    }

    return gameLogPersistenceRepository.lookupGameLogDatabase(
        normalizedFilters,
        normalizedFavorites,
        configuredMaxTableSize,
        maxTableRows
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
        search: search.trim(),
        filters: Array.from(new Set(filters)),
        favoriteUserIds: Array.from(
            new Set(
                favoriteUserIds.map((userId) => userId.trim()).filter(Boolean)
            )
        ),
        dateFrom: normalizeDateBoundary(dateFrom, 'start'),
        dateTo: normalizeDateBoundary(dateTo, 'end'),
        limit: normalizeSessionLimit(limit),
        maxTableSize: maxTableSizeValue,
        searchLimit: searchLimitValue
    });
}

async function deleteGameLogEntry(row: GameLogDatabaseRow) {
    await gameLogPersistenceRepository.deleteGameLogEntry(row);
}

async function getUserIdFromDisplayName(displayName: string) {
    return gameLogPersistenceRepository.getUserIdFromDisplayName(displayName);
}

async function getPreviousInstancesByWorldId({
    worldId
}: {
    worldId?: string;
}) {
    return gameLogPersistenceRepository.getPreviousInstancesByWorldId({
        id: worldId
    });
}

export type GameLogPreviousInstanceWorldRow = Awaited<
    ReturnType<typeof getPreviousInstancesByWorldId>
>[number];

async function getWorldNameByWorldId(worldId: string) {
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
    userIds?: string[];
    displayNames?: string[];
} = {}) {
    return gameLogPersistenceRepository.getAllUserStats(
        userIds.map(normalizeString).filter(Boolean),
        displayNames.map(normalizeString).filter(Boolean)
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

export { queryGameLog, queryLatestSessions };
export default gameLogRepository;
