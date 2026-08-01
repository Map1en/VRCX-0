import { parseLocation } from '@/shared/utils/location';

import { isSameInstanceLocation } from './instanceRoster';

export type CurrentInstanceRosterSource = 'database' | 'none' | 'runtime';

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

export interface CurrentInstanceRuntimeRoster {
    currentLocation: string;
    currentLocationStartedAt: string | null;
    currentWorldId: string;
    currentWorldName: string;
    players: readonly CurrentInstanceRosterPlayer[];
}

export interface GameLogRosterProjectionPlayer {
    userId: string;
    displayName: string;
    joinTimeMs: number | null;
}

export function includeCurrentUserInRoster({
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
        player.displayName.toLowerCase() === normalizedDisplayName;
    const existingCurrentUser = players.find(isCurrentUser);
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

export function resolveRuntimeCurrentInstanceRoster({
    requestedLocation,
    runtime
}: {
    requestedLocation: string;
    runtime: CurrentInstanceRuntimeRoster;
}): CurrentInstanceRosterSnapshot | null {
    if (
        runtime.players.length === 0 ||
        !isSameInstanceLocation(requestedLocation, runtime.currentLocation)
    ) {
        return null;
    }

    return {
        context: {
            createdAt: runtime.currentLocationStartedAt || '',
            groupName: '',
            location: runtime.currentLocation,
            playerCount: runtime.players.length,
            playerFactsKnown: true,
            source: 'runtime',
            time: 0,
            worldId:
                runtime.currentWorldId ||
                parseLocation(runtime.currentLocation).worldId ||
                '',
            worldName: runtime.currentWorldName
        },
        players: [...runtime.players]
    };
}
