type CurrentInstanceRosterSource = 'none' | 'runtime';

export interface CurrentInstanceRosterContext {
    createdAt: string;
    groupName: string;
    location: string;
    observedPlayerEventCount?: number | null;
    playerCount: number;
    playerFactsKnown?: boolean | null;
    source: CurrentInstanceRosterSource;
    time: number;
    worldId: string;
    worldName: string;
}

export interface CurrentInstanceRosterPlayer {
    id: string;
    userId: string;
    displayName: string;
    joinedAt: string;
    joinedAtMs: number;
    lastDurationMs?: number;
    source?: 'runtime';
}

export interface CurrentInstanceRosterSnapshot {
    context: CurrentInstanceRosterContext;
    players: CurrentInstanceRosterPlayer[];
}

export interface GameLogRosterProjectionPlayer {
    userId: string;
    displayName: string;
    joinTimeMs: number | null;
}

export function decorateCurrentUserInRoster({
    currentUserDisplayName,
    currentUserId,
    joinedAt,
    players
}: {
    currentUserDisplayName: string;
    currentUserId: string;
    joinedAt: string;
    players: readonly CurrentInstanceRosterPlayer[];
}): CurrentInstanceRosterPlayer[] {
    if (!currentUserId || !currentUserDisplayName) {
        return [...players];
    }

    const normalizedDisplayName = currentUserDisplayName.toLowerCase();
    const isCurrentUser = (player: CurrentInstanceRosterPlayer) =>
        player.userId === currentUserId ||
        (!player.userId &&
            player.displayName.toLowerCase() === normalizedDisplayName);
    const existingCurrentUser = players.find(isCurrentUser);
    if (!existingCurrentUser) {
        return [...players];
    }
    const joinedAtMs = Date.parse(joinedAt);
    return [
        {
            ...existingCurrentUser,
            id: currentUserId,
            userId: currentUserId,
            displayName: currentUserDisplayName,
            joinedAt: existingCurrentUser?.joinedAt || joinedAt,
            joinedAtMs:
                existingCurrentUser?.joinedAtMs ||
                (Number.isFinite(joinedAtMs) ? joinedAtMs : 0),
            lastDurationMs: existingCurrentUser?.lastDurationMs || 0,
            source: 'runtime'
        },
        ...players.filter((player) => !isCurrentUser(player))
    ];
}

export function collectRuntimeRosterPlayers(
    projectionPlayers: readonly GameLogRosterProjectionPlayer[]
): {
    playerIds: string[];
    players: CurrentInstanceRosterPlayer[];
} {
    const playersByKey = new Map<string, CurrentInstanceRosterPlayer>();
    for (const player of projectionPlayers) {
        if (!player.userId && !player.displayName) {
            continue;
        }
        const joinTime = player.joinTimeMs || 0;
        playersByKey.set(player.userId || `display:${player.displayName}`, {
            id: player.userId || `display:${player.displayName}`,
            userId: player.userId,
            displayName: player.displayName,
            joinedAt: joinTime ? new Date(joinTime).toISOString() : '',
            joinedAtMs: joinTime,
            lastDurationMs: 0,
            source: 'runtime'
        });
    }

    const players = Array.from(playersByKey.values());
    return {
        playerIds: Array.from(
            new Set(players.map((player) => player.userId).filter(Boolean))
        ),
        players
    };
}
