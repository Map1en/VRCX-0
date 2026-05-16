import { backend } from '@/platform/index.js';

const DEFAULT_MAX_TABLE_SIZE = 500;
const DEFAULT_SEARCH_TABLE_SIZE = 50000;

function normalizeCurrentUserId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeGameLogIdentifier(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function addGameLogEntries(kind, entries) {
    return backend.app.GameLogEntriesAdd({
        kind,
        entries: Array.isArray(entries) ? entries : [entries]
    });
}

async function queryGameLog(kind, params = {}) {
    return backend.app.GameLogQuery({
        query: {
            kind,
            params
        }
    });
}

const GAME_LOG_WORLD_NAME_CACHE_LIMIT = 1000;
const EMPTY_WORLD_NAME_CACHE_TTL = 60 * 1000;
const gameLogWorldNameCache = new Map();
const gameLogWorldNameRequests = new Map();

function setCachedGameLogWorldName(worldId, worldName) {
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
        gameLogWorldNameCache.delete(gameLogWorldNameCache.keys().next().value);
    }
}

function getCachedGameLogWorldName(worldId) {
    const normalizedWorldId = normalizeGameLogIdentifier(worldId);
    if (!normalizedWorldId || !gameLogWorldNameCache.has(normalizedWorldId)) {
        return undefined;
    }

    const cached = gameLogWorldNameCache.get(normalizedWorldId);
    if (cached.expiresAt && cached.expiresAt <= Date.now()) {
        gameLogWorldNameCache.delete(normalizedWorldId);
        return undefined;
    }

    return cached.worldName;
}

function rememberGameLogWorldName(worldId, worldName) {
    const normalizedWorldName = normalizeGameLogIdentifier(worldName);
    if (normalizedWorldName) {
        setCachedGameLogWorldName(worldId, normalizedWorldName);
    }
}

const gameLog = {
    async getGamelogDatabase(maxTableSize = DEFAULT_MAX_TABLE_SIZE) {
        var date = new Date();
        date.setDate(date.getDate() - 1); // 24 hour limit
        var dateOffset = date.toJSON();
        const rows = await queryGameLog('recentDatabase', {
            dateOffset,
            maxTableSize
        });
        return Array.isArray(rows) ? rows : [];
    },

    async addGamelogLocationToDatabase(entry) {
        await addGameLogEntries('Location', [entry]);
        rememberGameLogWorldName(entry.worldId, entry.worldName);
    },

    async updateGamelogLocationTimeToDatabase(entry) {
        return addGameLogEntries('LocationTime', [entry]);
    },

    async addGamelogJoinLeaveToDatabase(entry) {
        await addGameLogEntries('JoinLeave', [entry]);
    },

    async addGamelogJoinLeaveBulk(inputData) {
        if (inputData.length === 0) {
            return;
        }
        return addGameLogEntries('JoinLeave', inputData);
    },

    async addGamelogPortalSpawnToDatabase(entry) {
        await addGameLogEntries('PortalSpawn', [entry]);
    },

    async addGamelogVideoPlayToDatabase(entry) {
        await addGameLogEntries('VideoPlay', [entry]);
    },

    async addGamelogResourceLoadToDatabase(entry) {
        await addGameLogEntries('ResourceLoad', [entry]);
    },

    async addGamelogEventToDatabase(entry) {
        await addGameLogEntries('Event', [entry]);
    },

    async addGamelogExternalToDatabase(entry) {
        await addGameLogEntries('External', [entry]);
    },

    async getLastVisit(worldId, currentWorldMatch) {
        return queryGameLog('lastVisit', { worldId, currentWorldMatch });
    },

    async getVisitCount(worldId) {
        return queryGameLog('visitCount', { worldId });
    },

    async getTimeSpentInWorld(worldId) {
        return queryGameLog('timeSpentInWorld', { worldId });
    },

    async getLastGroupVisit(groupId) {
        return queryGameLog('lastGroupVisit', { groupId });
    },

    async getPreviousInstancesByGroupId(groupId) {
        const data = new Map();
        const rows = await queryGameLog('previousInstancesByGroupId', {
            groupId
        });
        for (const row of Array.isArray(rows) ? rows : []) {
            data.set(row.location, row);
        }
        return data;
    },

    async getLastSeen(input, inCurrentWorld) {
        return queryGameLog('lastSeen', {
            userId: input.id,
            displayName: input.displayName,
            inCurrentWorld
        });
    },

    async getJoinCount(input) {
        return queryGameLog('joinCount', {
            userId: input.id,
            displayName: input.displayName
        });
    },

    async getTimeSpent(input) {
        return queryGameLog('timeSpent', {
            userId: input.id,
            displayName: input.displayName
        });
    },

    async getUserStats(input, inCurrentWorld) {
        const result = (await queryGameLog('userStats', {
            userId: input.id,
            displayName: input.displayName,
            inCurrentWorld
        })) as Record<string, any>;
        const ref = {
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

    async getAllUserStats(userIds, displayNames) {
        const rows = await queryGameLog('allUserStats', {
            userIds,
            displayNames
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getGameLogByLocation(
        instanceId,
        filters,
        vipList = [],
        { currentUserId = '', maxEntries = DEFAULT_SEARCH_TABLE_SIZE } = {}
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
        filters,
        vipList,
        maxEntries = DEFAULT_MAX_TABLE_SIZE
    ) {
        const rows = await queryGameLog('lookupRows', {
            filters,
            vipList,
            maxEntries
        });
        return Array.isArray(rows) ? rows : [];
    },

    /**
     * Lookup the game log database for a specific search term
     * @param {string} search The search term
     * @param {Array} filters The filters to apply
     * @param {Array} [vipList] The list of VIP users
     * @returns {Promise<any[]>} The game log data
     */

    async searchGameLogDatabase(
        search,
        filters,
        vipList,
        maxEntries = DEFAULT_SEARCH_TABLE_SIZE,
        currentUserId = ''
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
        var dateOffset = new Date(Date.now() - 86400000).toJSON(); // 24 hours
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

    async getGameLogWorldNameByWorldId(worldId) {
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

    async getPreviousInstancesByUserId(input) {
        const normalizedUserId = normalizeGameLogIdentifier(input?.id);
        var groupingTimeTolerance = 1 * 60 * 60 * 1000; // 1 hour
        var data = new Set();
        var currentGroup;
        var prevEvent;

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

    async getPreviousInstancesByWorldId(input) {
        const rows = await queryGameLog('previousInstancesByWorldId', {
            worldId: input.id
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getPlayersFromInstance(location) {
        var players = new Map();
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
                var playerKey =
                    userId || `${displayName || 'anonymous'}:${rowId}`;
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
                var row = {
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

    async getLocationBeforeOrAt(createdAt) {
        return queryGameLog('locationBeforeOrAt', { createdAt });
    },

    async getJoinLeaveEntriesForLocationRange(location, afterDate, beforeDate) {
        const rows = await queryGameLog('joinLeaveRange', {
            location,
            afterDate,
            beforeDate
        });
        return Array.isArray(rows) ? rows : [];
    },

    /**
     * @param {string} location
     * @returns {Promise<Array<{created_at: string, display_name: string, user_id: string, time: number}>>}
     */
    async getPlayerDetailFromInstance(location) {
        const rows = await queryGameLog('playerDetailFromInstance', {
            location
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getPreviousDisplayNamesByUserId(ref) {
        var data = new Map();
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

    /**
     * Get current user's online sessions from gamelog_location
     * Each row has created_at (leave time) and time (duration in ms)
     * Session start = created_at - time, Session end = created_at
     * @param {number} [fromDays=0] - How many days back to start (0 = all time)
     * @param {number} [toDays=0] - How many days back to stop (0 = now)
     * @returns {Promise<Array<{created_at: string, time: number}>>}
     */
    async getCurrentUserOnlineSessions(fromDays = 0, toDays = 0) {
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

    /**
     * Get current user's online sessions after a given timestamp (incremental).
     * @param {string} afterCreatedAt - Only return rows created after this timestamp
     * @param {boolean} [inclusive=false] - If true, use >= instead of > to re-read the last record
     * @returns {Promise<Array<{created_at: string, time: number}>>}
     */
    async getCurrentUserOnlineSessionsAfter(afterCreatedAt, inclusive = false) {
        const rows = await queryGameLog('onlineSessionsAfter', {
            afterCreatedAt,
            inclusive
        });
        return Array.isArray(rows) ? rows : [];
    },

    /**
     * Get current user's top visited worlds from gamelog_location.
     * Groups by world_id and aggregates visit count and total time.
     * @param {number} [days] - Number of days to look back. Omit or 0 for all time.
     * @param {number} [limit=5] - Maximum number of worlds to return.
     * @param {'time'|'count'} [sortBy='time'] - Sort by total time or visit count.
     * @param {string} [excludeWorldId=''] - Optional world ID to exclude from results.
     * @returns {Promise<Array<{worldId: string, worldName: string, visitCount: number, totalTime: number}>>}
     */
    async getMyTopWorlds(
        days = 0,
        limit = 5,
        sortBy = 'time',
        excludeWorldId = ''
    ) {
        const rows = await queryGameLog('topWorlds', {
            days,
            limit,
            sortBy,
            excludeWorldId
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getUserIdFromDisplayName(displayName) {
        return queryGameLog('userIdFromDisplayName', { displayName });
    },

    /**
     *
     * @param {string} startDate: utc string of startOfDay
     * @param {string} endDate: utc string endOfDay
     * @param startDate
     * @param endDate
     * @returns
     */
    async getInstanceActivity(startDate, endDate, currentUserId = '') {
        const normalizedCurrentUserId = normalizeCurrentUserId(currentUserId);
        const currentUserData = [];
        const detailData = new Map();
        const rows = await queryGameLog('instanceActivityRows', {
            startDate,
            endDate
        });
        for (const rowData of Array.isArray(rows) ? rows : []) {
            // skip dirty data
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

    /**
     * Get the All Date of Instance Activity for the current user
     * @returns {Promise<string[]>}
     */
    async getDateOfInstanceActivity(currentUserId = '') {
        const result = await queryGameLog('dateOfInstanceActivity', {
            userId: normalizeCurrentUserId(currentUserId)
        });
        return Array.isArray(result) ? result : [];
    },

    async getInstanceJoinHistory(currentUserId = '') {
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

    deleteGameLogInstanceByInstanceId(input) {
        return backend.app.GameLogInstanceDeleteByLocation({
            location: input.location
        });
    },

    deleteGameLogInstance(input) {
        const eventIds = Array.isArray(input.events)
            ? input.events
                  .map((value) => Number.parseInt(value, 10))
                  .filter((value) => Number.isFinite(value) && value > 0)
            : [];
        if (!eventIds.length) {
            return Promise.resolve();
        }
        return backend.app.GameLogInstanceDelete({
            location: input.location,
            eventIds
        });
    },

    async deleteGameLogEntry(input) {
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

    async deleteGameLogVideoPlay(input) {
        await backend.app.GameLogEntryDelete({
            kind: 'VideoPlay',
            entry: input
        });
    },

    async deleteGameLogEvent(input) {
        await backend.app.GameLogEntryDelete({
            kind: 'Event',
            entry: input
        });
    },

    async deleteGameLogExternal(input) {
        await backend.app.GameLogEntryDelete({
            kind: 'External',
            entry: input
        });
    },

    async deleteGameLogResourceLoad(input) {
        await backend.app.GameLogEntryDelete({
            kind: input.type || 'ResourceLoad',
            entry: input
        });
    },

    // ── Sessions view queries (read-only, no existing behavior changed) ──

    /**
     * Get Location segments paginated by cursor (id DESC).
     * @param {number|null} beforeId - cursor: only return rows with id < beforeId. null = latest.
     * @param {number} limit - how many segments to fetch.
     * @returns {Promise<Array<{id: number, created_at: string, location: string, worldId: string, worldName: string, time: number, groupName: string}>>}
     */
    async getSessionsLocationSegments(beforeId, limit) {
        const rows = await queryGameLog('sessionsLocationSegments', {
            beforeId,
            limit
        });
        return Array.isArray(rows) ? rows : [];
    },

    async getSessionsLocationSegmentsByDateRange(afterDate, beforeDate, limit) {
        const rows = await queryGameLog('sessionsLocationSegmentsByDateRange', {
            afterDate,
            beforeDate,
            limit
        });
        return Array.isArray(rows) ? rows : [];
    },

    /**
     * Get join/leave and video_play events for a set of location tags within a date range.
     * Excludes the current user's own join/leave.
     * @param {string[]} locationTags - location values to match
     * @param {string} afterDate - ISO date (inclusive lower bound)
     * @param {string} beforeDate - ISO date (inclusive upper bound, with padding)
     * @returns {Promise<Array<object>>}
     */
    async getSessionsEventsForSegments(
        locationTags,
        afterDate,
        beforeDate,
        currentUserId = ''
    ) {
        if (!locationTags || locationTags.length === 0) return [];

        const rows = await queryGameLog('sessionsEventsForSegments', {
            locationTags,
            afterDate,
            beforeDate,
            currentUserId: normalizeCurrentUserId(currentUserId)
        });
        return Array.isArray(rows) ? rows : [];
    },

    /**
     * Get Location segments from a given date onwards (for anchor jumps).
     * Returns segments with created_at >= sinceDate, capped by limit, ordered id DESC.
     * @param {string} sinceDate - ISO date string
     * @param {number} limit - max segments to return
     * @returns {Promise<Array<object>>}
     */
    async getSessionsLocationSegmentsByAnchor(sinceDate, limit) {
        const rows = await queryGameLog('sessionsLocationSegmentsByAnchor', {
            sinceDate,
            limit
        });
        return Array.isArray(rows) ? rows : [];
    }
};

export { gameLog };
export default gameLog;
