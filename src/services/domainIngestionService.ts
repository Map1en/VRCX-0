import { ingestUserFactEntries } from '@/domain/users/userFactAccess';
import type {
    UserFactMergeOptions,
    UserFactSource
} from '@/domain/users/userFacts';
import { parseLocation } from '@/shared/utils/location';
import { useInstancePresenceStore } from '@/state/instancePresenceStore';
import { useLocationHintStore } from '@/state/locationHintStore';
import { useUserFactsStore } from '@/state/userFactsStore';

interface RecordKnownUserOptions extends UserFactMergeOptions {
    source?: UserFactSource;
}

interface FriendPatchInput {
    endpoint?: unknown;
    userId?: unknown;
    patch?: Record<string, unknown>;
    stateBucket?: unknown;
    stateBucketAuthority?: unknown;
}

interface GameRuntimePresenceInput {
    endpoint?: unknown;
    currentUserId?: unknown;
    currentUserSnapshot?: Record<string, unknown> | null;
    currentLocation?: unknown;
    currentDestination?: unknown;
    currentLocationStartedAt?: unknown;
    currentLocationPlayers?: unknown[];
    currentWorldName?: unknown;
}

interface LocationHintsInput {
    endpoint?: unknown;
    instances?: unknown[];
}

function text(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
}

function toIngestEntry(
    user: Record<string, unknown>,
    options: RecordKnownUserOptions
) {
    return {
        user,
        source: typeof options.source === 'string' ? options.source : 'seed',
        isFriend: Boolean(options.isFriend),
        isCurrentUser: Boolean(options.isCurrentUser),
        stateBucket:
            typeof options.stateBucket === 'string' ? options.stateBucket : ''
    };
}

function recordKnownUser(
    user: Record<string, unknown> | null | undefined,
    options: RecordKnownUserOptions = {}
) {
    if (!user || typeof user !== 'object') {
        return;
    }
    ingestUserFactEntries([toIngestEntry(user, options)]);
}

function recordKnownUsers(
    users: unknown[],
    options: RecordKnownUserOptions = {}
) {
    ingestUserFactEntries(
        (Array.isArray(users) ? users : [])
            .filter((user): user is Record<string, unknown> =>
                Boolean(user && typeof user === 'object')
            )
            .map((user) => toIngestEntry(user, options))
    );
}

function recordCurrentUserSnapshot(
    user: Record<string, unknown> | null | undefined,
    { endpoint = '', source = 'currentUser' }: RecordKnownUserOptions = {}
) {
    recordKnownUser(user, {
        endpoint,
        source,
        isCurrentUser: true
    });
}

function recordFriendPatch({
    endpoint = '',
    userId = '',
    patch = {},
    stateBucket = ''
}: FriendPatchInput = {}) {
    const normalizedUserId = text(userId || patch?.id || patch?.userId);
    if (!normalizedUserId) {
        return;
    }
    recordKnownUser(
        {
            ...patch,
            id: normalizedUserId,
            stateBucket
        },
        {
            endpoint,
            source: 'realtime',
            isFriend: true,
            stateBucket
        }
    );
}

function recordGameRuntimePresence({
    endpoint = '',
    currentUserId = '',
    currentUserSnapshot = null,
    currentLocation = '',
    currentDestination = '',
    currentLocationStartedAt = '',
    currentLocationPlayers = [],
    currentWorldName = ''
}: GameRuntimePresenceInput = {}) {
    const rawCurrentLocation = text(currentLocation);
    const location = rawCurrentLocation || text(currentDestination);
    const currentLocationState = parseLocation(rawCurrentLocation);
    const isTraveling = currentLocationState.isTraveling;
    const travelingToLocation = isTraveling ? text(currentDestination) : '';
    const currentUser = record(currentUserSnapshot);
    const userId = text(currentUserId || currentUser.id || currentUser.userId);
    if (userId) {
        recordKnownUser(
            {
                ...currentUser,
                id: userId,
                location: isTraveling ? 'traveling' : location,
                ...(travelingToLocation
                    ? {
                          travelingToLocation,
                          $travelingToTime: currentLocationStartedAt
                      }
                    : { $location_at: currentLocationStartedAt })
            },
            {
                endpoint,
                source: 'gameRuntime',
                isCurrentUser: true
            }
        );
    }
    if (isTraveling) {
        return;
    }
    const parsed = parseLocation(location);
    if (!parsed.isRealInstance || !parsed.worldId || !parsed.instanceName) {
        return;
    }
    useInstancePresenceStore.getState().upsertInstancePresence({
        endpoint,
        location,
        source: 'gameRuntime',
        worldName: currentWorldName,
        players: currentLocationPlayers,
        receivedAt: currentLocationStartedAt
    });
    useLocationHintStore.getState().upsertLocationHint({
        endpoint,
        location,
        worldId: parsed.worldId,
        groupId: parsed.groupId || '',
        worldName: currentWorldName,
        instanceName: parsed.instanceName,
        region: parsed.region,
        ageGate: parsed.ageGate
    });
    for (const player of Array.isArray(currentLocationPlayers)
        ? currentLocationPlayers
        : []) {
        recordKnownUser(record(player), {
            endpoint,
            source: 'playerSnapshot'
        });
    }
}

function instanceLocation(instance: unknown): string {
    const source = record(instance);
    const nestedLocation = record(source.$location);
    const directLocation = text(
        source.location || source.tag || nestedLocation.tag
    );
    if (directLocation) {
        return directLocation;
    }
    const worldId = text(source.worldId || nestedLocation.worldId);
    const instanceId = text(source.instanceId || nestedLocation.instanceId);
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

function recordLocationHintsFromInstances({
    endpoint = '',
    instances = []
}: LocationHintsInput = {}) {
    for (const instance of Array.isArray(instances) ? instances : []) {
        const source = record(instance);
        const location = instanceLocation(source);
        if (!location) {
            continue;
        }
        const parsed = parseLocation(location);
        useLocationHintStore.getState().upsertLocationHint({
            endpoint,
            location,
            worldId: parsed.worldId || source.worldId,
            groupId: parsed.groupId || source.groupId,
            worldName:
                source.worldName ||
                record(source.world).name ||
                record(source.ref).worldName,
            groupName:
                source.groupName ||
                record(source.group).name ||
                record(source.group).displayName,
            instanceName:
                source.displayName ||
                source.instanceDisplayName ||
                parsed.instanceName,
            region: parsed.region || source.region,
            isClosed: source.closedAt || source.closed_at || source.isClosed,
            ageGate: source.ageGate || parsed.ageGate
        });
        const users = [
            ...(Array.isArray(source.users) ? source.users : []),
            ...(Array.isArray(source.players) ? source.players : []),
            ...(Array.isArray(source.playerList) ? source.playerList : []),
            ...(Array.isArray(source.userList) ? source.userList : []),
            ...(Array.isArray(source.userIds)
                ? source.userIds.map((userId: unknown) =>
                      typeof userId === 'string'
                          ? {
                                id: userId,
                                userId,
                                displayName: userId
                            }
                          : userId
                  )
                : []),
            ...(source.usersById && typeof source.usersById === 'object'
                ? Object.values(source.usersById)
                : [])
        ];
        recordKnownUsers(users, {
            endpoint,
            source: 'instance'
        });
        useInstancePresenceStore.getState().upsertInstancePresence({
            endpoint,
            location,
            source: 'instance',
            ownerUserId: source.ownerId,
            ownerGroupId: parsed.groupId || source.groupId,
            worldName:
                source.worldName ||
                record(source.world).name ||
                record(source.ref).worldName,
            groupName:
                source.groupName ||
                record(source.group).name ||
                record(source.group).displayName,
            instanceName:
                source.displayName ||
                source.instanceDisplayName ||
                parsed.instanceName,
            players: users
        });
    }
}

function resetDomainFacts() {
    useUserFactsStore.getState().resetUserFacts();
    useInstancePresenceStore.getState().resetInstancePresence();
    useLocationHintStore.getState().resetLocationHints();
}

export {
    recordCurrentUserSnapshot,
    recordFriendPatch,
    recordGameRuntimePresence,
    recordKnownUser,
    recordKnownUsers,
    recordLocationHintsFromInstances,
    resetDomainFacts
};
