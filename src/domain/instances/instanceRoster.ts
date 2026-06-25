import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';

type InstanceRosterRecord = Record<string, unknown>;
type InstanceRosterSource = InstanceRosterRecord | string | null | undefined;
type InstanceRosterMap = Map<string, InstanceRosterRow>;

interface ResolvePresenceLocationOptions {
    preferTraveling?: boolean;
    requireInstance?: boolean;
    lastLocation?: {
        friendList?:
            | Set<string>
            | Map<string, unknown>
            | string[]
            | Record<string, unknown>;
        location?: unknown;
    } | null;
}

interface BuildInstanceRosterRowsInput {
    includeProfileFallback?: boolean;
    instanceCreatorLabel?: string;
    ownerFallbackId?: unknown;
    ownerGroup?: InstanceRosterSource;
    ownerUser?: InstanceRosterSource;
    parsedLocation?: InstanceRosterRecord | null;
    profile?: InstanceRosterSource;
    users?: unknown[];
}

export interface InstanceRosterRow extends InstanceRosterRecord {
    id: string;
    userId: string;
    displayName: string;
    userIcon: string;
    profilePicOverrideThumbnail: string;
    profilePicOverride: string;
    thumbnailUrl: string;
    currentAvatarThumbnailImageUrl: string;
    currentAvatarImageUrl: string;
    $subtitle: string;
    $location_at: unknown;
    joinedAt: unknown;
}

export interface InstanceRosterRows {
    ownerId: string;
    ownerIsGroup: boolean;
    rows: InstanceRosterRow[];
}

function isRecord(value: unknown): value is InstanceRosterRecord {
    return Boolean(value && typeof value === 'object');
}

function field(source: unknown, key: string): unknown {
    return isRecord(source) ? source[key] : undefined;
}

function nestedUser(source: unknown): InstanceRosterRecord {
    const value = field(source, 'user');
    return isRecord(value) ? value : {};
}

function sourceHasUserIdentity(source: InstanceRosterRecord): boolean {
    const nested = nestedUser(source);
    return Boolean(
        field(source, 'id') ||
        field(source, 'userId') ||
        field(source, 'user_id') ||
        field(source, 'targetUserId') ||
        field(source, 'target_user_id') ||
        field(source, 'displayName') ||
        field(source, 'display_name') ||
        field(source, 'username') ||
        field(source, 'name') ||
        field(nested, 'id') ||
        field(nested, 'userId') ||
        field(nested, 'displayName') ||
        field(nested, 'username')
    );
}

export function firstText(...values: unknown[]): string {
    for (const value of values) {
        const text =
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim();
        if (text) {
            return text;
        }
    }
    return '';
}

export function isGroupId(value: unknown): boolean {
    return firstText(value).startsWith('grp_');
}

function isPresentValue(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
}

export function userIdForRosterRow(user: unknown): string {
    return firstText(
        field(user, 'id'),
        field(user, 'userId'),
        field(user, 'user_id'),
        field(user, 'targetUserId'),
        field(user, 'target_user_id')
    );
}

export function userDisplayName(user: unknown): string {
    if (typeof user === 'string') {
        return firstText(user);
    }
    const userObject = nestedUser(user);
    return firstText(
        field(user, 'displayName'),
        field(user, 'display_name'),
        field(user, 'username'),
        field(user, 'name'),
        field(userObject, 'displayName'),
        field(userObject, 'display_name'),
        field(userObject, 'username'),
        field(userObject, 'name'),
        field(user, 'userId'),
        field(user, 'user_id'),
        field(user, 'id'),
        field(userObject, 'id'),
        field(userObject, 'userId'),
        field(userObject, 'user_id')
    );
}

export function createInstanceUserRow(
    user: InstanceRosterSource,
    fallback: InstanceRosterRecord = {}
): InstanceRosterRow {
    const fallbackUserId = firstText(
        field(fallback, 'id'),
        field(fallback, 'userId'),
        field(fallback, 'user_id')
    );
    const sourceRecord: InstanceRosterRecord =
        typeof user === 'string'
            ? {
                  id: fallbackUserId || user,
                  userId: fallbackUserId || user,
                  displayName: user
              }
            : isRecord(user)
              ? user
              : {};
    const userObject = nestedUser(sourceRecord);
    const userId = firstText(
        field(sourceRecord, 'id'),
        field(sourceRecord, 'userId'),
        field(sourceRecord, 'user_id'),
        field(sourceRecord, 'targetUserId'),
        field(sourceRecord, 'target_user_id'),
        field(userObject, 'id'),
        field(userObject, 'userId'),
        field(userObject, 'user_id'),
        field(fallback, 'id'),
        field(fallback, 'userId'),
        field(fallback, 'user_id')
    );
    const displayName =
        userDisplayName(sourceRecord) ||
        firstText(
            field(fallback, 'displayName'),
            field(fallback, 'display_name')
        ) ||
        userId;

    return {
        ...userObject,
        ...sourceRecord,
        id: userId || firstText(field(sourceRecord, 'id')),
        userId: firstText(field(sourceRecord, 'userId'), userId),
        displayName,
        userIcon: firstText(
            field(sourceRecord, 'userIcon'),
            field(userObject, 'userIcon'),
            field(fallback, 'userIcon')
        ),
        profilePicOverrideThumbnail: firstText(
            field(sourceRecord, 'profilePicOverrideThumbnail'),
            field(userObject, 'profilePicOverrideThumbnail'),
            field(fallback, 'profilePicOverrideThumbnail')
        ),
        profilePicOverride: firstText(
            field(sourceRecord, 'profilePicOverride'),
            field(userObject, 'profilePicOverride'),
            field(fallback, 'profilePicOverride')
        ),
        thumbnailUrl: firstText(
            field(sourceRecord, 'thumbnailUrl'),
            field(userObject, 'thumbnailUrl'),
            field(fallback, 'thumbnailUrl')
        ),
        currentAvatarThumbnailImageUrl: firstText(
            field(sourceRecord, 'currentAvatarThumbnailImageUrl'),
            field(userObject, 'currentAvatarThumbnailImageUrl'),
            field(fallback, 'currentAvatarThumbnailImageUrl')
        ),
        currentAvatarImageUrl: firstText(
            field(sourceRecord, 'currentAvatarImageUrl'),
            field(userObject, 'currentAvatarImageUrl'),
            field(fallback, 'currentAvatarImageUrl')
        ),
        $subtitle: firstText(
            field(fallback, 'subtitle'),
            field(sourceRecord, '$subtitle'),
            field(sourceRecord, 'subtitle')
        ),
        $location_at:
            field(sourceRecord, '$location_at') ||
            field(sourceRecord, 'locationAt') ||
            field(sourceRecord, 'location_at') ||
            field(fallback, 'joinedAt') ||
            field(fallback, 'joined_at') ||
            '',
        joinedAt:
            field(sourceRecord, 'joinedAt') ||
            field(sourceRecord, 'joined_at') ||
            field(fallback, 'joinedAt') ||
            field(fallback, 'joined_at') ||
            ''
    };
}

export function mergeInstanceUserRows(
    existing: InstanceRosterRow | null | undefined,
    incoming: InstanceRosterRow | null | undefined
): InstanceRosterRow | null | undefined {
    if (!existing) {
        return incoming;
    }
    if (!incoming) {
        return existing;
    }

    const merged: InstanceRosterRow = { ...incoming, ...existing };
    for (const [key, value] of Object.entries(incoming)) {
        if (!isPresentValue(merged[key]) && isPresentValue(value)) {
            merged[key] = value;
        }
    }
    return merged;
}

function rosterUserKey(user: unknown): string {
    const id = userIdForRosterRow(user);
    if (id) {
        return id;
    }
    const displayName = userDisplayName(user);
    return displayName ? `display:${displayName.toLowerCase()}` : '';
}

export function mergeInstanceUser(
    rowsByKey: InstanceRosterMap,
    user: InstanceRosterSource,
    fallback: InstanceRosterRecord = {}
): void {
    const row = createInstanceUserRow(user, fallback);
    const key = rosterUserKey(row);
    if (!key) {
        return;
    }
    const existing = rowsByKey.get(key);
    rowsByKey.set(key, existing ? mergeInstanceUserRows(existing, row)! : row);
}

export function pushInstanceUserSource(
    source: unknown,
    push: (user: InstanceRosterSource, fallback?: InstanceRosterRecord) => void,
    fallback: InstanceRosterRecord = {}
): void {
    const pushWithFallback = (
        value: InstanceRosterSource,
        fallbackRow: InstanceRosterRecord = {}
    ) => {
        push(value, fallbackRow);
    };
    if (!source) {
        return;
    }
    if (source instanceof Map) {
        for (const [key, value] of source.entries()) {
            pushInstanceUserSource(value, push, { id: key, userId: key });
        }
        return;
    }
    if (Array.isArray(source)) {
        for (const value of source) {
            pushInstanceUserSource(value, push);
        }
        return;
    }
    if (isRecord(source)) {
        if (sourceHasUserIdentity(source)) {
            pushWithFallback(source, fallback);
            return;
        }
        for (const [key, value] of Object.entries(source)) {
            pushInstanceUserSource(value, push, { id: key, userId: key });
        }
        return;
    }
    pushWithFallback(typeof source === 'string' ? source : null, fallback);
}

export function normalizeInstanceUsers(
    ...sources: unknown[]
): InstanceRosterRow[] {
    const rows: InstanceRosterRow[] = [];
    for (const source of sources) {
        pushInstanceUserSource(source, (user, fallback = {}) => {
            const row = createInstanceUserRow(user, fallback);
            if (rosterUserKey(row)) {
                rows.push(row);
            }
        });
    }
    return rows;
}

export function mergeInstanceUsers(...sources: unknown[]): InstanceRosterRow[] {
    const rowsByKey: InstanceRosterMap = new Map();
    for (const user of normalizeInstanceUsers(...sources)) {
        mergeInstanceUser(rowsByKey, user);
    }
    return Array.from(rowsByKey.values());
}

export function isSameInstanceLocation(left: unknown, right: unknown): boolean {
    const leftTag = firstText(left);
    const rightTag = firstText(right);
    if (!leftTag || !rightTag) {
        return false;
    }
    if (leftTag === rightTag) {
        return true;
    }
    const leftLocation = parseLocation(leftTag);
    const rightLocation = parseLocation(rightTag);
    return Boolean(
        leftLocation.worldId &&
        rightLocation.worldId &&
        leftLocation.instanceId &&
        rightLocation.instanceId &&
        leftLocation.worldId === rightLocation.worldId &&
        leftLocation.instanceId === rightLocation.instanceId
    );
}

export function resolvePresenceLocation(
    profile: unknown,
    options: ResolvePresenceLocationOptions = {}
): string {
    return resolveFriendPresenceLocation(profile, options);
}

export function userHasExplicitSameInstance(
    user: unknown,
    location: unknown
): boolean {
    const explicitLocation = resolvePresenceLocation(user, {
        requireInstance: true
    });
    return isSameInstanceLocation(explicitLocation, location);
}

export function buildInstanceRosterRows({
    includeProfileFallback = false,
    instanceCreatorLabel = 'Instance creator',
    ownerFallbackId = '',
    ownerGroup = null,
    ownerUser = null,
    parsedLocation = null,
    profile = null,
    users = []
}: BuildInstanceRosterRowsInput = {}): InstanceRosterRows {
    const rowsByKey: InstanceRosterMap = new Map();
    for (const user of users) {
        mergeInstanceUser(
            rowsByKey,
            isRecord(user) || typeof user === 'string' ? user : null
        );
    }

    if (
        includeProfileFallback &&
        !rowsByKey.size &&
        Boolean(field(parsedLocation, 'isRealInstance'))
    ) {
        mergeInstanceUser(rowsByKey, profile);
    }

    const ownerUserId = userIdForRosterRow(ownerUser);
    const ownerGroupId = firstText(
        field(ownerGroup, 'id'),
        field(ownerGroup, 'groupId'),
        isGroupId(ownerFallbackId) ? ownerFallbackId : '',
        isGroupId(field(parsedLocation, 'groupId'))
            ? field(parsedLocation, 'groupId')
            : ''
    );
    const ownerId = firstText(
        ownerGroupId,
        ownerUserId,
        ownerFallbackId,
        field(parsedLocation, 'userId'),
        field(parsedLocation, 'groupId')
    );
    const ownerIsGroup = Boolean(
        ownerGroupId || isGroupId(ownerUserId) || isGroupId(ownerId)
    );
    const ownerName = ownerIsGroup
        ? firstText(
              field(ownerGroup, 'name'),
              field(ownerGroup, 'displayName'),
              field(ownerGroup, 'display_name'),
              field(ownerGroup, 'shortCode'),
              ownerId
          )
        : firstText(
              field(ownerUser, 'displayName'),
              field(ownerUser, 'username'),
              field(ownerUser, 'name'),
              ownerId
          );
    const ownerRow =
        !ownerIsGroup && ownerUser
            ? createInstanceUserRow(ownerUser, {
                  subtitle: instanceCreatorLabel
              })
            : !ownerIsGroup && ownerId
              ? createInstanceUserRow(
                    {
                        id: ownerId,
                        userId: ownerId,
                        displayName: ownerName
                    },
                    { subtitle: instanceCreatorLabel }
                )
              : null;
    const ownerRowId = userIdForRosterRow(ownerRow);
    if (ownerRow) {
        mergeInstanceUser(rowsByKey, ownerRow);
    }
    const mergedOwnerRow = ownerRowId ? rowsByKey.get(ownerRowId) : null;
    const playerRows = Array.from(rowsByKey.values()).filter(
        (user) => !ownerRowId || userIdForRosterRow(user) !== ownerRowId
    );

    return {
        ownerId,
        ownerIsGroup,
        rows: mergedOwnerRow ? [mergedOwnerRow, ...playerRows] : playerRows
    };
}
