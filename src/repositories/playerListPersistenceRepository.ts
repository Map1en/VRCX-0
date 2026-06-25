import { commands } from '@/platform/tauri/bindings';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';

type RowRecord = Record<string, unknown>;

type PlayerListLocationRow = {
    createdAt: string;
    location: string;
    worldId: string;
    worldName: string;
    time: number;
    groupName: string;
};

type PlayerListContext = PlayerListLocationRow & {
    source: 'database' | 'runtime' | 'none';
    playerCount?: number;
    observedPlayerEventCount?: number;
    playerFactsKnown?: boolean;
};

type PlayerListJoinLeaveRow = {
    rowId: string;
    createdAt: string;
    type: string;
    displayName: string;
    userId: string;
    time: number;
};

type PlayerListPlayer = {
    id: string;
    userId: string;
    displayName: string;
    joinedAt: string;
    joinedAtMs: number;
    lastDurationMs: number;
};

type PlayerCandidate = {
    playerKey: string;
    player: PlayerListPlayer;
};

type PlayerListRoster = {
    players: PlayerListPlayer[];
    observedPlayerEventCount: number;
};

interface CurrentInstanceSnapshotInput {
    currentUserId?: unknown;
    currentLocation?: unknown;
    currentLocationStartedAt?: unknown;
}

function parseDateMs(value: unknown) {
    if (!value) {
        return 0;
    }

    const timestamp = Date.parse(normalizeString(value));
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function resolveSnapshotContext(
    context: PlayerListContext,
    currentLocationStartedAt: unknown
) {
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

function getRowValue(row: unknown, key: string, index: number) {
    if (Array.isArray(row)) {
        return row[index];
    }

    if (!row || typeof row !== 'object') {
        return undefined;
    }

    const record = row as RowRecord;
    if (key in record) {
        return record[key];
    }

    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) =>
        letter.toUpperCase()
    );
    if (camelKey in record) {
        return record[camelKey];
    }

    return undefined;
}

function mapLocationRow(row: unknown): PlayerListLocationRow {
    return {
        createdAt: normalizeString(getRowValue(row, 'created_at', 0)),
        location: normalizeString(getRowValue(row, 'location', 1)),
        worldId: normalizeString(getRowValue(row, 'world_id', 2)),
        worldName: normalizeString(getRowValue(row, 'world_name', 3)),
        time: Number.parseInt(getRowValue(row, 'time', 4), 10) || 0,
        groupName: normalizeString(getRowValue(row, 'group_name', 5))
    };
}

function mapJoinLeaveRow(row: unknown): PlayerListJoinLeaveRow {
    return {
        rowId: normalizeString(getRowValue(row, 'id', 0)),
        createdAt: normalizeString(getRowValue(row, 'created_at', 1)),
        type: normalizeString(getRowValue(row, 'type', 2)),
        displayName: normalizeString(getRowValue(row, 'display_name', 3)),
        userId: normalizeString(getRowValue(row, 'user_id', 4)),
        time: Number.parseInt(getRowValue(row, 'time', 5), 10) || 0
    };
}

function isLiveLocation(location: unknown) {
    const normalizedLocation = normalizeString(location);
    return Boolean(
        normalizedLocation &&
        normalizedLocation !== 'offline' &&
        normalizedLocation !== 'private' &&
        normalizedLocation !== 'traveling'
    );
}

function buildPlayerKey(userId: unknown) {
    const normalizedUserId = normalizeString(userId);
    if (normalizedUserId) {
        return normalizedUserId;
    }

    return '';
}

function buildAnonymousPlayerKey(
    event: PlayerListJoinLeaveRow,
    rowIndex: number
) {
    const rowId = normalizeString(event?.rowId);
    if (rowId) {
        return `row:${rowId}`;
    }

    return ['anonymous', rowIndex, normalizeString(event?.createdAt)].join(':');
}

function findAnonymousPlayerKeyForLeave(
    playersByKey: Map<string, PlayerListPlayer>,
    event: PlayerListJoinLeaveRow
) {
    const leftAtMs = parseDateMs(event?.createdAt);
    const durationMs = Number(event?.time) || 0;
    if (!leftAtMs || durationMs <= 0) {
        return '';
    }

    const joinedAtMs = leftAtMs - durationMs;
    const candidates: PlayerCandidate[] = [];
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

function findPlayerKeyForLeave(
    playersByKey: Map<string, PlayerListPlayer>,
    event: PlayerListJoinLeaveRow
) {
    const playerKey = buildPlayerKey(event.userId);
    if (playerKey && playersByKey.has(playerKey)) {
        return playerKey;
    }

    const displayName = normalizeString(event?.displayName).toLowerCase();
    if (displayName) {
        const matches = Array.from(playersByKey.entries()).filter(
            ([, player]) =>
                normalizeString(player.displayName).toLowerCase() ===
                displayName
        );
        if (matches.length === 1) {
            return matches[0][0];
        }
    }

    return findAnonymousPlayerKeyForLeave(playersByKey, event);
}

async function resolveCurrentLocationContext(
    currentLocation: unknown
): Promise<PlayerListContext> {
    const normalizedLocation = normalizeString(currentLocation);

    if (isLiveLocation(normalizedLocation)) {
        const exactRow =
            await commands.appPlayerListLocationGet(normalizedLocation);

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

    const latestRow = await commands.appPlayerListLatestLocationGet();

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

async function rebuildInstanceRoster(
    location: string,
    startedAt: string,
    normalizedCurrentUserId: string
): Promise<PlayerListRoster> {
    const startedAtMs = parseDateMs(startedAt);
    const rows = await commands.appPlayerListJoinLeaveRows(
        location,
        startedAtMs ? startedAt : ''
    );

    const playersByKey = new Map<string, PlayerListPlayer>();
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
            const leavePlayerKey = findPlayerKeyForLeave(playersByKey, event);
            if (leavePlayerKey) {
                playersByKey.delete(leavePlayerKey);
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

    return { players, observedPlayerEventCount };
}

async function getCurrentInstanceSnapshot({
    currentUserId = '',
    currentLocation = '',
    currentLocationStartedAt = ''
}: CurrentInstanceSnapshotInput = {}): Promise<{
    context: PlayerListContext;
    players: PlayerListPlayer[];
}> {
    const locationContext =
        await resolveCurrentLocationContext(currentLocation);
    const context = resolveSnapshotContext(
        locationContext,
        currentLocationStartedAt
    );

    if (!isLiveLocation(context.location)) {
        return {
            context,
            players: []
        };
    }

    const normalizedCurrentUserId = normalizeString(currentUserId);
    let roster = await rebuildInstanceRoster(
        context.location,
        context.createdAt,
        normalizedCurrentUserId
    );
    let effectiveContext = context;

    const dbStartedAtMs = parseDateMs(locationContext.createdAt);
    if (
        roster.players.length === 0 &&
        dbStartedAtMs > 0 &&
        dbStartedAtMs < parseDateMs(context.createdAt)
    ) {
        const dbRoster = await rebuildInstanceRoster(
            locationContext.location,
            locationContext.createdAt,
            normalizedCurrentUserId
        );
        if (dbRoster.players.length > 0) {
            roster = dbRoster;
            effectiveContext = locationContext;
        }
    }

    return {
        context: {
            ...effectiveContext,
            playerCount: roster.players.length,
            observedPlayerEventCount: roster.observedPlayerEventCount,
            playerFactsKnown: roster.observedPlayerEventCount > 0
        },
        players: roster.players
    };
}

const playerListPersistenceRepository = Object.freeze({
    resolveCurrentLocationContext,
    getCurrentInstanceSnapshot
});

export { resolveCurrentLocationContext, getCurrentInstanceSnapshot };
export default playerListPersistenceRepository;
