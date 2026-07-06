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

export type LocalInstanceActionGateTarget = {
    key: string;
    userId: string;
    location: string;
    stateBucket?: string;
    isCurrentUser?: boolean;
};

export type LocalInstanceActionGates = {
    key: string;
    canJoin: boolean;
    canOpenInGame: boolean;
    canSelfInvite: boolean;
    canRequestInvite: boolean;
    canInvite: boolean;
};

export type LocalInstanceActionGatesBatchInput = {
    currentUserId?: string | null;
    currentInviteLocation?: string;
    isGameRunning?: unknown;
    friendUserIds?: string[];
    closedLocations?: string[];
    targets: LocalInstanceActionGateTarget[];
};

export type LocalInstanceActionGatesBatchOutput = {
    targets: LocalInstanceActionGates[];
};

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

function closedLocationCache(
    locations: readonly string[] = []
): InviteInstanceCache {
    const cache: InviteInstanceCache = new Map();
    for (const location of locations) {
        const trimmed = normalizeInviteLocationValue(location);
        if (!trimmed) {
            continue;
        }
        const parsed = parseLocation(trimmed);
        cache.set(trimmed, { closedAt: true });
        const key = locationCacheKey(parsed);
        if (key) {
            cache.set(key, { closedAt: true });
        }
    }
    return cache;
}

function sameNonEmpty(a: unknown, b: unknown) {
    const left = normalizeInviteLocationValue(a);
    const right = normalizeInviteLocationValue(b);
    return Boolean(left && right && left === right);
}

function canOpenConcreteInstance(
    location: string,
    cachedInstances?: InviteInstanceCache | null
) {
    if (!location) {
        return false;
    }
    const parsed = parseLocation(location);
    if (!parsed.isRealInstance || !parsed.worldId || !parsed.instanceId) {
        return false;
    }
    return !getCachedInstance(location, parsed, cachedInstances)?.closedAt;
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

function evaluateLocalInstanceActionGates({
    currentUserId,
    currentInviteLocation = '',
    isGameRunning = false,
    friendUserIds = [],
    closedLocations = [],
    targets
}: LocalInstanceActionGatesBatchInput): LocalInstanceActionGatesBatchOutput {
    const normalizedCurrentUserId = normalizeInviteLocationValue(currentUserId);
    const normalizedCurrentLocation = normalizeInviteLocationValue(
        currentInviteLocation
    );
    const cachedInstances = closedLocationCache(closedLocations);
    const friends = new Set(
        friendUserIds.map(normalizeInviteLocationValue).filter(Boolean)
    );
    const canInviteFromCurrentLocation = checkCanInvite(
        normalizedCurrentLocation,
        {
            currentUserId: normalizedCurrentUserId,
            lastLocationStr: normalizedCurrentLocation,
            cachedInstances
        }
    );
    return {
        targets: targets.map((target) => {
            const location = normalizeInviteLocationValue(target.location);
            const isCurrentUser = Boolean(
                target.isCurrentUser ||
                sameNonEmpty(target.userId, normalizedCurrentUserId)
            );
            const canSelfInvite = checkCanInviteSelf(location, {
                currentUserId: normalizedCurrentUserId,
                cachedInstances,
                friends
            });
            return {
                key: normalizeInviteLocationValue(target.key),
                canJoin: canSelfInvite,
                canOpenInGame: Boolean(
                    isGameRunning &&
                    canOpenConcreteInstance(location, cachedInstances)
                ),
                canSelfInvite,
                canRequestInvite:
                    normalizeInviteLocationValue(
                        target.stateBucket
                    ).toLowerCase() === 'online' && !isCurrentUser,
                canInvite: Boolean(
                    isGameRunning &&
                    !isCurrentUser &&
                    canInviteFromCurrentLocation
                )
            };
        })
    };
}

function buildLocalInstanceActionGateMap(
    rows: readonly LocalInstanceActionGates[]
): Map<string, LocalInstanceActionGates> {
    const gates = new Map<string, LocalInstanceActionGates>();
    for (const row of rows) {
        if (!row.key) {
            continue;
        }
        const existing = gates.get(row.key);
        gates.set(
            row.key,
            existing
                ? {
                      key: row.key,
                      canJoin: existing.canJoin || row.canJoin,
                      canOpenInGame:
                          existing.canOpenInGame || row.canOpenInGame,
                      canSelfInvite:
                          existing.canSelfInvite || row.canSelfInvite,
                      canRequestInvite:
                          existing.canRequestInvite || row.canRequestInvite,
                      canInvite: existing.canInvite || row.canInvite
                  }
                : row
        );
    }
    return gates;
}

export {
    buildLocalInstanceActionGateMap,
    checkCanInvite,
    checkCanInviteSelf,
    evaluateLocalInstanceActionGates,
    resolveCurrentInviteLocation
};
