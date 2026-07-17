import { instanceLocationKey } from '@/domain/presence/instancePresence';
import {
    parseLocation,
    resolveRegion,
    type ParsedLocation
} from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';

import {
    findCachedInstance,
    isInstanceClosed,
    readInstanceDisplayName,
    readInstanceGroupName,
    readInstanceWorldName
} from './locationMetadataCache';
import type {
    GroupProfileRecord,
    LocationCacheRecord,
    LocationHintRecord,
    LocationMetadata,
    LocationMetadataEntry,
    MetadataContext,
    NormalizedLocationMetadataEntry,
    WorldProfileRecord
} from './locationMetadataTypes';

const WORLD_ID_PATTERN =
    /(?:^|\b)wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::|$|\s)/i;
const GROUP_ID_PATTERN =
    /^grp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRawWorldReference(value: unknown) {
    const normalizedValue = normalizeString(value);
    return Boolean(normalizedValue && WORLD_ID_PATTERN.test(normalizedValue));
}

export function normalizeWorldNameHint(
    hint: unknown,
    parsedLocation: ParsedLocation | Record<string, unknown> | null | undefined,
    currentLocation: unknown
) {
    const normalizedHint = normalizeString(hint);
    if (!normalizedHint) {
        return '';
    }
    if (
        normalizedHint === normalizeString(parsedLocation?.worldId) ||
        normalizedHint === normalizeString(parsedLocation?.tag) ||
        normalizedHint === normalizeString(currentLocation) ||
        isRawWorldReference(normalizedHint)
    ) {
        return '';
    }
    return normalizedHint;
}

export function normalizeGroupNameHint(hint: unknown, groupId: unknown) {
    const normalizedHint = normalizeString(hint);
    if (!normalizedHint) {
        return '';
    }
    if (
        normalizedHint === normalizeString(groupId) ||
        GROUP_ID_PATTERN.test(normalizedHint)
    ) {
        return '';
    }
    return normalizedHint;
}

function groupProfileName(group: GroupProfileRecord | undefined) {
    return normalizeString(
        group?.name || group?.displayName || group?.shortCode
    );
}

export function createEmptyMetadata(
    currentEndpoint: unknown = ''
): LocationMetadata {
    return {
        currentEndpoint: normalizeString(currentEndpoint),
        region: '',
        instanceName: '',
        isClosed: false,
        groupName: '',
        worldName: '',
        worldNameHint: ''
    };
}

export function normalizeMetadataEntry(
    entry: LocationMetadataEntry | null | undefined,
    index: number
): NormalizedLocationMetadataEntry {
    const source = entry && typeof entry === 'object' ? entry : {};
    const locationInfo = parseLocation(
        source.locationInfo || source.currentLocation
    );
    const normalizedCurrentLocation = normalizeString(
        source.currentLocation || locationInfo?.tag
    );

    return {
        key:
            source.key === undefined || source.key === null
                ? String(index)
                : source.key,
        locationInfo,
        currentLocation: normalizedCurrentLocation,
        locationTag: normalizeString(locationInfo?.tag),
        locationValue: normalizeString(locationInfo?.location),
        worldId: normalizeString(locationInfo?.worldId),
        groupId: normalizeString(locationInfo?.groupId),
        hint: normalizeString(source.hint),
        worldNameHint: normalizeString(source.worldNameHint),
        groupHint: normalizeString(source.groupHint),
        instanceName: normalizeString(source.instanceName)
    };
}

export function uniqueIds(
    entries: readonly NormalizedLocationMetadataEntry[],
    fieldName: 'worldId' | 'groupId'
) {
    const ids = new Set<string>();
    for (const entry of entries) {
        const id = normalizeString(entry?.[fieldName]);
        if (id) {
            ids.add(id);
        }
    }
    return Array.from(ids);
}

export function mapQueryResults<TData>(
    ids: readonly string[],
    queryResults: readonly { data?: TData | null | undefined }[]
) {
    const map = new Map<string, TData>();
    ids.forEach((id, index) => {
        const data = queryResults[index]?.data;
        if (data) {
            map.set(id, data);
        }
    });
    return map;
}

function resolveEntryCachedInstance(
    entry: NormalizedLocationMetadataEntry,
    cachedInstances: Map<string, LocationCacheRecord>
) {
    return findCachedInstance(cachedInstances, [
        entry.locationTag,
        entry.currentLocation,
        entry.locationValue
    ]);
}

function resolveEntryLocationHint(
    entry: NormalizedLocationMetadataEntry,
    locationHintsByKey: Record<string, LocationHintRecord | undefined>,
    currentEndpoint: string
) {
    const locationKey = instanceLocationKey(
        entry.locationTag || entry.currentLocation || entry.locationValue
    );
    if (!locationKey) {
        return null;
    }
    return (
        locationHintsByKey?.[
            `${currentEndpoint || 'default'}::${locationKey}`
        ] ||
        locationHintsByKey?.[`default::${locationKey}`] ||
        null
    );
}

function resolveEntryWorldNameHint(entry: NormalizedLocationMetadataEntry) {
    return (
        normalizeWorldNameHint(
            entry.hint,
            entry.locationInfo,
            entry.currentLocation
        ) ||
        normalizeWorldNameHint(
            entry.worldNameHint,
            entry.locationInfo,
            entry.currentLocation
        )
    );
}

export function resolveEntryMetadata(
    entry: NormalizedLocationMetadataEntry,
    {
        cachedInstances,
        currentEndpoint,
        groupProfilesById,
        locationHintsByKey,
        localWorldNamesById,
        worldProfilesById
    }: MetadataContext
): LocationMetadata {
    const cachedInstance = resolveEntryCachedInstance(entry, cachedInstances);
    const locationHint = resolveEntryLocationHint(
        entry,
        locationHintsByKey,
        currentEndpoint
    );
    const worldNameHint = resolveEntryWorldNameHint(entry);
    const cachedWorldName = normalizeWorldNameHint(
        readInstanceWorldName(cachedInstance),
        entry.locationInfo,
        entry.currentLocation
    );
    const queryGroupName = groupProfileName(
        groupProfilesById.get(entry.groupId)
    );
    const cachedGroupName =
        normalizeGroupNameHint(
            readInstanceGroupName(cachedInstance),
            entry.groupId
        ) || normalizeGroupNameHint(locationHint?.groupName, entry.groupId);
    const resolvedInstanceName =
        readInstanceDisplayName(cachedInstance) ||
        normalizeString(entry.instanceName) ||
        normalizeString(entry.locationInfo?.instanceName);
    const groupName =
        normalizeGroupNameHint(entry.groupHint, entry.groupId) ||
        queryGroupName ||
        cachedGroupName ||
        entry.groupId;
    const queryWorldName = normalizeWorldNameHint(
        worldProfilesById.get(entry.worldId)?.name,
        entry.locationInfo,
        entry.currentLocation
    );
    const hintedWorldName = normalizeWorldNameHint(
        locationHint?.worldName,
        entry.locationInfo,
        entry.currentLocation
    );
    const localWorldName = normalizeWorldNameHint(
        localWorldNamesById.get(entry.worldId),
        entry.locationInfo,
        entry.currentLocation
    );
    const worldName =
        worldNameHint ||
        queryWorldName ||
        cachedWorldName ||
        hintedWorldName ||
        localWorldName;

    return {
        currentEndpoint,
        region:
            resolveRegion(entry.locationInfo || {}) ||
            normalizeString(locationHint?.region),
        instanceName:
            resolvedInstanceName || normalizeString(locationHint?.instanceName),
        isClosed: Boolean(
            (cachedInstance && isInstanceClosed(cachedInstance)) ||
            locationHint?.isClosed
        ),
        groupName,
        worldName,
        worldNameHint
    };
}

export function entryHasWorldNameFromQueryOrCache(
    entry: NormalizedLocationMetadataEntry,
    cachedInstances: Map<string, LocationCacheRecord>,
    worldProfilesById: Map<string, WorldProfileRecord>
) {
    const cachedInstance = resolveEntryCachedInstance(entry, cachedInstances);
    const cachedWorldName = normalizeWorldNameHint(
        readInstanceWorldName(cachedInstance),
        entry.locationInfo,
        entry.currentLocation
    );
    const queriedWorldName = normalizeWorldNameHint(
        worldProfilesById.get(entry.worldId)?.name,
        entry.locationInfo,
        entry.currentLocation
    );
    return Boolean(cachedWorldName || queriedWorldName);
}

export function entryHasWorldNameWithoutRemoteQuery(
    entry: NormalizedLocationMetadataEntry,
    {
        cachedInstances,
        currentEndpoint,
        locationHintsByKey,
        localWorldNamesById
    }: Pick<
        MetadataContext,
        | 'cachedInstances'
        | 'currentEndpoint'
        | 'locationHintsByKey'
        | 'localWorldNamesById'
    >
) {
    const cachedInstance = resolveEntryCachedInstance(entry, cachedInstances);
    const locationHint = resolveEntryLocationHint(
        entry,
        locationHintsByKey,
        currentEndpoint
    );
    const cachedWorldName = normalizeWorldNameHint(
        readInstanceWorldName(cachedInstance),
        entry.locationInfo,
        entry.currentLocation
    );
    const hintedWorldName = normalizeWorldNameHint(
        locationHint?.worldName,
        entry.locationInfo,
        entry.currentLocation
    );
    const localWorldName = normalizeWorldNameHint(
        localWorldNamesById.get(entry.worldId),
        entry.locationInfo,
        entry.currentLocation
    );
    return Boolean(
        resolveEntryWorldNameHint(entry) ||
        cachedWorldName ||
        hintedWorldName ||
        localWorldName
    );
}
