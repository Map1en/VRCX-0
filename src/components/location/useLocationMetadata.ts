import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { instanceLocationKey } from '@/domain/presence/instancePresence';
import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import gameLogRepository from '@/repositories/gameLogRepository';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import {
    parseLocation,
    resolveRegion,
    type ParsedLocation
} from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { useLocationHintStore } from '@/state/locationHintStore';
import { useRuntimeStore } from '@/state/runtimeStore';

const WORLD_ID_PATTERN =
    /(?:^|\b)wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::|$|\s)/i;
const GROUP_ID_PATTERN =
    /^grp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LocationMetadata = {
    currentEndpoint: string;
    region: string;
    instanceName: string;
    isClosed: boolean;
    groupName: string;
    worldName: string;
    worldNameHint: string;
};

export type LocationMetadataEntry = {
    key?: unknown;
    locationInfo?: unknown;
    currentLocation?: unknown;
    hint?: unknown;
    worldNameHint?: unknown;
    groupHint?: unknown;
    instanceName?: unknown;
};

type NormalizedLocationMetadataEntry = {
    key: unknown;
    locationInfo: ParsedLocation;
    currentLocation: string;
    locationTag: string;
    locationValue: string;
    worldId: string;
    groupId: string;
    hint: string;
    worldNameHint: string;
    groupHint: string;
    instanceName: string;
};

type LocationCacheRecord = Record<string, unknown> & {
    $location?: unknown;
    closedAt?: unknown;
    closed_at?: unknown;
    displayName?: unknown;
    group?: unknown;
    groupName?: unknown;
    group_name?: unknown;
    isClosed?: unknown;
    instanceDisplayName?: unknown;
    location?: unknown;
    name?: unknown;
    ref?: unknown;
    tag?: unknown;
    world?: unknown;
    worldName?: unknown;
    world_name?: unknown;
};

type GroupProfileRecord = Record<string, unknown> & {
    displayName?: unknown;
    name?: unknown;
    shortCode?: unknown;
};

type WorldProfileRecord = Record<string, unknown> & {
    name?: unknown;
};

type LocationHintRecord = {
    groupName?: unknown;
    instanceName?: unknown;
    isClosed?: unknown;
    region?: unknown;
    worldName?: unknown;
};

type MetadataContext = {
    cachedInstances: Map<string, LocationCacheRecord>;
    currentEndpoint: string;
    groupProfilesById: Map<string, GroupProfileRecord>;
    locationHintsByKey: Record<string, LocationHintRecord | undefined>;
    localWorldNamesById: Map<string, string>;
    worldProfilesById: Map<string, WorldProfileRecord>;
};

function recordValue(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
}

function cacheRecord(value: unknown): LocationCacheRecord | null {
    return value && typeof value === 'object'
        ? (value as LocationCacheRecord)
        : null;
}

function isRawWorldReference(value: unknown) {
    const normalizedValue = normalizeString(value);
    return Boolean(normalizedValue && WORLD_ID_PATTERN.test(normalizedValue));
}

function normalizeWorldNameHint(
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

function normalizeGroupNameHint(hint: unknown, groupId: unknown) {
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

function instanceLocation(instance: LocationCacheRecord | null | undefined) {
    const location = recordValue(instance?.$location);
    return normalizeString(
        instance?.location || instance?.tag || location?.tag
    );
}

function locationCacheKey(location: unknown) {
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        return '';
    }
    return `${parsed.worldId}:${parsed.instanceId}`;
}

function buildCachedInstanceMap(instances: unknown) {
    const map = new Map<string, LocationCacheRecord>();
    if (!Array.isArray(instances)) {
        return map;
    }

    for (const value of instances) {
        const instance = cacheRecord(value);
        if (!instance) {
            continue;
        }
        const location = instanceLocation(instance);
        if (location) {
            map.set(location, instance);
            const key = locationCacheKey(location);
            if (key) {
                map.set(key, instance);
            }
        }
    }
    return map;
}

function findCachedInstance(
    cachedInstances: Map<string, LocationCacheRecord> | null | undefined,
    candidates: readonly unknown[]
) {
    if (!cachedInstances) {
        return null;
    }
    for (const candidate of candidates) {
        const location = normalizeString(candidate);
        if (!location) {
            continue;
        }
        const direct = cachedInstances.get(location);
        if (direct) {
            return direct;
        }
        const key = locationCacheKey(location);
        if (key) {
            const keyed = cachedInstances.get(key);
            if (keyed) {
                return keyed;
            }
        }
    }
    return null;
}

function readInstanceDisplayName(instance: LocationCacheRecord | null) {
    const location = recordValue(instance?.$location);
    return normalizeString(
        instance?.displayName ||
            instance?.name ||
            instance?.instanceDisplayName ||
            location?.displayName
    );
}

function readInstanceWorldName(instance: LocationCacheRecord | null) {
    const world = recordValue(instance?.world);
    const ref = recordValue(instance?.ref);
    const refWorld = recordValue(ref?.world);
    const location = recordValue(instance?.$location);
    const locationWorld = recordValue(location?.world);
    return normalizeString(
        instance?.worldName ||
            instance?.world_name ||
            world?.name ||
            ref?.worldName ||
            refWorld?.name ||
            location?.worldName ||
            locationWorld?.name
    );
}

function readInstanceGroupName(instance: LocationCacheRecord | null) {
    const group = recordValue(instance?.group);
    const ref = recordValue(instance?.ref);
    const refGroup = recordValue(ref?.group);
    const location = recordValue(instance?.$location);
    const locationGroup = recordValue(location?.group);
    return normalizeString(
        instance?.groupName ||
            instance?.group_name ||
            group?.name ||
            group?.displayName ||
            ref?.groupName ||
            refGroup?.name ||
            refGroup?.displayName ||
            location?.groupName ||
            locationGroup?.name ||
            locationGroup?.displayName
    );
}

function isInstanceClosed(instance: LocationCacheRecord | null) {
    return Boolean(
        instance?.closedAt || instance?.closed_at || instance?.isClosed
    );
}

function groupProfileName(group: GroupProfileRecord | undefined) {
    return normalizeString(
        group?.name || group?.displayName || group?.shortCode
    );
}

function createEmptyMetadata(currentEndpoint: unknown = ''): LocationMetadata {
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

function normalizeMetadataEntry(
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

function uniqueIds(
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

function mapQueryResults<TData>(
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

function resolveEntryMetadata(
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

function entryHasWorldNameFromQueryOrCache(
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

function entryHasWorldNameWithoutRemoteQuery(
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

export function useLocationMetadataBatch(
    entries: readonly (LocationMetadataEntry | null | undefined)[] = [],
    { endpoint = '' }: { endpoint?: unknown } = {}
) {
    const storeEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = normalizeString(endpoint || storeEndpoint);
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const locationHintsByKey = useLocationHintStore(
        (state) => state.hintsByKey
    );
    const groupInstances =
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : [];
    const groupInstancesRevision =
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.lastLoadedAt ||
              groupInstancesState.fetchedAt ||
              groupInstancesState.status
            : '';
    const cachedInstances = useMemo(
        () => buildCachedInstanceMap(groupInstances),
        [groupInstances, groupInstancesRevision]
    );
    const normalizedEntries = useMemo(
        () =>
            (Array.isArray(entries) ? entries : []).map((entry, index) =>
                normalizeMetadataEntry(entry, index)
            ),
        [entries]
    );
    const [localWorldNamesById, setLocalWorldNamesById] = useState(
        () => new Map<string, string>()
    );
    const worldIds = useMemo(() => {
        const ids = new Set<string>();
        for (const entry of normalizedEntries) {
            if (
                !entry.worldId ||
                entryHasWorldNameWithoutRemoteQuery(entry, {
                    cachedInstances,
                    currentEndpoint,
                    locationHintsByKey,
                    localWorldNamesById
                })
            ) {
                continue;
            }
            ids.add(entry.worldId);
        }
        return Array.from(ids);
    }, [
        cachedInstances,
        currentEndpoint,
        localWorldNamesById,
        locationHintsByKey,
        normalizedEntries
    ]);
    const groupIds = useMemo(
        () => uniqueIds(normalizedEntries, 'groupId'),
        [normalizedEntries]
    );
    const worldProfilesById = useQueries({
        queries: worldIds.map((worldId) => ({
            queryKey: queryKeys.world(worldId, currentEndpoint),
            queryFn: () =>
                worldProfileRepository.fetchWorldProfile({
                    worldId,
                    endpoint: currentEndpoint
                }),
            enabled: Boolean(worldId),
            staleTime: entityQueryPolicies.worldBasic.staleTime,
            gcTime: entityQueryPolicies.worldBasic.gcTime,
            retry: entityQueryPolicies.worldBasic.retry,
            refetchOnWindowFocus:
                entityQueryPolicies.worldBasic.refetchOnWindowFocus
        })),
        combine: (results) =>
            mapQueryResults<WorldProfileRecord>(worldIds, results)
    });
    const groupProfilesById = useQueries({
        queries: groupIds.map((groupId) => ({
            queryKey: queryKeys.group(groupId, false, currentEndpoint),
            queryFn: () =>
                groupProfileRepository.fetchGroupProfile({
                    groupId,
                    endpoint: currentEndpoint,
                    includeRoles: false
                }),
            enabled: Boolean(groupId),
            staleTime: entityQueryPolicies.group.staleTime,
            gcTime: entityQueryPolicies.group.gcTime,
            retry: entityQueryPolicies.group.retry,
            refetchOnWindowFocus: entityQueryPolicies.group.refetchOnWindowFocus
        })),
        combine: (results) =>
            mapQueryResults<GroupProfileRecord>(groupIds, results)
    });
    const localWorldNameRequestIdsRef = useRef(new Set<string>());
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        const missingWorldIds = new Set<string>();

        for (const entry of normalizedEntries) {
            if (
                !entry.worldId ||
                localWorldNamesById.has(entry.worldId) ||
                localWorldNameRequestIdsRef.current.has(entry.worldId) ||
                entryHasWorldNameWithoutRemoteQuery(entry, {
                    cachedInstances,
                    currentEndpoint,
                    locationHintsByKey,
                    localWorldNamesById
                }) ||
                entryHasWorldNameFromQueryOrCache(
                    entry,
                    cachedInstances,
                    worldProfilesById
                )
            ) {
                continue;
            }
            missingWorldIds.add(entry.worldId);
        }

        if (!missingWorldIds.size) {
            return;
        }

        const worldIdsToLoad = Array.from(missingWorldIds);
        for (const worldId of worldIdsToLoad) {
            localWorldNameRequestIdsRef.current.add(worldId);
        }

        Promise.all(
            worldIdsToLoad.map((worldId) =>
                gameLogRepository
                    .getWorldNameByWorldId(worldId)
                    .then((name): [string, string] => [
                        worldId,
                        normalizeString(name)
                    ])
                    .catch(() => [worldId, ''])
            )
        ).then((results) => {
            for (const [worldId] of results) {
                localWorldNameRequestIdsRef.current.delete(worldId);
            }
            if (!mountedRef.current) {
                return;
            }
            setLocalWorldNamesById((currentNames) => {
                let changed = false;
                const nextNames = new Map(currentNames);
                for (const [worldId, name] of results) {
                    if (!name || nextNames.has(worldId)) {
                        continue;
                    }
                    nextNames.set(worldId, name);
                    changed = true;
                }
                return changed ? nextNames : currentNames;
            });
        });
    }, [
        cachedInstances,
        currentEndpoint,
        localWorldNamesById,
        locationHintsByKey,
        normalizedEntries,
        worldProfilesById
    ]);

    return useMemo(() => {
        const metadataByKey = new Map<unknown, LocationMetadata>();
        for (const entry of normalizedEntries) {
            metadataByKey.set(
                entry.key,
                resolveEntryMetadata(entry, {
                    cachedInstances,
                    currentEndpoint,
                    groupProfilesById,
                    locationHintsByKey,
                    localWorldNamesById,
                    worldProfilesById
                })
            );
        }
        return metadataByKey;
    }, [
        cachedInstances,
        currentEndpoint,
        groupProfilesById,
        locationHintsByKey,
        localWorldNamesById,
        normalizedEntries,
        worldProfilesById
    ]);
}

export function useLocationMetadata({
    locationInfo,
    currentLocation = '',
    endpoint = '',
    hint = '',
    worldNameHint: providedWorldNameHint = '',
    groupHint = '',
    instanceName = ''
}: {
    locationInfo?: unknown;
    currentLocation?: unknown;
    endpoint?: unknown;
    hint?: unknown;
    worldNameHint?: unknown;
    groupHint?: unknown;
    instanceName?: unknown;
}) {
    const entry = useMemo(
        () => [
            {
                key: 'location',
                locationInfo,
                currentLocation,
                hint,
                worldNameHint: providedWorldNameHint,
                groupHint,
                instanceName
            }
        ],
        [
            currentLocation,
            groupHint,
            hint,
            instanceName,
            locationInfo,
            providedWorldNameHint
        ]
    );
    const metadataByKey = useLocationMetadataBatch(entry, { endpoint });
    return metadataByKey.get('location') || createEmptyMetadata(endpoint);
}
