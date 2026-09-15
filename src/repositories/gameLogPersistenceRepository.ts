import {
    commands,
    type GameLogAllUserStatsOutput,
    type GameLogQuery,
    type GameLogQueryOutput,
    type GameLogRowOutput,
    type GameLogUserStatsOutput,
    type GameLogWriteKind,
    type InstanceHistoryEntryOutput
} from '@/platform/tauri/bindings';
import {
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT
} from '@/shared/constants/settings';
import { DAY_MS, MINUTE_MS } from '@/shared/constants/time';
import {
    hasGroupIdPrefix,
    hasWorldIdPrefix
} from '@/shared/constants/vrchatIds';

type GameLogKind = Extract<GameLogWriteKind, 'Event' | 'External'>;

type GameLogEntry = Record<string, unknown>;

type GameLogUserIdentity = {
    id?: string;
    displayName?: string;
};

type GameLogPreviousInstancesOptions = {
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
};

type GameLogWorldCacheEntry = {
    worldName: string;
    expiresAt: number;
};

type InstancePlayerAggregate = {
    rowId: number;
    created_at: string;
    left_at: string;
    displayName: string;
    userId: string;
    time: number;
    count: number;
};

export type GameLogDatabaseRow = GameLogRowOutput;

export type GameLogAllUserStatsRow = GameLogAllUserStatsOutput;

type GameLogUserStatsResult = Omit<
    GameLogUserStatsOutput,
    'previousDisplayNames'
> & {
    previousDisplayNames: Map<string, string>;
};

type GameLogInstanceDeleteInput = {
    location: string;
    events?: number[];
};

function normalizeCurrentUserId(value: string) {
    return value.trim();
}

function normalizeGameLogIdentifier(value: string | undefined) {
    return value?.trim() ?? '';
}

function addGameLogEntries(
    kind: GameLogKind,
    entries: GameLogEntry | GameLogEntry[]
) {
    return commands.appGameLogEntriesAdd(
        kind,
        Array.isArray(entries) ? entries : [entries]
    );
}

type GameLogQueryParamsByKind = {
    [K in GameLogQuery['kind']]: Extract<GameLogQuery, { kind: K }>['params'];
};

type GameLogQueryValueByKind = {
    [K in GameLogQueryOutput['kind']]: Extract<
        GameLogQueryOutput,
        { kind: K }
    >['value'];
};

async function queryGameLog<K extends keyof GameLogQueryValueByKind>(
    kind: K,
    params: GameLogQueryParamsByKind[K]
): Promise<GameLogQueryValueByKind[K]> {
    const output = await commands.appGameLogQuery({
        kind,
        params
    } as GameLogQuery);
    return output.value as GameLogQueryValueByKind[K];
}

function normalizeGameLogUserStats(
    result: GameLogUserStatsOutput
): GameLogUserStatsResult {
    const ref: GameLogUserStatsResult = {
        ...result,
        previousDisplayNames: new Map()
    };
    for (const row of result.previousDisplayNames) {
        if (row.displayName && row.created_at) {
            ref.previousDisplayNames.set(
                normalizeGameLogIdentifier(row.displayName),
                normalizeGameLogIdentifier(row.created_at)
            );
        }
    }
    return ref;
}

const GAME_LOG_WORLD_NAME_CACHE_LIMIT = 1000;
const EMPTY_WORLD_NAME_CACHE_TTL = MINUTE_MS;
const gameLogWorldNameCache = new Map<string, GameLogWorldCacheEntry>();
const gameLogWorldNameRequests = new Map<string, Promise<string>>();

function setCachedGameLogWorldName(worldId: string, worldName: string) {
    const normalizedWorldId = normalizeGameLogIdentifier(worldId);
    if (!normalizedWorldId) {
        return;
    }

    if (gameLogWorldNameCache.has(normalizedWorldId)) {
        gameLogWorldNameCache.delete(normalizedWorldId);
    }

    gameLogWorldNameCache.set(normalizedWorldId, {
        worldName: normalizeGameLogIdentifier(worldName),
        expiresAt: worldName ? 0 : Date.now() + EMPTY_WORLD_NAME_CACHE_TTL
    });

    while (gameLogWorldNameCache.size > GAME_LOG_WORLD_NAME_CACHE_LIMIT) {
        const oldestKey = gameLogWorldNameCache.keys().next().value;
        if (oldestKey === undefined) {
            break;
        }
        gameLogWorldNameCache.delete(oldestKey);
    }
}

function getCachedGameLogWorldName(worldId: string) {
    const normalizedWorldId = normalizeGameLogIdentifier(worldId);
    if (!normalizedWorldId || !gameLogWorldNameCache.has(normalizedWorldId)) {
        return undefined;
    }

    const cached = gameLogWorldNameCache.get(normalizedWorldId);
    if (!cached) {
        return undefined;
    }
    if (cached.expiresAt && cached.expiresAt <= Date.now()) {
        gameLogWorldNameCache.delete(normalizedWorldId);
        return undefined;
    }

    return cached.worldName;
}

const gameLog = {
    async getGamelogDatabase(maxTableSize: number = DEFAULT_MAX_TABLE_SIZE) {
        var date = new Date();
        date.setDate(date.getDate() - 1);
        var dateOffset = date.toJSON();
        return queryGameLog('recentDatabase', {
            dateOffset,
            maxTableSize
        });
    },

    async addGamelogEventToDatabase(entry: GameLogEntry) {
        await addGameLogEntries('Event', [entry]);
    },

    async addGamelogExternalToDatabase(entry: GameLogEntry) {
        await addGameLogEntries('External', [entry]);
    },

    async getLastVisit(worldId: string, currentWorldMatch: boolean) {
        return queryGameLog('lastVisit', { worldId, currentWorldMatch });
    },

    async getVisitCount(worldId: string) {
        return queryGameLog('visitCount', { worldId });
    },

    async getTimeSpentInWorld(worldId: string) {
        return queryGameLog('timeSpentInWorld', { worldId });
    },

    async getLastGroupVisit(groupId: string) {
        return queryGameLog('lastGroupVisit', { groupId });
    },

    async getPreviousInstancesByGroupId(groupId: string) {
        const rows = await commands.appGameLogPreviousInstancesByGroupId(
            normalizeGameLogIdentifier(groupId)
        );
        const data = new Map<string, (typeof rows)[number]>();
        for (const row of rows) {
            data.set(row.location, row);
        }
        return data;
    },

    async getLastSeen(input: GameLogUserIdentity, inCurrentWorld: boolean) {
        return queryGameLog('lastSeen', {
            userId: input.id,
            displayName: input.displayName,
            inCurrentWorld
        });
    },

    async getJoinCount(input: GameLogUserIdentity) {
        return queryGameLog('joinCount', {
            userId: input.id,
            displayName: input.displayName
        });
    },

    async getTimeSpent(input: GameLogUserIdentity) {
        return queryGameLog('timeSpent', {
            userId: input.id,
            displayName: input.displayName
        });
    },

    async getUserStats(input: GameLogUserIdentity, inCurrentWorld: boolean) {
        const result = await queryGameLog('userStats', {
            userId: input.id,
            displayName: input.displayName,
            inCurrentWorld
        });
        return normalizeGameLogUserStats(result);
    },

    async getAllUserStats(userIds: string[], displayNames: string[]) {
        return queryGameLog('allUserStats', {
            userIds,
            displayNames
        });
    },

    async getGameLogByLocation(
        instanceId: string,
        filters: string[],
        vipList: string[] = [],
        {
            currentUserId = '',
            maxEntries = DEFAULT_SEARCH_LIMIT,
            maxRows = maxEntries
        }: {
            currentUserId?: string;
            maxEntries?: number;
            maxRows?: number;
        } = {}
    ) {
        return queryGameLog('rowsByLocation', {
            instanceId,
            filters,
            vipList,
            currentUserId: normalizeCurrentUserId(currentUserId),
            maxEntries,
            maxRows
        });
    },

    async lookupGameLogDatabase(
        filters: string[],
        vipList: string[],
        maxEntries: number = DEFAULT_MAX_TABLE_SIZE,
        maxRows: number = maxEntries
    ) {
        return queryGameLog('lookupRows', {
            filters,
            vipList,
            maxEntries,
            maxRows
        });
    },

    async searchGameLogDatabase(
        search: string,
        filters: string[],
        vipList: string[],
        maxEntries: number = DEFAULT_SEARCH_LIMIT,
        currentUserId: string = '',
        maxRows: number = maxEntries
    ) {
        const normalizedCurrentUserId = normalizeCurrentUserId(currentUserId);
        if (hasWorldIdPrefix(search) || hasGroupIdPrefix(search)) {
            return this.getGameLogByLocation(search, filters, vipList, {
                currentUserId: normalizedCurrentUserId,
                maxEntries,
                maxRows
            });
        }
        return queryGameLog('searchRows', {
            search,
            filters,
            vipList,
            currentUserId: normalizedCurrentUserId,
            maxEntries,
            maxRows
        });
    },

    async getGameLogWorldNameByWorldId(worldId: string) {
        const normalizedWorldId = normalizeGameLogIdentifier(worldId);
        if (!normalizedWorldId) {
            return '';
        }

        const cachedWorldName = getCachedGameLogWorldName(normalizedWorldId);
        if (typeof cachedWorldName !== 'undefined') {
            return cachedWorldName;
        }

        const existingRequest = gameLogWorldNameRequests.get(normalizedWorldId);
        if (existingRequest) {
            return existingRequest;
        }

        const request = (async () => {
            const worldName = await queryGameLog('worldNameByWorldId', {
                worldId: normalizedWorldId
            });
            const normalizedWorldName = normalizeGameLogIdentifier(worldName);
            setCachedGameLogWorldName(normalizedWorldId, normalizedWorldName);
            return normalizedWorldName;
        })();

        gameLogWorldNameRequests.set(normalizedWorldId, request);
        try {
            return await request;
        } finally {
            if (gameLogWorldNameRequests.get(normalizedWorldId) === request) {
                gameLogWorldNameRequests.delete(normalizedWorldId);
            }
        }
    },

    async getPreviousInstancesByUserId(
        input: GameLogUserIdentity,
        options: GameLogPreviousInstancesOptions = {}
    ): Promise<InstanceHistoryEntryOutput[]> {
        const normalizedUserId = normalizeGameLogIdentifier(input?.id);
        const dateFrom = normalizeGameLogIdentifier(options.dateFrom);
        const dateTo = normalizeGameLogIdentifier(options.dateTo);
        const requestedLimit = options.limit ?? 0;
        const limit =
            Number.isFinite(requestedLimit) && requestedLimit > 0
                ? Math.floor(requestedLimit)
                : 0;

        if (!normalizedUserId) {
            return [];
        }

        return commands.appInstanceHistoryQuery({
            userId: normalizedUserId,
            dateFrom,
            dateTo,
            limit
        });
    },

    getPreviousInstancesByWorldId(input: GameLogUserIdentity) {
        return commands.appGameLogPreviousInstancesByWorldId(
            normalizeGameLogIdentifier(input.id)
        );
    },

    async getPlayersFromInstance(location: string) {
        var players = new Map<string, InstancePlayerAggregate>();
        const rows = await queryGameLog('playersFromInstanceRows', {
            location
        });
        for (const rowData of rows) {
            var time = 0;
            var count = 0;
            var rowId = rowData.rowId;
            var created_at = rowData.created_at;
            var left_at =
                rowData.type === 'OnPlayerLeft' ? rowData.created_at : '';
            var displayName = normalizeGameLogIdentifier(rowData.displayName);
            var userId = normalizeGameLogIdentifier(rowData.userId);
            var playerKey = userId || `${displayName || 'anonymous'}:${rowId}`;
            if (rowData.time) {
                time = rowData.time;
            }
            var ref = players.get(playerKey);
            if (typeof ref !== 'undefined') {
                time += ref.time;
                count = ref.count;
                created_at = ref.created_at;
                left_at =
                    rowData.type === 'OnPlayerLeft'
                        ? rowData.created_at
                        : ref.left_at;
            }
            if (rowData.type === 'OnPlayerJoined') {
                if (count === 0) {
                    created_at = rowData.created_at;
                }
                count++;
            }
            var row: InstancePlayerAggregate = {
                rowId,
                created_at,
                left_at,
                displayName: ref?.displayName || displayName,
                userId,
                time,
                count
            };
            players.set(playerKey, row);
        }
        return players;
    },

    async getLocationBeforeOrAt(createdAt: string) {
        return queryGameLog('locationBeforeOrAt', { createdAt });
    },

    async getJoinLeaveEntriesForLocationRange(
        location: string,
        afterDate: string,
        beforeDate: string
    ) {
        const rows = await queryGameLog('joinLeaveRange', {
            location,
            afterDate,
            beforeDate
        });
        return rows;
    },

    async getPlayerDetailFromInstance(location: string) {
        const rows = await queryGameLog('playerDetailFromInstance', {
            location
        });
        return rows;
    },

    async getPreviousDisplayNamesByUserId(ref: GameLogUserIdentity) {
        var data = new Map<string, string>();
        const rows = await queryGameLog('previousDisplayNamesByUserId', {
            userId: ref.id
        });
        for (const row of rows) {
            const displayName = normalizeGameLogIdentifier(row.displayName);
            const createdAt = normalizeGameLogIdentifier(row.created_at);
            if (ref.displayName !== displayName) {
                data.set(displayName, createdAt);
            }
        }
        return data;
    },

    async getGameLogInstancesTime() {
        var instances = new Map<string, number>();
        const rows = await queryGameLog('instanceTimes', {});
        for (const dbRow of rows) {
            var time = 0;
            var location = dbRow.location;
            if (dbRow.time) {
                time = dbRow.time;
            }
            var ref = instances.get(location);
            if (typeof ref !== 'undefined') {
                time += ref;
            }
            instances.set(location, time);
        }
        return instances;
    },

    async getCurrentUserOnlineSessions(
        fromDays: number = 0,
        toDays: number = 0
    ) {
        const now = new Date();
        const params: { fromDate?: string; toDate?: string } = {};

        if (fromDays > 0) {
            params.fromDate = new Date(
                now.getTime() - fromDays * DAY_MS
            ).toISOString();
        }
        if (toDays > 0) {
            params.toDate = new Date(
                now.getTime() - toDays * DAY_MS
            ).toISOString();
        }

        const rows = await queryGameLog('onlineSessions', params);
        return rows;
    },

    async getCurrentUserOnlineSessionsAfter(
        afterCreatedAt: string,
        inclusive: boolean = false
    ) {
        return queryGameLog('onlineSessionsAfter', {
            afterCreatedAt,
            inclusive
        });
    },

    async getUserIdFromDisplayName(displayName: string) {
        return queryGameLog('userIdFromDisplayName', { displayName });
    },

    async getInstanceJoinHistory(currentUserId: string = '') {
        var oneWeekAgo = new Date(Date.now() - 604800000).toJSON();
        var instances = new Map<string, number>();
        const rows = await queryGameLog('instanceJoinHistory', {
            userId: normalizeCurrentUserId(currentUserId),
            createdAt: oneWeekAgo
        });
        for (const row of rows) {
            if (!instances.has(row.location)) {
                var epoch = new Date(row.created_at).getTime();
                instances.set(row.location, epoch);
            }
        }
        return instances;
    },

    deleteGameLogInstanceByInstanceId(input: GameLogInstanceDeleteInput) {
        return commands.appGameLogInstanceDeleteByLocation(input.location);
    },

    deleteGameLogInstance(input: GameLogInstanceDeleteInput) {
        const eventIds = Array.isArray(input.events)
            ? input.events.filter(
                  (value) => Number.isFinite(value) && value > 0
              )
            : [];
        if (!eventIds.length) {
            return Promise.resolve();
        }
        return commands.appGameLogInstanceDelete(input.location, eventIds);
    },

    async deleteGameLogEntry(input: GameLogDatabaseRow) {
        switch (input.type) {
            case 'VideoPlay':
                await this.deleteGameLogVideoPlay(input);
                break;
            case 'Event':
                await this.deleteGameLogEvent(input);
                break;
            case 'External':
                await this.deleteGameLogExternal(input);
                break;
            case 'StringLoad':
            case 'ImageLoad':
                await this.deleteGameLogResourceLoad(input);
                break;
        }
    },

    async deleteGameLogVideoPlay(input: GameLogEntry) {
        await commands.appGameLogEntryDelete('VideoPlay', input);
    },

    async deleteGameLogEvent(input: GameLogEntry) {
        await commands.appGameLogEntryDelete('Event', input);
    },

    async deleteGameLogExternal(input: GameLogEntry) {
        await commands.appGameLogEntryDelete('External', input);
    },

    async deleteGameLogResourceLoad(input: GameLogEntry) {
        const kind =
            input.type === 'StringLoad' || input.type === 'ImageLoad'
                ? input.type
                : 'ResourceLoad';
        await commands.appGameLogEntryDelete(kind, input);
    }
};

export default gameLog;
