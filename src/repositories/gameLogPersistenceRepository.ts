import { commands } from '@/platform/tauri/bindings';

const DEFAULT_MAX_TABLE_SIZE = 500;
const DEFAULT_SEARCH_TABLE_SIZE = 50000;

type GameLogKind =
    | 'Location'
    | 'LocationTime'
    | 'JoinLeave'
    | 'PortalSpawn'
    | 'VideoPlay'
    | 'ResourceLoad'
    | 'Event'
    | 'External'
    | string;

type GameLogRow = Record<string, unknown>;
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
    created_at: unknown;
    location: unknown;
    time: number;
    worldName: unknown;
    groupName: unknown;
    events: unknown[];
    last_ts: number;
};

type InstancePlayerAggregate = {
    rowId: unknown;
    created_at: unknown;
    displayName: string;
    userId: string;
    time: number;
    count: number;
};

type GameLogInstanceDeleteInput = {
    id?: unknown;
    location?: unknown;
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

async function queryGameLog(kind: string, params: GameLogParams = {}) {
    return commands.appGameLogQuery({
        kind,
        params
    });
}

const GAME_LOG_WORLD_NAME_CACHE_LIMIT = 1000;
const EMPTY_WORLD_NAME_CACHE_TTL = 60 * 1000;
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

function rememberGameLogWorldName(worldId: unknown, worldName: unknown) {
    const normalizedWorldName = normalizeGameLogIdentifier(worldName);
    if (normalizedWorldName) {
        setCachedGameLogWorldName(worldId, normalizedWorldName);
    }
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

    async addGamelogLocationToDatabase(entry: GameLogEntry) {
        await addGameLogEntries('Location', [entry]);
        rememberGameLogWorldName(entry.worldId, entry.worldName);
    },

    async updateGamelogLocationTimeToDatabase(entry: GameLogEntry) {
        return addGameLogEntries('LocationTime', [entry]);
    },

    async addGamelogJoinLeaveToDatabase(entry: GameLogEntry) {
        await addGameLogEntries('JoinLeave', [entry]);
    },

    async addGamelogJoinLeaveBulk(inputData: GameLogEntry[]) {
        if (inputData.length === 0) {
            return;
        }
        return addGameLogEntries('JoinLeave', inputData);
    },

    async addGamelogPortalSpawnToDatabase(entry: GameLogEntry) {
        await addGameLogEntries('PortalSpawn', [entry]);
    },

    async addGamelogVideoPlayToDatabase(entry: GameLogEntry) {
        await addGameLogEntries('VideoPlay', [entry]);
    },

    async addGamelogResourceLoadToDatabase(entry: GameLogEntry) {
        await addGameLogEntries('ResourceLoad', [entry]);
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
        const data = new Map<unknown, GameLogRow>();
        const rows = await queryGameLog('previousInstancesByGroupId', {
            groupId
        });
        for (const row of Array.isArray(rows) ? rows : []) {
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
        const result = (await queryGameLog('userStats', {
            userId: input.id,
            displayName: input.displayName,
            inCurrentWorld
        })) as GameLogRow;
        const ref: GameLogRow & {
            previousDisplayNames: Map<unknown, unknown>;
        } = {
            ...(result || {}),
            previousDisplayNames: new Map()
        };
        for (const row of Array.isArray(result?.previousDisplayNames)
            ? result.previousDisplayNames
            : []) {
            if (row.displayName && row.created_at) {
                ref.previousDisplayNames.set(row.displayName, row.created_at);
            }
        }
        return ref;
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
            maxEntries = DEFAULT_SEARCH_TABLE_SIZE
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
        maxEntries: number = DEFAULT_SEARCH_TABLE_SIZE,
        currentUserId: unknown = ''
    ) {
        const normalizedCurrentUserId = normalizeCurrentUserId(currentUserId);
        if (search.startsWith('wrld_') || search.startsWith('grp_')) {
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

    async getLastDateGameLogDatabase() {
        var date = new Date().toJSON();
        var dateOffset = new Date(Date.now() - 86400000).toJSON();
        const newDate = await queryGameLog('lastDate');
        if (
            typeof newDate === 'string' &&
            newDate > dateOffset &&
            newDate < date
        ) {
            date = newDate;
        }
        return date;
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
        var groupingTimeTolerance = 1 * 60 * 60 * 1000;
        var data = new Set<PreviousInstanceGroup>();
        var currentGroup: PreviousInstanceGroup | undefined;
        var prevEvent: unknown;

        if (!normalizedUserId) {
            return data;
        }

        const rows = await queryGameLog('previousInstancesByUserIdRows', {
            userId: normalizedUserId
        });
        for (const row of Array.isArray(rows) ? rows : []) {
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
        const rows = await queryGameLog('playersFromInstanceRows', {
            location
        });
        for (const rowData of Array.isArray(rows) ? rows : []) {
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
        const rows = await queryGameLog('joinLeaveRange', {
            location,
            afterDate,
            beforeDate
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getPlayerDetailFromInstance(location: unknown) {
        const rows = await queryGameLog('playerDetailFromInstance', {
            location
        });
        return Array.isArray(rows) ? rows : [];
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
                now.getTime() - fromDays * 86400000
            ).toISOString();
        }
        if (toDays > 0) {
            params.toDate = new Date(
                now.getTime() - toDays * 86400000
            ).toISOString();
        }

        const rows = await queryGameLog('onlineSessions', params);
        return Array.isArray(rows) ? rows : [];
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
        return commands.appGameLogInstanceDeleteByLocation(
            input.location as string
        );
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
        return commands.appGameLogInstanceDelete(
            input.location as string,
            eventIds
        );
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
