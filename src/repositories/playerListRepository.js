import { parseLocation } from '@/shared/utils/locationParser.js';

import sqliteRepository from './sqliteRepository.js';

function normalizeString(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function parseDateMs(value) {
    if (!value) {
        return 0;
    }

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function getRowValue(row, key, index) {
    if (Array.isArray(row)) {
        return row[index];
    }

    if (!row || typeof row !== 'object') {
        return undefined;
    }

    if (key in row) {
        return row[key];
    }

    const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
        letter.toUpperCase()
    );
    if (camelKey in row) {
        return row[camelKey];
    }

    return undefined;
}

function mapLocationRow(row) {
    return {
        createdAt: normalizeString(getRowValue(row, 'created_at', 0)),
        location: normalizeString(getRowValue(row, 'location', 1)),
        worldId: normalizeString(getRowValue(row, 'world_id', 2)),
        worldName: normalizeString(getRowValue(row, 'world_name', 3)),
        time: Number.parseInt(getRowValue(row, 'time', 4), 10) || 0,
        groupName: normalizeString(getRowValue(row, 'group_name', 5))
    };
}

function mapJoinLeaveRow(row) {
    return {
        rowId: normalizeString(getRowValue(row, 'id', 0)),
        createdAt: normalizeString(getRowValue(row, 'created_at', 1)),
        type: normalizeString(getRowValue(row, 'type', 2)),
        displayName: normalizeString(getRowValue(row, 'display_name', 3)),
        userId: normalizeString(getRowValue(row, 'user_id', 4)),
        time: Number.parseInt(getRowValue(row, 'time', 5), 10) || 0
    };
}

function isLiveLocation(location) {
    const normalizedLocation = normalizeString(location);
    return Boolean(
        normalizedLocation &&
        normalizedLocation !== 'offline' &&
        normalizedLocation !== 'private' &&
        normalizedLocation !== 'traveling'
    );
}

function buildPlayerKey(userId) {
    const normalizedUserId = normalizeString(userId);
    if (normalizedUserId) {
        return normalizedUserId;
    }

    return '';
}

function buildAnonymousPlayerKey(event, rowIndex) {
    const rowId = normalizeString(event?.rowId);
    if (rowId) {
        return `row:${rowId}`;
    }

    return ['anonymous', rowIndex, normalizeString(event?.createdAt)].join(':');
}

function findAnonymousPlayerKeyForLeave(playersByKey, event) {
    const leftAtMs = parseDateMs(event?.createdAt);
    const durationMs = Number(event?.time) || 0;
    if (!leftAtMs || durationMs <= 0) {
        return '';
    }

    const joinedAtMs = leftAtMs - durationMs;
    const candidates = [];
    for (const [playerKey, player] of playersByKey.entries()) {
        if (player.userId) {
            continue;
        }
        if (Math.abs((player.joinedAtMs || 0) - joinedAtMs) <= 1000) {
            candidates.push({ playerKey, player });
        }
    }
    candidates.sort((left, right) =>
        String(left.playerKey).localeCompare(String(right.playerKey))
    );

    if (candidates.length === 1) {
        return candidates[0].playerKey;
    }

    const displayName = normalizeString(event?.displayName).toLowerCase();
    if (!displayName) {
        return '';
    }

    const nameMatches = candidates.filter(
        ({ player }) =>
            normalizeString(player.displayName).toLowerCase() === displayName
    );
    return nameMatches.length ? nameMatches[0].playerKey : '';
}

async function resolveCurrentLocationContext(currentLocation) {
    const normalizedLocation = normalizeString(currentLocation);

    if (isLiveLocation(normalizedLocation)) {
        const exactRows = await sqliteRepository.all(
            `SELECT created_at, location, world_id, world_name, time, group_name
             FROM gamelog_location
             WHERE location = @location
             ORDER BY id DESC
             LIMIT 1`,
            {
                '@location': normalizedLocation
            }
        );

        if (Array.isArray(exactRows) && exactRows.length > 0) {
            return {
                ...mapLocationRow(exactRows[0]),
                source: 'database'
            };
        }

        const parsedLocation = parseLocation(normalizedLocation);
        return {
            createdAt: '',
            location: normalizedLocation,
            worldId: parsedLocation.worldId || '',
            worldName: parsedLocation.worldId || normalizedLocation,
            time: 0,
            groupName: '',
            source: 'runtime'
        };
    }

    if (normalizedLocation) {
        return {
            createdAt: '',
            location: normalizedLocation,
            worldId: '',
            worldName: '',
            time: 0,
            groupName: '',
            source: 'runtime'
        };
    }

    const latestRows = await sqliteRepository.all(
        `SELECT created_at, location, world_id, world_name, time, group_name
         FROM gamelog_location
         ORDER BY id DESC
         LIMIT 1`
    );

    if (Array.isArray(latestRows) && latestRows.length > 0) {
        return {
            ...mapLocationRow(latestRows[0]),
            source: 'database'
        };
    }

    return {
        createdAt: '',
        location: '',
        worldId: '',
        worldName: '',
        time: 0,
        groupName: '',
        source: 'none'
    };
}

async function getCurrentInstanceSnapshot({
    currentUserId = '',
    currentLocation = ''
} = {}) {
    const context = await resolveCurrentLocationContext(currentLocation);

    if (!isLiveLocation(context.location)) {
        return {
            context,
            players: []
        };
    }

    const rows = await sqliteRepository.all(
        `SELECT id, created_at, type, display_name, user_id, time
         FROM gamelog_join_leave
         WHERE location = @location
         ORDER BY id ASC`,
        {
            '@location': context.location
        }
    );

    const playersByKey = new Map();
    const normalizedCurrentUserId = normalizeString(currentUserId);

    for (const [rowIndex, row] of (Array.isArray(rows) ? rows : []).entries()) {
        const event = mapJoinLeaveRow(row);
        const playerKey =
            buildPlayerKey(event.userId) ||
            buildAnonymousPlayerKey(event, rowIndex);

        if (event.type === 'OnPlayerJoined') {
            playersByKey.set(playerKey, {
                id: playerKey,
                userId: event.userId,
                displayName: event.displayName || event.userId || playerKey,
                joinedAt: event.createdAt,
                joinedAtMs: parseDateMs(event.createdAt),
                lastDurationMs: event.time
            });
        } else if (event.type === 'OnPlayerLeft') {
            if (event.userId) {
                playersByKey.delete(playerKey);
            } else {
                const anonymousPlayerKey = findAnonymousPlayerKeyForLeave(
                    playersByKey,
                    event
                );
                if (anonymousPlayerKey) {
                    playersByKey.delete(anonymousPlayerKey);
                }
            }
        }
    }

    const players = Array.from(playersByKey.values())
        .filter((player) => {
            const normalizedUserId = normalizeString(player.userId);
            if (
                normalizedCurrentUserId &&
                normalizedUserId === normalizedCurrentUserId
            ) {
                return false;
            }

            return Boolean(player.displayName || normalizedUserId);
        })
        .sort((left, right) => {
            if (left.joinedAtMs !== right.joinedAtMs) {
                return left.joinedAtMs - right.joinedAtMs;
            }

            return String(left.displayName || left.userId || '').localeCompare(
                String(right.displayName || right.userId || ''),
                undefined,
                { sensitivity: 'base' }
            );
        });

    return {
        context: {
            ...context,
            playerCount: players.length
        },
        players
    };
}

const playerListRepository = Object.freeze({
    resolveCurrentLocationContext,
    getCurrentInstanceSnapshot
});

export { resolveCurrentLocationContext, getCurrentInstanceSnapshot };
export default playerListRepository;
