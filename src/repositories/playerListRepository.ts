import { backend } from '@/platform/index.js';
import { parseLocation } from '@/shared/utils/locationParser.js';

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

function resolveSnapshotContext(context, currentLocationStartedAt) {
    const runtimeStartedAt = normalizeString(currentLocationStartedAt);
    const runtimeStartedAtMs = parseDateMs(runtimeStartedAt);
    const contextStartedAtMs = parseDateMs(context?.createdAt);

    if (runtimeStartedAtMs > contextStartedAtMs) {
        return {
            ...context,
            createdAt: runtimeStartedAt
        };
    }

    return context;
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
        const exactRow = await backend.app.PlayerListLocationGet({
            location: normalizedLocation
        });

        if (exactRow) {
            return {
                ...mapLocationRow(exactRow),
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

    const latestRow = await backend.app.PlayerListLatestLocationGet();

    if (latestRow) {
        return {
            ...mapLocationRow(latestRow),
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
    currentLocation = '',
    currentLocationStartedAt = ''
} = {}) {
    const context = resolveSnapshotContext(
        await resolveCurrentLocationContext(currentLocation),
        currentLocationStartedAt
    );

    if (!isLiveLocation(context.location)) {
        return {
            context,
            players: []
        };
    }

    const startedAtMs = parseDateMs(context.createdAt);
    const rows = await backend.app.PlayerListJoinLeaveRows({
        location: context.location,
        startedAt: startedAtMs ? context.createdAt : ''
    });

    const playersByKey = new Map();
    const normalizedCurrentUserId = normalizeString(currentUserId);
    let observedPlayerEventCount = 0;

    for (const [rowIndex, row] of (Array.isArray(rows) ? rows : []).entries()) {
        const event = mapJoinLeaveRow(row);
        const eventTime = parseDateMs(event.createdAt);
        if (startedAtMs && (!eventTime || eventTime < startedAtMs)) {
            continue;
        }
        observedPlayerEventCount += 1;

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
            playerCount: players.length,
            observedPlayerEventCount,
            playerFactsKnown: observedPlayerEventCount > 0
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
