import { isRealInstance } from './instance';
import {
    normalizeLocationValue,
    parseLocation,
    resolveFriendPresenceLocation
} from './location';
import { normalizeString } from './string';

export type CurrentUserPresenceRecord = Record<string, unknown>;

export interface CurrentUserPresenceGameState {
    isGameRunning?: boolean;
    currentLocation?: unknown;
    currentDestination?: unknown;
    currentWorldId?: unknown;
}

export interface CurrentUserPresenceOptions {
    currentUserSnapshot?: CurrentUserPresenceRecord | null;
    gameState?: CurrentUserPresenceGameState | null;
    gameLogDisabled?: boolean;
}

export interface CurrentUserPresencePatch extends CurrentUserPresenceRecord {
    location: string;
    worldId: unknown;
    instanceId: unknown;
    travelingToLocation: string;
    travelingToWorld: string;
    travelingToInstance: string;
    state: unknown;
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
    'stateBucket'
];

function normalizeLocationStatus(value: unknown): string {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized === 'offline:offline') {
        return 'offline';
    }
    if (normalized === 'private:private') {
        return 'private';
    }
    if (normalized === 'traveling:traveling') {
        return 'traveling';
    }
    return normalized;
}

export function isVisibleCurrentUserLocation(value: unknown): boolean {
    const location = normalizeLocationStatus(value);
    return Boolean(location && !HIDDEN_LOCATION_STATUSES.has(location));
}

export function hasVisibleCurrentUserPresence(
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

function preferVisibleLocation(primary: unknown, fallback: unknown): unknown {
    if (isVisibleCurrentUserLocation(primary)) {
        return primary;
    }
    if (isVisibleCurrentUserLocation(fallback)) {
        return fallback;
    }
    return normalizeString(primary) || normalizeString(fallback);
}

function buildPresencePatch({
    location,
    travelingToLocation = '',
    worldId = '',
    instanceId = '',
    state = '',
    source = null
}: {
    location: unknown;
    travelingToLocation?: unknown;
    worldId?: unknown;
    instanceId?: unknown;
    state?: unknown;
    source?: CurrentUserPresenceRecord | null;
}): CurrentUserPresencePatch | null {
    const normalizedLocation = normalizeLocationValue(location);
    const normalizedTraveling = normalizeLocationValue(travelingToLocation);
    const targetLocation =
        normalizeLocationStatus(normalizedLocation) === 'traveling'
            ? normalizedTraveling
            : normalizedLocation;
    if (!isVisibleCurrentUserLocation(targetLocation)) {
        return null;
    }

    const displayTraveling =
        normalizeLocationStatus(normalizedLocation) === 'traveling'
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
            source?.worldId ||
            '',
        instanceId:
            parsedLocation.instanceId ||
            normalizeString(instanceId) ||
            source?.instanceId ||
            '',
        travelingToLocation: displayTraveling,
        travelingToWorld: parsedTraveling.worldId || '',
        travelingToInstance: parsedTraveling.instanceId || '',
        $location: parsedLocation,
        $travelingToLocation: parsedTraveling,
        state: source?.state || state || 'online',
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

export function buildCurrentUserApiPresencePatch(
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
        worldId: presence.world,
        instanceId: presence.instance,
        state: presence.state,
        source: currentUser
    });
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
        gameState = null,
        gameLogDisabled = false
    }: CurrentUserPresenceOptions = {}
) {
    if (!currentUser) {
        return currentUser;
    }

    if (!gameLogDisabled) {
        const gameStatePatch = buildCurrentUserGameStatePresencePatch(
            gameState,
            currentUser
        );
        if (gameStatePatch) {
            return { ...currentUser, ...gameStatePatch };
        }
    }

    if (hasVisibleCurrentUserPresence(currentUser)) {
        return currentUser;
    }

    const mergedUser = mergeCurrentUserPresenceFields(
        currentUser,
        currentUserSnapshot
    );
    if (hasVisibleCurrentUserPresence(mergedUser)) {
        return mergedUser;
    }

    const apiPresencePatch =
        buildCurrentUserApiPresencePatch(mergedUser) ||
        buildCurrentUserApiPresencePatch(currentUserSnapshot);
    return apiPresencePatch
        ? { ...mergedUser, ...apiPresencePatch }
        : mergedUser;
}
