import { parseLocation } from './location';

type ParsedInviteLocation = ReturnType<typeof parseLocation>;

export type InviteInstanceCache = Map<
    string,
    {
        closedAt?: unknown;
    }
>;

export interface CheckCanInviteDeps {
    currentUserId: string;
    lastLocationStr: string;
    cachedInstances?: InviteInstanceCache | null;
}

export interface CheckCanInviteSelfDeps {
    currentUserId: string;
    cachedInstances?: InviteInstanceCache | null;
    friends?: Map<string, unknown> | Set<string> | null;
}

export interface InviteLocationGameState {
    currentLocation?: unknown;
    currentDestination?: unknown;
    isGameRunning?: unknown;
}

export interface InviteLocationCurrentUserSnapshot {
    $locationTag?: unknown;
    location?: unknown;
}

function normalizeInviteLocationValue(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function locationCacheKey(parsed: ParsedInviteLocation): string {
    if (!parsed.worldId || !parsed.instanceId) {
        return '';
    }
    return `${parsed.worldId}:${parsed.instanceId}`;
}

function resolveCurrentInviteLocation(
    gameState: InviteLocationGameState | null | undefined,
    currentUserSnapshot: InviteLocationCurrentUserSnapshot | null | undefined
): string {
    const currentLocation = normalizeInviteLocationValue(
        gameState?.currentLocation
    );
    if (currentLocation === 'traveling') {
        return normalizeInviteLocationValue(gameState?.currentDestination);
    }
    return (
        currentLocation ||
        normalizeInviteLocationValue(gameState?.currentDestination) ||
        normalizeInviteLocationValue(
            currentUserSnapshot?.$locationTag || currentUserSnapshot?.location
        )
    );
}

function getCachedInstance(
    location: string,
    parsed: ParsedInviteLocation,
    cachedInstances?: InviteInstanceCache | null
) {
    if (!cachedInstances) {
        return null;
    }
    return (
        cachedInstances.get(location) ||
        cachedInstances.get(locationCacheKey(parsed)) ||
        null
    );
}

function checkCanInvite(location: string, deps: CheckCanInviteDeps): boolean {
    if (!location) {
        return false;
    }
    const L = parseLocation(location);
    if (!L.isRealInstance || !L.worldId || !L.instanceId) {
        return false;
    }
    const instance = getCachedInstance(location, L, deps.cachedInstances);
    if (instance?.closedAt) {
        return false;
    }
    if (
        L.accessType === 'public' ||
        L.accessType === 'group' ||
        L.userId === deps.currentUserId
    ) {
        return true;
    }
    if (L.accessType === 'invite' || L.accessType === 'friends') {
        return false;
    }
    if (deps.lastLocationStr === location) {
        return true;
    }
    return false;
}

function checkCanInviteSelf(
    location: string,
    deps: CheckCanInviteSelfDeps
): boolean {
    if (!location) {
        return false;
    }
    const L = parseLocation(location);
    if (!L.isRealInstance || !L.worldId || !L.instanceId) {
        return false;
    }
    const instance = getCachedInstance(location, L, deps.cachedInstances);
    if (instance?.closedAt) {
        return false;
    }
    if (L.userId === deps.currentUserId) {
        return true;
    }
    if (L.accessType === 'invite' || L.accessType === 'invite+') {
        return false;
    }
    if (
        L.accessType === 'friends' &&
        (L.userId == null || !deps.friends?.has(L.userId))
    ) {
        return false;
    }
    return true;
}

export { checkCanInvite, checkCanInviteSelf, resolveCurrentInviteLocation };
