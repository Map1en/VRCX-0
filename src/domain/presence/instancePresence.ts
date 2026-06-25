import {
    normalizeLocationValue,
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';

type InstancePresenceSource =
    | 'seed'
    | 'instance'
    | 'playerSnapshot'
    | 'friend'
    | 'realtime'
    | 'gameRuntime';

interface InstancePresenceFactInput {
    endpoint?: unknown;
    location?: unknown;
    source?: InstancePresenceSource;
    ownerUserId?: unknown;
    ownerGroupId?: unknown;
    worldName?: unknown;
    groupName?: unknown;
    instanceName?: unknown;
    players?: unknown[];
    receivedAt?: unknown;
}

interface InstancePlayerFact {
    id: string;
    userId: string;
    displayName: string;
    joinedAt?: unknown;
    locationAt?: unknown;
}

interface InstancePresenceFact {
    endpoint: string;
    location: string;
    locationKey: string;
    worldId: string;
    instanceId: string;
    ownerUserId: string;
    ownerGroupId: string;
    worldName: string;
    groupName: string;
    instanceName: string;
    source: InstancePresenceSource;
    receivedAt: string;
    userIds: string[];
    playersById: Record<string, InstancePlayerFact>;
}

interface InstanceRosterModelInput {
    location?: unknown;
    currentUser?: unknown;
    friends?: unknown[];
    instanceUsers?: unknown[];
    playerSnapshot?: { players?: unknown[] } | null;
    ownerUser?: unknown;
    ownerGroup?: unknown;
    instanceCreatorLabel?: string;
}

interface RosterUserRow {
    id: string;
    userId: string;
    displayName: string;
    status?: string;
    location?: string;
    joinedAt?: unknown;
    $location_at?: unknown;
    $subtitle?: string;
    isFriend?: boolean;
    [key: string]: unknown;
}

function text(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function endpointText(value: unknown): string {
    return text(value) || 'default';
}

function firstText(...values: unknown[]): string {
    for (const value of values) {
        const valueText = text(value);
        if (valueText) {
            return valueText;
        }
    }
    return '';
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
}

function userId(value: unknown): string {
    const source = record(value);
    const nested = record(source.user);
    return firstText(
        source.id,
        source.userId,
        source.user_id,
        source.targetUserId,
        source.target_user_id,
        nested.id,
        nested.userId,
        nested.user_id
    );
}

function displayName(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim();
    }
    const source = record(value);
    const nested = record(source.user);
    return firstText(
        source.displayName,
        source.display_name,
        source.username,
        source.name,
        nested.displayName,
        nested.display_name,
        nested.username,
        nested.name,
        source.userId,
        source.user_id,
        source.id,
        nested.id
    );
}

function instanceLocationKey(location: unknown): string {
    const parsed = parseLocation(normalizeLocationValue(location));
    if (!parsed.isRealInstance || !parsed.worldId || !parsed.instanceId) {
        return '';
    }
    return `${parsed.worldId}:${parsed.instanceId}`;
}

function instancePresenceKey(endpoint: unknown, location: unknown): string {
    const key = instanceLocationKey(location);
    return key ? `${endpointText(endpoint)}::${key}` : '';
}

function createRosterRow(
    user: unknown,
    fallback: Record<string, unknown> = {}
): RosterUserRow {
    const source = record(user);
    const nested = record(source.user);
    const id = firstText(userId(source), fallback.id, fallback.userId);
    const name = firstText(
        displayName(source),
        fallback.displayName,
        fallback.display_name,
        id
    );
    const joinedAt = firstText(
        source.joinedAt,
        source.joined_at,
        source.locationAt,
        source.location_at,
        source.$location_at,
        fallback.joinedAt,
        fallback.joined_at
    );

    return {
        ...nested,
        ...source,
        id,
        userId: firstText(source.userId, id),
        displayName: name,
        ...(joinedAt
            ? {
                  joinedAt,
                  $location_at: joinedAt
              }
            : {}),
        ...(fallback.subtitle
            ? { $subtitle: firstText(fallback.subtitle) }
            : {}),
        ...(fallback.isFriend ? { isFriend: true } : {})
    };
}

function rowKey(user: RosterUserRow): string {
    return user.id || (user.displayName ? `display:${user.displayName}` : '');
}

function valuePresent(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
}

function mergeRosterRow(
    existing: RosterUserRow | undefined,
    incoming: RosterUserRow
) {
    if (!existing) {
        return incoming;
    }
    const merged: any = { ...incoming, ...existing };
    for (const [key, value] of Object.entries(incoming)) {
        if (!valuePresent(merged[key]) && valuePresent(value)) {
            merged[key] = value;
        }
    }
    return merged;
}

function addRosterRow(
    rowsByKey: Map<string, RosterUserRow>,
    user: unknown,
    fallback: Record<string, unknown> = {}
) {
    const row = createRosterRow(user, fallback);
    const key = rowKey(row);
    if (!key) {
        return;
    }
    rowsByKey.set(key, mergeRosterRow(rowsByKey.get(key), row));
}

function sameInstance(user: unknown, location: unknown): boolean {
    const explicit = resolveFriendPresenceLocation(user, {
        requireInstance: true
    });
    return instanceLocationKey(explicit) === instanceLocationKey(location);
}

function isGroupId(value: unknown): boolean {
    return text(value).startsWith('grp_');
}

function buildInstancePresenceFact({
    endpoint = '',
    location = '',
    source = 'seed',
    ownerUserId = '',
    ownerGroupId = '',
    worldName = '',
    groupName = '',
    instanceName = '',
    players = [],
    receivedAt = new Date().toISOString()
}: InstancePresenceFactInput = {}): InstancePresenceFact | null {
    const normalizedLocation = normalizeLocationValue(location);
    const parsed = parseLocation(normalizedLocation);
    const locationKey = instanceLocationKey(normalizedLocation);
    if (!locationKey) {
        return null;
    }
    const playersById: Record<string, InstancePlayerFact> = {};
    const userIds: string[] = [];
    for (const player of Array.isArray(players) ? players : []) {
        const id = firstText(
            userId(player),
            record(player).userId,
            record(player).user_id
        );
        if (!id || playersById[id]) {
            continue;
        }
        const row = createRosterRow(player);
        playersById[id] = {
            id,
            userId: id,
            displayName: row.displayName,
            joinedAt: row.joinedAt,
            locationAt: row.$location_at
        };
        userIds.push(id);
    }

    return {
        endpoint: endpointText(endpoint),
        location: normalizedLocation,
        locationKey,
        worldId: parsed.worldId,
        instanceId: parsed.instanceId,
        ownerUserId: text(ownerUserId || parsed.userId),
        ownerGroupId: text(ownerGroupId || parsed.groupId),
        worldName: text(worldName),
        groupName: text(groupName),
        instanceName: text(instanceName || parsed.instanceName),
        source,
        receivedAt: text(receivedAt) || new Date().toISOString(),
        userIds,
        playersById
    };
}

function buildInstanceRosterModel({
    location = '',
    currentUser = null,
    friends = [],
    instanceUsers = [],
    playerSnapshot = null,
    ownerUser = null,
    ownerGroup = null,
    instanceCreatorLabel = 'Instance creator'
}: InstanceRosterModelInput = {}) {
    const parsed = parseLocation(normalizeLocationValue(location));
    const rowsByKey = new Map<string, RosterUserRow>();

    if (!parsed.isRealInstance || !parsed.worldId || !parsed.instanceName) {
        return {
            ownerId: '',
            ownerIsGroup: false,
            rows: [],
            friendCount: 0,
            playerCount: 0
        };
    }

    if (currentUser && sameInstance(currentUser, location)) {
        addRosterRow(rowsByKey, currentUser);
    }
    for (const friend of Array.isArray(friends) ? friends : []) {
        if (sameInstance(friend, location)) {
            addRosterRow(rowsByKey, friend, { isFriend: true });
        }
    }
    for (const user of Array.isArray(instanceUsers) ? instanceUsers : []) {
        addRosterRow(rowsByKey, user);
    }
    for (const player of Array.isArray(playerSnapshot?.players)
        ? playerSnapshot.players
        : []) {
        addRosterRow(rowsByKey, player);
    }

    const ownerGroupId = firstText(
        record(ownerGroup).id,
        record(ownerGroup).groupId,
        isGroupId(parsed.groupId) ? parsed.groupId : ''
    );
    const ownerUserId = firstText(userId(ownerUser), parsed.userId);
    const ownerId = firstText(ownerGroupId, ownerUserId);
    const ownerIsGroup = Boolean(ownerGroupId || isGroupId(ownerId));
    const ownerRow =
        !ownerIsGroup && (ownerUser || ownerUserId)
            ? createRosterRow(
                  ownerUser || {
                      id: ownerUserId,
                      displayName: ownerUserId
                  },
                  { subtitle: instanceCreatorLabel }
              )
            : null;
    const ownerRowId = ownerRow?.id || '';
    if (ownerRow) {
        addRosterRow(rowsByKey, ownerRow);
    }
    const mergedOwnerRow = ownerRowId ? rowsByKey.get(ownerRowId) : null;
    const playerRows = Array.from(rowsByKey.values()).filter(
        (row: any) => !ownerRowId || row.id !== ownerRowId
    );
    const rows = mergedOwnerRow ? [mergedOwnerRow, ...playerRows] : playerRows;

    return {
        ownerId,
        ownerIsGroup,
        rows,
        friendCount: rows.filter((row: any) => row.isFriend).length,
        playerCount: rows.length
    };
}

export {
    buildInstancePresenceFact,
    buildInstanceRosterModel,
    instanceLocationKey,
    instancePresenceKey
};
export type {
    InstancePlayerFact,
    InstancePresenceFact,
    InstancePresenceFactInput,
    InstancePresenceSource,
    InstanceRosterModelInput,
    RosterUserRow
};
