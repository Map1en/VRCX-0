/**
 * Filter a game log row by search query.
 * @param {object} row
 * @param {string} searchQuery
 * @returns {boolean}
 */
function gameLogSearchFilter(row, searchQuery) {
    const value = searchQuery.trim().toUpperCase();
    if (!value) {
        return true;
    }
    if (
        (value.startsWith('WRLD_') || value.startsWith('GRP_')) &&
        String(row.location).toUpperCase().includes(value)
    ) {
        return true;
    }
    switch (row.type) {
        case 'Location':
            if (String(row.worldName).toUpperCase().includes(value)) {
                return true;
            }
            return false;
        case 'OnPlayerJoined':
            if (String(row.displayName).toUpperCase().includes(value)) {
                return true;
            }
            return false;
        case 'OnPlayerLeft':
            if (String(row.displayName).toUpperCase().includes(value)) {
                return true;
            }
            return false;
        case 'PortalSpawn':
            if (String(row.displayName).toUpperCase().includes(value)) {
                return true;
            }
            if (String(row.worldName).toUpperCase().includes(value)) {
                return true;
            }
            return false;
        case 'Event':
            if (String(row.data).toUpperCase().includes(value)) {
                return true;
            }
            return false;
        case 'External':
            if (String(row.message).toUpperCase().includes(value)) {
                return true;
            }
            if (String(row.displayName).toUpperCase().includes(value)) {
                return true;
            }
            return false;
        case 'VideoPlay':
            if (String(row.displayName).toUpperCase().includes(value)) {
                return true;
            }
            if (String(row.videoName).toUpperCase().includes(value)) {
                return true;
            }
            if (String(row.videoUrl).toUpperCase().includes(value)) {
                return true;
            }
            return false;
        case 'StringLoad':
        case 'ImageLoad':
            if (String(row.resourceUrl).toUpperCase().includes(value)) {
                return true;
            }
            return false;
    }
    return true;
}

/**
 * Extract a millisecond timestamp from a game log row.
 * Handles numeric (seconds or millis), ISO string, and dayjs-parseable formats.
 * @param {object} row
 * @returns {number} millisecond timestamp, or 0 if unparseable
 */
function getGameLogCreatedAtTs(row) {
    // dynamic import avoided — dayjs is a lightweight dep already used by the
    // consumer; we import it lazily to keep the module usable without bundler
    // context in tests (dayjs is a CJS/ESM dual package).
    const createdAtRaw = row?.created_at ?? row?.createdAt ?? row?.dt;
    if (typeof createdAtRaw === 'number') {
        const ts =
            createdAtRaw > 1_000_000_000_000
                ? createdAtRaw
                : createdAtRaw * 1000;
        return Number.isFinite(ts) ? ts : 0;
    }

    const createdAt = typeof createdAtRaw === 'string' ? createdAtRaw : '';
    // dayjs is imported at the call site (store) — here we do a simple
    // Date.parse fallback to stay dependency-free.
    const ts = Date.parse(createdAt);
    return Number.isFinite(ts) ? ts : 0;
}

/**
 * Compare two game log rows for descending sort order.
 * Primary key: created_at timestamp (newest first).
 * Secondary: rowId (highest first).
 * Tertiary: uid string (reverse lexicographic).
 * @param {object} a
 * @param {object} b
 * @returns {number} negative if a should come first, positive if b first
 */
function compareGameLogRows(a, b) {
    const aTs = getGameLogCreatedAtTs(a);
    const bTs = getGameLogCreatedAtTs(b);
    if (aTs !== bTs) {
        return bTs - aTs;
    }

    const aRowId = typeof a?.rowId === 'number' ? a.rowId : 0;
    const bRowId = typeof b?.rowId === 'number' ? b.rowId : 0;
    if (aRowId !== bRowId) {
        return bRowId - aRowId;
    }

    const aUid = typeof a?.uid === 'string' ? a.uid : '';
    const bUid = typeof b?.uid === 'string' ? b.uid : '';
    return aUid < bUid ? 1 : aUid > bUid ? -1 : 0;
}

export { gameLogSearchFilter, getGameLogCreatedAtTs, compareGameLogRows };

/**
 * Create a Location game log entry.
 * @param {string} dt
 * @param {string} location
 * @param {string} worldId
 * @param {string} worldName
 * @returns {object}
 */
export function createLocationEntry(dt, location, worldId, worldName) {
    return {
        created_at: dt,
        type: 'Location',
        location,
        worldId,
        worldName,
        groupName: '',
        time: 0
    };
}

/**
 * Create a player join or leave game log entry.
 * @param {'OnPlayerJoined'|'OnPlayerLeft'} type
 * @param {string} dt
 * @param {string} displayName
 * @param {string} location
 * @param {string} userId
 * @param {number} [time]
 * @returns {object}
 */
export function createJoinLeaveEntry(
    type,
    dt,
    displayName,
    location,
    userId,
    time = 0
) {
    return {
        created_at: dt,
        type,
        displayName,
        location,
        userId,
        time
    };
}

/**
 * Create a PortalSpawn game log entry.
 * @param {string} dt
 * @param {string} location
 * @returns {object}
 */
export function createPortalSpawnEntry(dt, location) {
    return {
        created_at: dt,
        type: 'PortalSpawn',
        location,
        displayName: '',
        userId: '',
        instanceId: '',
        worldName: ''
    };
}

/**
 * Create a resource load game log entry.
 * @param {string} rawType - 'resource-load-string' or 'resource-load-image'
 * @param {string} dt
 * @param {string} resourceUrl
 * @param {string} location
 * @returns {object}
 */
export function createResourceLoadEntry(rawType, dt, resourceUrl, location) {
    return {
        created_at: dt,
        type: rawType === 'resource-load-string' ? 'StringLoad' : 'ImageLoad',
        resourceUrl,
        location
    };
}

/**
 * Parse an API request URL for inventory info.
 * Matches: /api/1/user/{userId}/inventory/{inventoryId}
 * @example
 * // https://api.vrchat.cloud/api/1/user/usr_032383a7-748c-4fb2-94e4-bcb928e5de6b/inventory/inv_75781d65-92fe-4a80-a1ff-27ee6e843b08
 * @param {string} url
 * @returns {{ userId: string, inventoryId: string } | null}
 */
export function parseInventoryFromUrl(url) {
    try {
        const parsed = new URL(url);
        if (
            parsed.pathname.substring(0, 12) === '/api/1/user/' &&
            parsed.pathname.includes('/inventory/inv_')
        ) {
            const pathArray = parsed.pathname.split('/');
            const userId = pathArray[4];
            const inventoryId = pathArray[6];
            if (userId && inventoryId && inventoryId.length === 40) {
                return { userId, inventoryId };
            }
        }
    } catch {
        // invalid URL
    }
    return null;
}

/**
 * Parse an API request URL for print info.
 * Matches: /api/1/prints/{printId}
 * @param {string} url
 * @returns {string|null} printId or null
 */
export function parsePrintFromUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.pathname.substring(0, 14) === '/api/1/prints/') {
            const pathArray = parsed.pathname.split('/');
            const printId = pathArray[4];
            if (printId && printId.length === 41) {
                return printId;
            }
        }
    } catch {
        // invalid URL
    }
    return null;
}

const SESSION_TOLERANCE_MS = 1000;
const SESSION_AGGREGATE_THRESHOLD = 5;
const SESSION_AGGREGATE_WINDOW_MS = 5000;

function toGameLogSessionEpoch(dateStr) {
    if (!dateStr) {
        return 0;
    }
    const timestamp = Date.parse(dateStr);
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function findGameLogSessionIndex(eventEpoch, segmentsAsc) {
    const target = eventEpoch + SESSION_TOLERANCE_MS;
    for (let index = segmentsAsc.length - 1; index >= 0; index -= 1) {
        if (segmentsAsc[index].epoch <= target) {
            return index;
        }
    }
    return -1;
}

function findMatchingGameLogSessionIndex(event, segmentsAsc, locationMap) {
    const eventEpoch = toGameLogSessionEpoch(event.created_at);
    const target = eventEpoch + SESSION_TOLERANCE_MS;
    const candidates = event.location ? locationMap.get(event.location) : null;

    if (candidates && candidates.length > 0) {
        for (let index = candidates.length - 1; index >= 0; index -= 1) {
            const segmentIndex = candidates[index];
            if (segmentsAsc[segmentIndex].epoch <= target) {
                return segmentIndex;
            }
        }
        return -1;
    }

    return findGameLogSessionIndex(eventEpoch, segmentsAsc);
}

function toGameLogSessionMember(event) {
    return {
        displayName: event.displayName,
        userId: event.userId,
        created_at: event.created_at,
        isFriend: event.isFriend,
        isFavorite: event.isFavorite
    };
}

function makeGameLogSessionGroup(groupType, batch) {
    return {
        type: groupType,
        created_at: batch[0].created_at,
        count: batch.length,
        members: batch.map(toGameLogSessionMember)
    };
}

function aggregateGameLogSessionTailEvents(events, matchType, groupType) {
    if (events.length === 0) {
        return;
    }

    let lastIndex = -1;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index].type === matchType) {
            lastIndex = index;
            break;
        }
    }
    if (lastIndex === -1) {
        return;
    }

    const windowStart =
        toGameLogSessionEpoch(events[lastIndex].created_at) - SESSION_AGGREGATE_WINDOW_MS;
    const indices = [];
    for (let index = lastIndex; index >= 0; index -= 1) {
        if (toGameLogSessionEpoch(events[index].created_at) < windowStart) {
            break;
        }
        if (events[index].type === matchType) {
            indices.unshift(index);
        }
    }
    if (indices.length < SESSION_AGGREGATE_THRESHOLD) {
        return;
    }

    const batch = indices.map((index) => events[index]);
    const group = makeGameLogSessionGroup(groupType, batch);
    for (let index = indices.length - 1; index >= 0; index -= 1) {
        events.splice(indices[index], 1);
    }
    events.splice(indices[0], 0, group);
}

function aggregateGameLogSessionHeadEvents(events, matchType, groupType) {
    if (events.length === 0) {
        return;
    }

    let firstIndex = -1;
    for (let index = 0; index < events.length; index += 1) {
        if (events[index].type === matchType) {
            firstIndex = index;
            break;
        }
    }
    if (firstIndex === -1) {
        return;
    }

    const windowEnd =
        toGameLogSessionEpoch(events[firstIndex].created_at) + SESSION_AGGREGATE_WINDOW_MS;
    const indices = [];
    for (let index = firstIndex; index < events.length; index += 1) {
        if (toGameLogSessionEpoch(events[index].created_at) > windowEnd) {
            break;
        }
        if (events[index].type === matchType) {
            indices.push(index);
        }
    }
    if (indices.length < SESSION_AGGREGATE_THRESHOLD) {
        return;
    }

    const batch = indices.map((index) => events[index]);
    const group = makeGameLogSessionGroup(groupType, batch);
    for (let index = indices.length - 1; index >= 0; index -= 1) {
        events.splice(indices[index], 1);
    }
    events.splice(indices[0], 0, group);
}

function applyGameLogSessionAggregation(segmentsAsc) {
    for (const segment of segmentsAsc) {
        aggregateGameLogSessionTailEvents(segment.events, 'OnPlayerLeft', 'LeftGroup');
        aggregateGameLogSessionTailEvents(segment.events, 'OnPlayerJoined', 'JoinGroup');
        aggregateGameLogSessionHeadEvents(segment.events, 'OnPlayerJoined', 'JoinGroup');
    }
}

function deduplicateGameLogSessionVideoPlay(events) {
    for (let index = events.length - 1; index > 0; index -= 1) {
        if (
            events[index].type === 'VideoPlay' &&
            events[index - 1].type === 'VideoPlay' &&
            events[index].videoUrl === events[index - 1].videoUrl
        ) {
            events[index - 1].playCount =
                (events[index - 1].playCount || 1) + (events[index].playCount || 1);
            events.splice(index, 1);
        }
    }
    for (const event of events) {
        if (event.type === 'VideoPlay' && !event.playCount) {
            event.playCount = 1;
        }
    }
}

export function buildGameLogSessions(locationSegments, flatEvents) {
    if (!locationSegments || locationSegments.length === 0) {
        return { segments: [] };
    }

    const segmentsAsc = locationSegments
        .map((location) => ({
            id: location.id,
            created_at: location.created_at,
            epoch: toGameLogSessionEpoch(location.created_at),
            location: location.location,
            worldId: location.worldId,
            worldName: location.worldName,
            groupName: location.groupName,
            duration: location.time || null,
            events: []
        }))
        .sort((left, right) => left.epoch - right.epoch);

    let dedupedEvents = flatEvents;
    if (flatEvents && flatEvents.length > 0) {
        const seen = new Set();
        dedupedEvents = flatEvents.filter((event) => {
            const key = `${event.type}\0${event.created_at}\0${event.userId || ''}\0${event.location || ''}\0${event.videoUrl || ''}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    const locationMap = new Map();
    for (let index = 0; index < segmentsAsc.length; index += 1) {
        const location = segmentsAsc[index].location;
        if (!locationMap.has(location)) {
            locationMap.set(location, []);
        }
        locationMap.get(location).push(index);
    }

    if (dedupedEvents && dedupedEvents.length > 0) {
        for (const event of dedupedEvents) {
            const index = findMatchingGameLogSessionIndex(event, segmentsAsc, locationMap);
            if (index === -1) {
                continue;
            }
            segmentsAsc[index].events.push({ ...event });
        }
    }

    for (const segment of segmentsAsc) {
        segment.events.sort(
            (left, right) =>
                toGameLogSessionEpoch(left.created_at) - toGameLogSessionEpoch(right.created_at)
        );
    }

    for (const segment of segmentsAsc) {
        const cutoff = segment.epoch - SESSION_TOLERANCE_MS;
        segment.events = segment.events.filter(
            (event) => toGameLogSessionEpoch(event.created_at) >= cutoff
        );
    }

    for (const segment of segmentsAsc) {
        const windowEnd = segment.epoch + SESSION_AGGREGATE_WINDOW_MS;
        const joinedIds = new Set();
        for (const event of segment.events) {
            if (toGameLogSessionEpoch(event.created_at) > windowEnd) {
                break;
            }
            if (event.type === 'OnPlayerJoined' && event.userId) {
                joinedIds.add(event.userId);
            }
        }
        if (joinedIds.size > 0) {
            for (let index = segment.events.length - 1; index >= 0; index -= 1) {
                const event = segment.events[index];
                if (toGameLogSessionEpoch(event.created_at) > windowEnd) {
                    continue;
                }
                if (
                    event.type === 'OnPlayerLeft' &&
                    event.userId &&
                    joinedIds.has(event.userId)
                ) {
                    segment.events.splice(index, 1);
                }
            }
        }
    }

    applyGameLogSessionAggregation(segmentsAsc);

    for (const segment of segmentsAsc) {
        deduplicateGameLogSessionVideoPlay(segment.events);
    }
    for (const segment of segmentsAsc) {
        segment.events.reverse();
    }

    const segments = segmentsAsc.reverse().map(({ epoch: _epoch, ...rest }) => rest);
    return { segments };
}
