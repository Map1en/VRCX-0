import { isRealInstance } from './instance';
import {
    locationSentinel,
    normalizeLocationStatus,
    normalizeLocationValue,
    parseLocation,
    resolveFriendPresenceLocation
} from './location';
import { normalizeString } from './string';

export type CurrentUserPresenceRecord = Record<string, unknown>;

export interface CurrentUserPresenceGameState {
    isGameRunning?: boolean | null;
    currentLocation?: string | null;
    currentDestination?: string | null;
    currentWorldId?: string | null;
}

export interface CurrentUserPresenceOptions {
    currentUserSnapshot?: CurrentUserPresenceRecord | null;
    gameState?: CurrentUserPresenceGameState | null;
}

export interface CurrentUserPresencePatch extends CurrentUserPresenceRecord {
    location: string;
    worldId: string;
    instanceId: string;
    travelingToLocation: string;
    travelingToWorld: string;
    travelingToInstance: string;
    state: 'online';
    stateBucket: 'online';
}

const HIDDEN_LOCATION_STATUSES = new Set(['offline', 'private', 'traveling']);

const CURRENT_USER_PRESENCE_FIELDS = [
    'location',
    '$location',
    '$location_at',
    'locationUpdatedAt',
    'worldId',
    'instanceId',
    'travelingToLocation',
    'travelingToWorld',
    'travelingToInstance',
    '$travelingToLocation',
    '$travelingToTime',
    'state',
    'stateBucket',
    'status',
    'statusDescription',
    'pendingOffline'
];

export function isVisibleCurrentUserLocation(value: unknown): boolean {
    const location = normalizeLocationStatus(value);
    return Boolean(location && !HIDDEN_LOCATION_STATUSES.has(location));
}

function hasVisibleCurrentUserPresence(
    profile: CurrentUserPresenceRecord | null | undefined
): boolean {
    return isVisibleCurrentUserLocation(resolveFriendPresenceLocation(profile));
}

function currentGameStateLocationTarget(
    gameState: CurrentUserPresenceGameState | null | undefined
): string {
    const currentLocation = normalizeString(gameState?.currentLocation);
    if (currentLocation === 'traveling') {
        return normalizeString(gameState?.currentDestination);
    }
    return currentLocation;
}

function buildPresenceLocationTag(world: unknown, instance: unknown): string {
    const worldId = normalizeString(world);
    const instanceId = normalizeString(instance);
    if (!worldId) {
        return '';
    }
    return isRealInstance(worldId) && instanceId
        ? `${worldId}:${instanceId}`
        : worldId;
}

function preferVisibleLocation(primary: unknown, fallback: unknown): string {
    if (isVisibleCurrentUserLocation(primary)) {
        return normalizeLocationValue(primary);
    }
    if (isVisibleCurrentUserLocation(fallback)) {
        return normalizeLocationValue(fallback);
    }
    return normalizeString(primary) || normalizeString(fallback);
}

function hasExplicitCurrentUserLocation(
    source: CurrentUserPresenceRecord | null | undefined
): boolean {
    if (!source) {
        return false;
    }
    return [
        'location',
        '$location',
        'worldId',
        'instanceId',
        'travelingToLocation'
    ].some((field) => source[field] !== undefined);
}

function buildPresencePatch({
    location,
    travelingToLocation = '',
    worldId = '',
    instanceId = '',
    source = null
}: {
    location: string | null | undefined;
    travelingToLocation?: string | null;
    worldId?: string | null;
    instanceId?: string | null;
    source?: CurrentUserPresenceRecord | null;
}): CurrentUserPresencePatch | null {
    const normalizedLocation = normalizeLocationValue(location);
    const normalizedTraveling = normalizeLocationValue(travelingToLocation);
    const targetLocation =
        locationSentinel(normalizedLocation) === 'traveling'
            ? normalizedTraveling
            : normalizedLocation;
    if (!isVisibleCurrentUserLocation(targetLocation)) {
        return null;
    }

    const displayTraveling =
        locationSentinel(normalizedLocation) === 'traveling'
            ? normalizedTraveling
            : '';
    const parsedLocation = parseLocation(normalizedLocation);
    const parsedTraveling = parseLocation(displayTraveling);

    return {
        location: normalizedLocation,
        worldId:
            normalizeString(worldId) ||
            parsedLocation.worldId ||
            parsedTraveling.worldId ||
            normalizeString(source?.worldId) ||
            '',
        instanceId:
            parsedLocation.instanceId ||
            normalizeString(instanceId) ||
            normalizeString(source?.instanceId) ||
            '',
        travelingToLocation: displayTraveling,
        travelingToWorld: parsedTraveling.worldId || '',
        travelingToInstance: parsedTraveling.instanceId || '',
        $location: parsedLocation,
        $travelingToLocation: parsedTraveling,
        state: 'online',
        stateBucket: 'online'
    };
}

export function buildCurrentUserGameStatePresencePatch(
    gameState: CurrentUserPresenceGameState | null | undefined,
    currentUser: CurrentUserPresenceRecord | null | undefined
): CurrentUserPresencePatch | null {
    if (!gameState?.isGameRunning) {
        return null;
    }

    const currentLocation = normalizeString(gameState.currentLocation);
    const currentDestination = normalizeString(gameState.currentDestination);
    const targetLocation = currentGameStateLocationTarget(gameState);
    if (!isVisibleCurrentUserLocation(targetLocation)) {
        return null;
    }

    return buildPresencePatch({
        location:
            currentLocation === 'traveling' ? 'traveling' : targetLocation,
        travelingToLocation:
            currentLocation === 'traveling' ? currentDestination : '',
        worldId: gameState.currentWorldId,
        source: currentUser
    });
}

function buildCurrentUserApiPresencePatch(
    currentUser: CurrentUserPresenceRecord | null | undefined
): CurrentUserPresencePatch | null {
    const presence = currentUser?.presence as
        | CurrentUserPresenceRecord
        | null
        | undefined;
    if (!presence || typeof presence !== 'object') {
        return null;
    }

    const directLocation = normalizeLocationValue(presence.location);
    const presenceLocation = buildPresenceLocationTag(
        presence.world,
        presence.instance
    );
    const location = preferVisibleLocation(directLocation, presenceLocation);
    const directTraveling = normalizeLocationValue(
        presence.travelingToLocation
    );
    const presenceTraveling = buildPresenceLocationTag(
        presence.travelingToWorld,
        presence.travelingToInstance
    );
    const travelingToLocation = preferVisibleLocation(
        directTraveling,
        presenceTraveling
    );

    return buildPresencePatch({
        location,
        travelingToLocation,
        worldId: normalizeLocationValue(presence.world),
        instanceId: normalizeLocationValue(presence.instance),
        source: currentUser
    });
}

function mergeCurrentUserSnapshotPresenceFields<
    TProfile extends CurrentUserPresenceRecord | null | undefined
>(
    profile: TProfile,
    snapshot: CurrentUserPresenceRecord | null | undefined
): TProfile {
    if (!profile || !snapshot) {
        return profile;
    }

    let merged = profile;
    for (const field of CURRENT_USER_PRESENCE_FIELDS) {
        const value = snapshot[field];
        if (value === undefined || value === profile[field]) {
            continue;
        }
        if (merged === profile) {
            merged = Object.assign({}, profile);
        }
        merged[field] = value;
    }
    return merged;
}

function normalizeCurrentUserSnapshotPresence(
    snapshot: CurrentUserPresenceRecord | null | undefined
) {
    if (
        !snapshot ||
        hasExplicitCurrentUserLocation(snapshot) ||
        normalizeLocationStatus(snapshot.stateBucket || snapshot.state) ===
            'offline'
    ) {
        return snapshot;
    }

    const apiPresencePatch = buildCurrentUserApiPresencePatch(snapshot);
    return apiPresencePatch ? { ...snapshot, ...apiPresencePatch } : snapshot;
}

export function mergeCurrentUserPresenceFields<
    TUser extends CurrentUserPresenceRecord | null | undefined
>(nextUser: TUser, previousUser: CurrentUserPresenceRecord | null | undefined) {
    if (!nextUser) {
        return nextUser;
    }
    if (hasVisibleCurrentUserPresence(nextUser)) {
        return nextUser;
    }

    const nextApiPresencePatch = buildCurrentUserApiPresencePatch(nextUser);
    if (nextApiPresencePatch) {
        return { ...nextUser, ...nextApiPresencePatch };
    }

    if (!previousUser || typeof previousUser !== 'object') {
        return nextUser;
    }
    const previousApiPresencePatch =
        buildCurrentUserApiPresencePatch(previousUser);
    if (previousApiPresencePatch) {
        return { ...previousUser, ...nextUser, ...previousApiPresencePatch };
    }
    if (!hasVisibleCurrentUserPresence(previousUser)) {
        return nextUser;
    }

    const merged: CurrentUserPresenceRecord = { ...previousUser, ...nextUser };
    for (const field of CURRENT_USER_PRESENCE_FIELDS) {
        if (previousUser[field] !== undefined) {
            merged[field] = previousUser[field];
        }
    }
    return merged;
}

export function buildCurrentUserPresenceView<
    TUser extends CurrentUserPresenceRecord | null | undefined
>(
    currentUser: TUser,
    {
        currentUserSnapshot = null,
        gameState = null
    }: CurrentUserPresenceOptions = {}
) {
    if (!currentUser) {
        return currentUser;
    }

    const normalizedCurrentUserSnapshot =
        normalizeCurrentUserSnapshotPresence(currentUserSnapshot);
    const mergedUser = mergeCurrentUserSnapshotPresenceFields(
        currentUser,
        normalizedCurrentUserSnapshot
    );

    const gameStatePatch = buildCurrentUserGameStatePresencePatch(
        gameState,
        mergedUser
    );
    if (gameStatePatch) {
        return { ...mergedUser, ...gameStatePatch };
    }

    if (currentUserSnapshot || hasVisibleCurrentUserPresence(mergedUser)) {
        return mergedUser;
    }

    const apiPresencePatch = buildCurrentUserApiPresencePatch(mergedUser);
    return apiPresencePatch
        ? { ...mergedUser, ...apiPresencePatch }
        : mergedUser;
}
