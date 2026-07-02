import { commands } from '@/platform/tauri/bindings';
import {
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT
} from '@/shared/constants/settings';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/shared/constants/time';
import {
    hasGroupIdPrefix,
    hasWorldIdPrefix
} from '@/shared/constants/vrchatIds';

type GameLogKind = 'Event' | 'External';

type GameLogParams = Record<string, unknown>;
type GameLogEntry = Record<string, unknown>;

type GameLogUserIdentity = {
    id?: unknown;
    displayName?: unknown;
};

type GameLogWorldCacheEntry = {
    worldName: string;
    expiresAt: number;
};

type PreviousInstanceGroup = {
    created_at: string;
    location: string;
    time: number;
    worldName: string;
    groupName: string;
    events: number[];
    last_ts: number;
};

type InstancePlayerAggregate = {
    rowId: number;
    created_at: string;
    displayName: string;
    userId: string;
    time: number;
    count: number;
};

type GameLogPreviousInstanceGroupRow = {
    created_at: string;
    groupName: string;
    location: string;
    time: number;
    worldName: string;
};

type GameLogPreviousInstanceUserRow = GameLogPreviousInstanceGroupRow & {
    createdAtTs: number;
    eventId: number;
    eventType: string;
};

type GameLogPlayerEventRow = {
    created_at: string;
    displayName: string;
    location?: string;
    rowId: number;
    time?: number;
    type: string;
    userId: string;
};

type GameLogPlayerDetailRow = {
    created_at: string;
    display_name: string;
    time: number;
    user_id: string;
};

type GameLogJoinLeaveRangeRow = {
    created_at: string;
    displayName: string;
    type: string;
    userId: string;
};

type GameLogOnlineSessionRow = {
    created_at: string;
    time: number;
};

type GameLogSessionLocationSegmentRow = {
    created_at: string;
    groupName: string;
    id: number;
    location: string;
    time: number;
    worldId: string;
    worldName: string;
};

type GameLogPreviousDisplayNameRow = {
    created_at: string;
    displayName: string;
};

type GameLogUserStatsQueryResult = {
    joinCount: number;
    lastSeen: string;
    previousDisplayNames: GameLogPreviousDisplayNameRow[];
    timeSpent: number;
    userId: string;
};

type GameLogQueryResultMap = {
    previousInstancesByGroupId: GameLogPreviousInstanceGroupRow[];
    previousInstancesByUserIdRows: GameLogPreviousInstanceUserRow[];
    playersFromInstanceRows: GameLogPlayerEventRow[];
    playerDetailFromInstance: GameLogPlayerDetailRow[];
    joinLeaveRange: GameLogJoinLeaveRangeRow[];
    onlineSessions: GameLogOnlineSessionRow[];
    sessionsEventsForSegments: GameLogPlayerEventRow[];
    sessionsLocationSegments: GameLogSessionLocationSegmentRow[];
    userStats: GameLogUserStatsQueryResult;
    worldNameByWorldId: string;
};

type GameLogArrayQueryKind = {
    [K in keyof GameLogQueryResultMap]: GameLogQueryResultMap[K] extends unknown[]
        ? K
        : never;
}[keyof GameLogQueryResultMap];

type GameLogUserStatsResult = Record<string, unknown> & {
    previousDisplayNames: Map<unknown, unknown>;
};

type GameLogInstanceDeleteInput = {
    id?: unknown;
    location: string;
    events?: unknown[];
};

function normalizeCurrentUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeGameLogIdentifier(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
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

async function queryGameLog<K extends keyof GameLogQueryResultMap>(
    kind: K,
    params?: GameLogParams
): Promise<GameLogQueryResultMap[K]>;
async function queryGameLog(
    kind: string,
    params?: GameLogParams
): Promise<unknown>;
async function queryGameLog(kind: string, params: GameLogParams = {}) {
    return commands.appGameLogQuery({
        kind,
        params
    });
}

async function queryGameLogRows<K extends GameLogArrayQueryKind>(
    kind: K,
    params?: GameLogParams
): Promise<GameLogQueryResultMap[K]> {
    const rows = await queryGameLog(kind, params);
    return (Array.isArray(rows) ? rows : []) as GameLogQueryResultMap[K];
}

function isGameLogRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function gameLogSpreadSource(value: unknown): Record<string, unknown> {
    if (!value) {
        return {};
    }
    if (typeof value === 'object' || typeof value === 'function') {
        return value as Record<string, unknown>;
    }
    return Object(value) as Record<string, unknown>;
}

function normalizeGameLogUserStats(result: unknown): GameLogUserStatsResult {
    const resultRecord = gameLogSpreadSource(result);
    const ref: GameLogUserStatsResult = {
        ...resultRecord,
        previousDisplayNames: new Map()
    };
    const previousDisplayNames = resultRecord.previousDisplayNames;
    for (const row of Array.isArray(previousDisplayNames)
        ? previousDisplayNames
        : []) {
        if (isGameLogRecord(row) && row.displayName && row.created_at) {
            ref.previousDisplayNames.set(row.displayName, row.created_at);
        }
    }
    return ref;
}

const GAME_LOG_WORLD_NAME_CACHE_LIMIT = 1000;
const EMPTY_WORLD_NAME_CACHE_TTL = MINUTE_MS;
const gameLogWorldNameCache = new Map<string, GameLogWorldCacheEntry>();
const gameLogWorldNameRequests = new Map<string, Promise<string>>();

function setCachedGameLogWorldName(worldId: unknown, worldName: unknown) {
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

function getCachedGameLogWorldName(worldId: unknown) {
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
        const rows = await queryGameLog('recentDatabase', {
            dateOffset,
            maxTableSize
        });
        return Array.isArray(rows) ? rows : [];
    },

    async addGamelogEventToDatabase(entry: GameLogEntry) {
        await addGameLogEntries('Event', [entry]);
    },

    async addGamelogExternalToDatabase(entry: GameLogEntry) {
        await addGameLogEntries('External', [entry]);
    },

    async getLastVisit(worldId: unknown, currentWorldMatch: unknown) {
        return queryGameLog('lastVisit', { worldId, currentWorldMatch });
    },

    async getVisitCount(worldId: unknown) {
        return queryGameLog('visitCount', { worldId });
    },

    async getTimeSpentInWorld(worldId: unknown) {
        return queryGameLog('timeSpentInWorld', { worldId });
    },

    async getLastGroupVisit(groupId: unknown) {
        return queryGameLog('lastGroupVisit', { groupId });
    },

    async getPreviousInstancesByGroupId(groupId: unknown) {
        const data = new Map<string, GameLogPreviousInstanceGroupRow>();
        const rows = await queryGameLogRows('previousInstancesByGroupId', {
            groupId
        });
        for (const row of rows) {
            data.set(row.location, row);
        }
        return data;
    },

    async getLastSeen(input: GameLogUserIdentity, inCurrentWorld: unknown) {
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

    async getUserStats(input: GameLogUserIdentity, inCurrentWorld: unknown) {
        const result = await queryGameLog('userStats', {
            userId: input.id,
            displayName: input.displayName,
            inCurrentWorld
        });
        return normalizeGameLogUserStats(result);
    },

    async getAllUserStats(userIds: unknown, displayNames: unknown) {
        const rows = await queryGameLog('allUserStats', {
            userIds,
            displayNames
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getGameLogByLocation(
        instanceId: unknown,
        filters: string[],
        vipList: string[] = [],
        {
            currentUserId = '',
            maxEntries = DEFAULT_SEARCH_LIMIT
        }: { currentUserId?: unknown; maxEntries?: number } = {}
    ) {
        const rows = await queryGameLog('rowsByLocation', {
            instanceId,
            filters,
            vipList,
            currentUserId: normalizeCurrentUserId(currentUserId),
            maxEntries
        });
        return Array.isArray(rows) ? rows : [];
    },

    async lookupGameLogDatabase(
        filters: string[],
        vipList: string[],
        maxEntries: number = DEFAULT_MAX_TABLE_SIZE
    ) {
        const rows = await queryGameLog('lookupRows', {
            filters,
            vipList,
            maxEntries
        });
        return Array.isArray(rows) ? rows : [];
    },

    async searchGameLogDatabase(
        search: string,
        filters: string[],
        vipList: string[],
        maxEntries: number = DEFAULT_SEARCH_LIMIT,
        currentUserId: unknown = ''
    ) {
        const normalizedCurrentUserId = normalizeCurrentUserId(currentUserId);
        if (hasWorldIdPrefix(search) || hasGroupIdPrefix(search)) {
            return this.getGameLogByLocation(search, filters, vipList, {
                currentUserId: normalizedCurrentUserId,
                maxEntries
            });
        }
        const rows = await queryGameLog('searchRows', {
            search,
            filters,
            vipList,
            currentUserId: normalizedCurrentUserId,
            maxEntries
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getGameLogWorldNameByWorldId(worldId: unknown) {
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

    async getPreviousInstancesByUserId(input: GameLogUserIdentity) {
        const normalizedUserId = normalizeGameLogIdentifier(input?.id);
        var groupingTimeTolerance = HOUR_MS;
        var data = new Set<PreviousInstanceGroup>();
        var currentGroup: PreviousInstanceGroup | undefined;
        var prevEvent: unknown;

        if (!normalizedUserId) {
            return data;
        }

        const rows = await queryGameLogRows('previousInstancesByUserIdRows', {
            userId: normalizedUserId
        });
        for (const row of rows) {
            const created_at_iso = row.created_at;
            const created_at_ts = row.createdAtTs;
            const location = row.location;
            const time = row.time;
            const worldName = row.worldName;
            const groupName = row.groupName;
            const eventId = row.eventId;
            const eventType = row.eventType;

            if (
                !currentGroup ||
                currentGroup.location !== location ||
                (Number(created_at_ts) - currentGroup.last_ts >
                    groupingTimeTolerance &&
                    !(
                        prevEvent === 'OnPlayerJoined' &&
                        eventType === 'OnPlayerLeft'
                    ))
            ) {
                currentGroup = {
                    created_at: created_at_iso,
                    location,
                    time,
                    worldName,
                    groupName,
                    events: [eventId],
                    last_ts: Number(created_at_ts)
                };

                data.add(currentGroup);
            } else {
                currentGroup.time += time;
                currentGroup.last_ts = Number(created_at_ts);
                currentGroup.events.push(eventId);
            }

            prevEvent = eventType;
        }

        return data;
    },

    async getPreviousInstancesByWorldId(input: GameLogUserIdentity) {
        const rows = await queryGameLog('previousInstancesByWorldId', {
            worldId: input.id
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getPlayersFromInstance(location: unknown) {
        var players = new Map<string, InstancePlayerAggregate>();
        const rows = await queryGameLogRows('playersFromInstanceRows', {
            location
        });
        for (const rowData of rows) {
            var time = 0;
            var count = 0;
            var rowId = rowData.rowId;
            var created_at = rowData.created_at;
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
            }
            if (rowData.type === 'OnPlayerJoined') {
                count++;
            }
            var row: InstancePlayerAggregate = {
                rowId,
                created_at,
                displayName: ref?.displayName || displayName,
                userId,
                time,
                count
            };
            players.set(playerKey, row);
        }
        return players;
    },

    async getLocationBeforeOrAt(createdAt: unknown) {
        return queryGameLog('locationBeforeOrAt', { createdAt });
    },

    async getJoinLeaveEntriesForLocationRange(
        location: unknown,
        afterDate: unknown,
        beforeDate: unknown
    ) {
        const rows = await queryGameLogRows('joinLeaveRange', {
            location,
            afterDate,
            beforeDate
        });
        return rows;
    },

    async getPlayerDetailFromInstance(location: unknown) {
        const rows = await queryGameLogRows('playerDetailFromInstance', {
            location
        });
        return rows;
    },

    async getPreviousDisplayNamesByUserId(ref: GameLogUserIdentity) {
        var data = new Map<unknown, unknown>();
        const rows = await queryGameLog('previousDisplayNamesByUserId', {
            userId: ref.id
        });
        for (const row of Array.isArray(rows) ? rows : []) {
            if (ref.displayName !== row.displayName) {
                data.set(row.displayName, row.created_at);
            }
        }
        return data;
    },

    async getGameLogInstancesTime() {
        var instances = new Map();
        const rows = await queryGameLog('instanceTimes');
        for (const dbRow of Array.isArray(rows) ? rows : []) {
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

        const rows = await queryGameLogRows('onlineSessions', params);
        return rows;
    },

    async getCurrentUserOnlineSessionsAfter(
        afterCreatedAt: unknown,
        inclusive: boolean = false
    ) {
        const rows = await queryGameLog('onlineSessionsAfter', {
            afterCreatedAt,
            inclusive
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getMyTopWorlds(
        days: number = 0,
        limit: number = 5,
        sortBy: 'time' | 'count' | string = 'time',
        excludeWorldId: unknown = ''
    ) {
        const rows = await queryGameLog('topWorlds', {
            days,
            limit,
            sortBy,
            excludeWorldId
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getUserIdFromDisplayName(displayName: unknown) {
        return queryGameLog('userIdFromDisplayName', { displayName });
    },

    async getInstanceActivity(
        startDate: unknown,
        endDate: unknown,
        currentUserId: unknown = ''
    ) {
        const normalizedCurrentUserId = normalizeCurrentUserId(currentUserId);
        const currentUserData = [];
        const detailData = new Map();
        const rows = await queryGameLog('instanceActivityRows', {
            startDate,
            endDate
        });
        for (const rowData of Array.isArray(rows) ? rows : []) {
            if (!rowData.location || rowData.location === 'traveling') {
                continue;
            }

            if (rowData.user_id === normalizedCurrentUserId) {
                currentUserData.push(rowData);
            }
            const instanceData = detailData.get(rowData.location);

            detailData.set(rowData.location, [
                ...(instanceData || []),
                rowData
            ]);
        }

        return { currentUserData, detailData };
    },

    async getDateOfInstanceActivity(currentUserId: unknown = '') {
        const result = await queryGameLog('dateOfInstanceActivity', {
            userId: normalizeCurrentUserId(currentUserId)
        });
        return Array.isArray(result) ? result : [];
    },

    async getInstanceJoinHistory(currentUserId: unknown = '') {
        var oneWeekAgo = new Date(Date.now() - 604800000).toJSON();
        var instances = new Map();
        const rows = await queryGameLog('instanceJoinHistory', {
            userId: normalizeCurrentUserId(currentUserId),
            createdAt: oneWeekAgo
        });
        for (const row of Array.isArray(rows) ? rows : []) {
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
            ? input.events
                  .map((value) => Number.parseInt(String(value), 10))
                  .filter((value) => Number.isFinite(value) && value > 0)
            : [];
        if (!eventIds.length) {
            return Promise.resolve();
        }
        return commands.appGameLogInstanceDelete(input.location, eventIds);
    },

    async deleteGameLogEntry(input: GameLogEntry) {
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
        await commands.appGameLogEntryDelete(
            normalizeGameLogIdentifier(input.type) || 'ResourceLoad',
            input
        );
    },

    async getSessionsLocationSegments(beforeId: unknown, limit: number) {
        const rows = await queryGameLog('sessionsLocationSegments', {
            beforeId,
            limit
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getSessionsLocationSegmentsByDateRange(
        afterDate: unknown,
        beforeDate: unknown,
        limit: number
    ) {
        const rows = await queryGameLog('sessionsLocationSegmentsByDateRange', {
            afterDate,
            beforeDate,
            limit
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getSessionsEventsForSegments(
        locationTags: string[],
        afterDate: unknown,
        beforeDate: unknown
    ) {
        if (!locationTags || locationTags.length === 0) return [];

        const rows = await queryGameLog('sessionsEventsForSegments', {
            locationTags,
            afterDate,
            beforeDate
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getSessionsLocationSegmentsByAnchor(
        sinceDate: unknown,
        limit: number
    ) {
        const rows = await queryGameLog('sessionsLocationSegmentsByAnchor', {
            sinceDate,
            limit
        });
        return Array.isArray(rows) ? rows : [];
    }
};

export { gameLog };
export default gameLog;
