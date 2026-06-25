import type { ParsedLocation as BackendParsedLocation } from '@/platform/tauri/bindings';

import { isRealInstance } from './instance';

export type ParsedLocation = BackendParsedLocation & Record<string, unknown>;

interface LocationRecord extends Record<string, unknown> {
    tag?: unknown;
    location?: unknown;
    ref?: LocationRecord;
    $location?: {
        tag?: unknown;
        worldId?: unknown;
        instanceId?: unknown;
    };
    worldId?: unknown;
    world_id?: unknown;
    instanceId?: unknown;
    instance_id?: unknown;
    id?: unknown;
    isOffline?: unknown;
    isPrivate?: unknown;
    isTraveling?: unknown;
}

type ParsedStringField =
    | 'tag'
    | 'worldId'
    | 'instanceId'
    | 'instanceName'
    | 'accessType'
    | 'accessTypeName'
    | 'region'
    | 'shortName';

type ParsedNullableStringField =
    | 'userId'
    | 'hiddenId'
    | 'privateId'
    | 'friendsId'
    | 'groupId'
    | 'groupAccessType';

type ParsedBooleanField =
    | 'isOffline'
    | 'isPrivate'
    | 'isTraveling'
    | 'isRealInstance'
    | 'canRequestInvite'
    | 'strict'
    | 'ageGate';

const SENTINEL_LOCATION_VALUES = new Set([
    'offline',
    'offline:offline',
    'private',
    'private:private',
    'traveling',
    'traveling:traveling'
]);
const SHORT_NAME_QUALIFIER = '&shortName=';

const PARSED_LOCATION_STRING_FIELDS: ParsedStringField[] = [
    'tag',
    'worldId',
    'instanceId',
    'instanceName',
    'accessType',
    'accessTypeName',
    'region',
    'shortName'
];

const PARSED_LOCATION_NULLABLE_STRING_FIELDS: ParsedNullableStringField[] = [
    'userId',
    'hiddenId',
    'privateId',
    'friendsId',
    'groupId',
    'groupAccessType'
];

const PARSED_LOCATION_BOOLEAN_FIELDS: ParsedBooleanField[] = [
    'isOffline',
    'isPrivate',
    'isTraveling',
    'isRealInstance',
    'canRequestInvite',
    'strict',
    'ageGate'
];

function isLocationLike(value: unknown): value is LocationRecord {
    return Boolean(value && typeof value === 'object');
}

function isNullableString(value: unknown): boolean {
    return value === null || typeof value === 'string';
}

function isCompleteParsedLocation(value: unknown): value is LocationRecord {
    if (!isLocationLike(value)) {
        return false;
    }
    return (
        PARSED_LOCATION_STRING_FIELDS.every(
            (field) => typeof value[field] === 'string'
        ) &&
        PARSED_LOCATION_BOOLEAN_FIELDS.every(
            (field) => typeof value[field] === 'boolean'
        ) &&
        PARSED_LOCATION_NULLABLE_STRING_FIELDS.every((field) =>
            isNullableString(value[field])
        )
    );
}

function stringField(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function nullableStringField(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function parsedLocationFromObject(value: unknown): ParsedLocation | null {
    if (!isCompleteParsedLocation(value)) {
        return null;
    }
    return {
        ...value,
        tag: normalizeLaunchUrlTag(stringField(value.tag)),
        isOffline: value.isOffline === true,
        isPrivate: value.isPrivate === true,
        isTraveling: value.isTraveling === true,
        isRealInstance: value.isRealInstance === true,
        worldId: stringField(value.worldId),
        instanceId: stringField(value.instanceId),
        instanceName: stringField(value.instanceName),
        accessType: stringField(value.accessType),
        accessTypeName: stringField(value.accessTypeName),
        region: stringField(value.region),
        shortName: stringField(value.shortName),
        userId: nullableStringField(value.userId),
        hiddenId: nullableStringField(value.hiddenId),
        privateId: nullableStringField(value.privateId),
        friendsId: nullableStringField(value.friendsId),
        groupId: nullableStringField(value.groupId),
        groupAccessType: nullableStringField(value.groupAccessType),
        canRequestInvite: value.canRequestInvite === true,
        strict: value.strict === true,
        ageGate: value.ageGate === true
    };
}

function displayLocation(
    location: string,
    worldName: string,
    groupName: string = ''
): string {
    const L = parseLocation(location);
    if (L.isOffline) {
        return 'Offline';
    }
    if (L.isPrivate) {
        return 'Private';
    }
    if (L.isTraveling) {
        return 'Traveling';
    }
    if (!L.worldId) {
        return worldName;
    }
    if (groupName) {
        return `${worldName} ${L.accessTypeName}(${groupName})`;
    }
    if (!L.instanceId) {
        return worldName;
    }
    return `${worldName} ${L.accessTypeName}`;
}

function appendShortName(tag: string, shortName: string): string {
    if (!tag || !shortName || tag.includes('&shortName=')) {
        return tag;
    }
    return `${tag}&shortName=${shortName}`;
}

function normalizeLaunchUrlTag(tag: string): string {
    const trimmed = tag.trim();
    if (!/^(https?:\/\/|vrchat:\/\/)/i.test(trimmed)) {
        return tag;
    }

    try {
        const url = new URL(trimmed);
        const host = url.hostname.toLowerCase();
        const shortName = url.searchParams.get('shortName')?.trim() || '';

        if (
            (url.protocol === 'https:' || url.protocol === 'http:') &&
            (host === 'vrchat.com' || host.endsWith('.vrchat.com')) &&
            url.pathname === '/home/launch'
        ) {
            const worldId = url.searchParams.get('worldId')?.trim() || '';
            const instanceId = url.searchParams.get('instanceId')?.trim() || '';
            if (worldId && instanceId) {
                return appendShortName(`${worldId}:${instanceId}`, shortName);
            }
            return worldId || tag;
        }

        if (url.protocol === 'vrchat:' && host === 'launch') {
            const launchId = url.searchParams.get('id')?.trim() || '';
            return appendShortName(launchId, shortName) || tag;
        }
    } catch {
        return tag;
    }

    return tag;
}

function normalizeLocationTag(tag: unknown): string {
    if (typeof tag === 'string') {
        return normalizeLaunchUrlTag(tag);
    }
    if (!isLocationLike(tag)) {
        return String(tag || '');
    }

    const rawTag = normalizeLocationTag(
        tag.tag || tag.location || tag.$location?.tag
    );
    if (rawTag) {
        return rawTag;
    }
    const worldId = normalizeLocationTag(
        tag.worldId || tag.world_id || tag.$location?.worldId
    );
    const instanceId = normalizeLocationTag(
        tag.instanceId || tag.instance_id || tag.id || tag.$location?.instanceId
    );
    if (worldId && instanceId) {
        return `${worldId}:${instanceId}`;
    }
    if (tag.isOffline) {
        return 'offline';
    }
    if (tag.isPrivate) {
        return 'private';
    }
    if (tag.isTraveling) {
        return 'traveling';
    }
    return '';
}

function createParsedLocation(tag: string): ParsedLocation {
    return {
        tag,
        isOffline: false,
        isPrivate: false,
        isTraveling: false,
        isRealInstance: false,
        worldId: '',
        instanceId: '',
        instanceName: '',
        accessType: '',
        accessTypeName: '',
        region: '',
        shortName: '',
        userId: null,
        hiddenId: null,
        privateId: null,
        friendsId: null,
        groupId: null,
        groupAccessType: null,
        canRequestInvite: false,
        strict: false,
        ageGate: false
    };
}

function applyInstanceTagPart(
    ctx: ParsedLocation,
    part: string,
    index: number
): void {
    if (index === 0) {
        ctx.instanceName = part;
        return;
    }
    const openIndex = part.indexOf('(');
    const closeIndex = openIndex >= 0 ? part.lastIndexOf(')') : -1;
    const key = closeIndex >= 0 ? part.slice(0, openIndex) : part;
    const value =
        openIndex < closeIndex ? part.slice(openIndex + 1, closeIndex) : '';

    switch (key) {
        case 'hidden':
            ctx.hiddenId = value;
            break;
        case 'private':
            ctx.privateId = value;
            break;
        case 'friends':
            ctx.friendsId = value;
            break;
        case 'canRequestInvite':
            ctx.canRequestInvite = true;
            break;
        case 'region':
            ctx.region = value;
            break;
        case 'group':
            ctx.groupId = value;
            break;
        case 'groupAccessType':
            ctx.groupAccessType = value;
            break;
        case 'strict':
            ctx.strict = true;
            break;
        case 'ageGate':
            ctx.ageGate = true;
            break;
    }
}

function applyAccessType(ctx: ParsedLocation): void {
    ctx.accessType = 'public';
    if (ctx.privateId !== null) {
        if (ctx.canRequestInvite) {
            ctx.accessType = 'invite+';
        } else {
            ctx.accessType = 'invite';
        }
        ctx.userId = ctx.privateId;
    } else if (ctx.friendsId !== null) {
        ctx.accessType = 'friends';
        ctx.userId = ctx.friendsId;
    } else if (ctx.hiddenId !== null) {
        ctx.accessType = 'friends+';
        ctx.userId = ctx.hiddenId;
    } else if (ctx.groupId !== null) {
        ctx.accessType = 'group';
    }
    ctx.accessTypeName = ctx.accessType;
    if (ctx.groupAccessType === 'public') {
        ctx.accessTypeName = 'groupPublic';
    } else if (ctx.groupAccessType === 'plus') {
        ctx.accessTypeName = 'groupPlus';
    }
}

function parseLocationTag(tag: string): ParsedLocation {
    let _tag = tag;
    const ctx = createParsedLocation(_tag);
    if (_tag === 'offline' || _tag === 'offline:offline') {
        ctx.isOffline = true;
    } else if (_tag === 'private' || _tag === 'private:private') {
        ctx.isPrivate = true;
    } else if (_tag === 'traveling' || _tag === 'traveling:traveling') {
        ctx.isTraveling = true;
    } else if (_tag && !_tag.startsWith('local')) {
        ctx.isRealInstance = true;
        const sep = _tag.indexOf(':');
        const shortNameIndex = _tag.indexOf(SHORT_NAME_QUALIFIER);
        if (shortNameIndex >= 0) {
            ctx.shortName = _tag.slice(
                shortNameIndex + SHORT_NAME_QUALIFIER.length
            );
            _tag = _tag.slice(0, shortNameIndex);
        }
        if (sep >= 0) {
            ctx.worldId = _tag.slice(0, sep);
            ctx.instanceId = _tag.slice(sep + 1);
            ctx.instanceId.split('~').forEach((part, index) => {
                applyInstanceTagPart(ctx, part, index);
            });
            applyAccessType(ctx);
        } else {
            ctx.worldId = _tag;
        }
    }
    return ctx;
}

function parseLocation(tag: unknown): ParsedLocation {
    const object = isLocationLike(tag) ? tag : null;
    const parsedObject =
        parsedLocationFromObject(object?.$location) ||
        parsedLocationFromObject(tag);
    if (parsedObject) {
        return parsedObject;
    }
    return parseLocationTag(normalizeLocationTag(tag));
}

function resolveRegion(L: ParsedLocation): string {
    if (L.isOffline || L.isPrivate || L.isTraveling) {
        return '';
    }
    if (L.region) {
        return L.region;
    }
    if (L.instanceId) {
        return 'us';
    }
    return '';
}

function translateAccessType(
    accessTypeName: string,
    t: (key: string) => string,
    keyMap: Record<string, string>
): string {
    const key = keyMap[accessTypeName];
    if (!key) {
        return accessTypeName;
    }
    if (accessTypeName === 'groupPublic' || accessTypeName === 'groupPlus') {
        const groupKey = keyMap['group'];
        const groupLabel = t(groupKey);
        const subtypeLabel = t(key);
        return subtypeLabel.startsWith(groupLabel)
            ? subtypeLabel
            : `${groupLabel} ${subtypeLabel}`;
    }
    return t(key);
}

export { parseLocation, displayLocation, resolveRegion, translateAccessType };

interface LastLocation {
    friendList?:
        | Set<string>
        | Map<string, unknown>
        | string[]
        | Record<string, unknown>;
    location?: unknown;
}

interface ResolveFriendPresenceOptions {
    preferTraveling?: boolean;
    requireInstance?: boolean;
    lastLocation?: LastLocation | null;
}

interface LocationTextOptions {
    hint?: string;
    worldName?: string;
    accessTypeLabel: string;
    t: (key: string) => string;
}

function normalizeLocationValue(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (!value || typeof value !== 'object') {
        return String(value ?? '').trim();
    }
    const location = value as LocationRecord;

    const tag = normalizeLocationValue(
        location.tag || location.location || location.$location?.tag
    );
    if (tag) {
        return tag;
    }
    const worldId = normalizeLocationValue(
        location.worldId || location.world_id || location.$location?.worldId
    );
    const instanceId = normalizeLocationValue(
        location.instanceId ||
            location.instance_id ||
            location.id ||
            location.$location?.instanceId
    );
    if (worldId && instanceId) {
        return `${worldId}:${instanceId}`;
    }
    if (location.isOffline) {
        return 'offline';
    }
    if (location.isPrivate) {
        return 'private';
    }
    if (location.isTraveling) {
        return 'traveling';
    }
    return '';
}

export { normalizeLocationValue };

function getObject(value: unknown): LocationRecord | null {
    return value && typeof value === 'object'
        ? (value as LocationRecord)
        : null;
}

function getFriendLocationValues(
    friend: unknown,
    field: 'location' | 'traveling'
): unknown[] {
    const direct = getObject(friend);
    const ref = getObject(direct?.ref);
    if (field === 'traveling') {
        if (ref) {
            return [ref.travelingToLocation, ref.$travelingToLocation];
        }
        return [direct?.travelingToLocation, direct?.$travelingToLocation];
    }
    if (ref) {
        return [ref.location, ref.$location?.tag, ref.$locationTag];
    }
    return [direct?.location, direct?.$location?.tag, direct?.$locationTag];
}

function isSentinelLocationValue(value: unknown): boolean {
    const normalized = normalizeLocationValue(value).toLowerCase();
    return SENTINEL_LOCATION_VALUES.has(normalized);
}

function normalizeSentinelLocationValue(value: unknown): string {
    const normalized = normalizeLocationValue(value).toLowerCase();
    return isSentinelLocationValue(normalized) ? normalized.split(':')[0] : '';
}

function resolveCurrentFriendLocationValue(friend: unknown): string {
    const direct = getObject(friend);
    const ref = getObject(direct?.ref);
    const values = ref ? [ref.location] : [direct?.location];
    for (const value of values) {
        const normalized = normalizeLocationValue(value);
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

function resolveCurrentFriendLocationSentinel(friend: unknown): string {
    return normalizeSentinelLocationValue(
        resolveCurrentFriendLocationValue(friend)
    );
}

function getFriendId(friend: unknown): string {
    const direct = getObject(friend);
    const ref = getObject(direct?.ref);
    return normalizeLocationValue(
        direct?.id || direct?.userId || ref?.id || ref?.userId
    );
}

function isConcreteInstanceLocation(location: unknown): boolean {
    const normalized = normalizeLocationValue(location);
    if (!isRealInstance(normalized)) {
        return false;
    }
    const parsed = parseLocation(normalized);
    return Boolean(parsed.worldId && parsed.instanceId);
}

function isLastLocationFriend(
    lastLocation: LastLocation | null | undefined,
    friend: unknown
): boolean {
    const friendId = getFriendId(friend);
    if (!friendId) {
        return false;
    }
    const friendList = lastLocation?.friendList;
    if (friendList instanceof Set) {
        return friendList.has(friendId);
    }
    if (friendList instanceof Map) {
        return friendList.has(friendId);
    }
    if (Array.isArray(friendList)) {
        return friendList.includes(friendId);
    }
    if (friendList && typeof friendList === 'object') {
        return Boolean(friendList[friendId]);
    }
    return false;
}

function resolveFriendPresenceLocation(
    friend: unknown,
    {
        preferTraveling = true,
        requireInstance = false,
        lastLocation = null
    }: ResolveFriendPresenceOptions = {}
): string {
    const currentLocation = resolveCurrentFriendLocationValue(friend);
    const currentSentinel = resolveCurrentFriendLocationSentinel(friend);
    if (currentSentinel === 'offline' || currentSentinel === 'private') {
        return requireInstance ? '' : currentSentinel;
    }

    const currentLocationIsConcrete =
        isConcreteInstanceLocation(currentLocation);
    const canUseLegacyLocationFields =
        currentLocationIsConcrete || currentSentinel === 'traveling';
    const orderedFields: Array<'location' | 'traveling'> =
        preferTraveling && currentSentinel === 'traveling'
            ? ['traveling', 'location']
            : ['location', 'traveling'];
    for (const field of orderedFields) {
        if (field === 'location' && currentSentinel === 'traveling') {
            continue;
        }
        const values =
            field === 'location' && !canUseLegacyLocationFields
                ? [currentLocation]
                : getFriendLocationValues(friend, field);
        for (const value of values) {
            const normalized = normalizeLocationValue(value);
            if (!normalized || !isRealInstance(normalized)) {
                continue;
            }
            if (requireInstance && !isConcreteInstanceLocation(normalized)) {
                continue;
            }
            return normalized;
        }
    }
    if (currentSentinel === 'traveling') {
        return requireInstance ? '' : 'traveling';
    }
    const lastLocationValue = currentLocationIsConcrete
        ? normalizeLocationValue(lastLocation?.location)
        : '';
    if (lastLocationValue && isLastLocationFriend(lastLocation, friend)) {
        if (!requireInstance || isConcreteInstanceLocation(lastLocationValue)) {
            return lastLocationValue;
        }
    }
    return '';
}

/**
 *
 * @param {Array} friendsArr
 * @param {object} lastLocation - last location from location store
 * @param {Set} lastLocation.friendList
 * @param {string} lastLocation.location
 */
function getFriendsLocations(
    friendsArr: unknown[],
    lastLocation?: LastLocation | null
): string {
    if (!friendsArr?.length) {
        return '';
    }
    for (const friend of friendsArr) {
        for (const value of getFriendLocationValues(friend, 'location')) {
            const location = normalizeLocationValue(value);
            if (isRealInstance(location)) {
                return location;
            }
        }
    }
    for (const friend of friendsArr) {
        for (const value of getFriendLocationValues(friend, 'traveling')) {
            const location = normalizeLocationValue(value);
            if (isRealInstance(location)) {
                return location;
            }
        }
    }
    if (lastLocation) {
        for (const friend of friendsArr) {
            if (isLastLocationFriend(lastLocation, friend)) {
                return normalizeLocationValue(lastLocation.location);
            }
        }
    }
    return resolveCurrentFriendLocationValue(friendsArr[0]);
}

export { getFriendsLocations, resolveFriendPresenceLocation };

/**
 * Get the display text for a location — synchronous, pure function.
 * Does NOT handle async world name lookups (those stay in the component).
 * @param {object} L - Parsed location object from parseLocation()
 * @param {object} options
 * @param {string} [options.hint] - Hint string (e.g. from props)
 * @param {string|undefined} [options.worldName] - Cached world name, if available
 * @param {string} options.accessTypeLabel - Translated access type label
 * @param {Function} options.t - i18n translate function
 * @returns {string} Display text for the location
 */
function getLocationText(
    L: ParsedLocation,
    { hint, worldName, accessTypeLabel, t }: LocationTextOptions
): string {
    if (L.isOffline) {
        return t('location.offline');
    }
    if (L.isPrivate) {
        return t('location.private');
    }
    if (L.isTraveling) {
        return t('location.traveling');
    }
    if (typeof hint === 'string' && hint !== '') {
        return L.instanceId ? `${hint} · ${accessTypeLabel}` : hint;
    }
    if (L.worldId) {
        const name = worldName || L.worldId;
        return L.instanceId ? `${name} · ${accessTypeLabel}` : name;
    }
    return '';
}

export { getLocationText };
