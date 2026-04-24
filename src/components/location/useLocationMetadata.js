import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
    gameLogRepository,
    groupProfileRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import {
    entityQueryPolicies,
    queryKeys
} from '@/lib/entityQueryCache.js';
import { parseLocation, resolveRegion } from '@/shared/utils/location.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

const WORLD_ID_PATTERN =
    /(?:^|\b)wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::|$|\s)/i;
const GROUP_ID_PATTERN =
    /^grp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeString(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function isRawWorldReference(value) {
    const normalizedValue = normalizeString(value);
    return Boolean(normalizedValue && WORLD_ID_PATTERN.test(normalizedValue));
}

function normalizeWorldNameHint(hint, parsedLocation, currentLocation) {
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

function normalizeGroupNameHint(hint, groupId) {
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

function instanceLocation(instance) {
    return normalizeString(
        instance?.location || instance?.tag || instance?.$location?.tag
    );
}

function locationCacheKey(location) {
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        return '';
    }
    return `${parsed.worldId}:${parsed.instanceId}`;
}

function buildCachedInstanceMap(instances) {
    const map = new Map();
    if (!Array.isArray(instances)) {
        return map;
    }

    for (const instance of instances) {
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

function findCachedInstance(cachedInstances, candidates) {
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

function readInstanceDisplayName(instance) {
    return normalizeString(
        instance?.displayName ||
            instance?.name ||
            instance?.instanceDisplayName ||
            instance?.$location?.displayName
    );
}

function readInstanceWorldName(instance) {
    return normalizeString(
        instance?.worldName ||
            instance?.world_name ||
            instance?.world?.name ||
            instance?.ref?.worldName ||
            instance?.ref?.world?.name ||
            instance?.$location?.worldName ||
            instance?.$location?.world?.name
    );
}

function readInstanceGroupName(instance) {
    return normalizeString(
        instance?.groupName ||
            instance?.group_name ||
            instance?.group?.name ||
            instance?.group?.displayName ||
            instance?.ref?.groupName ||
            instance?.ref?.group?.name ||
            instance?.ref?.group?.displayName ||
            instance?.$location?.groupName ||
            instance?.$location?.group?.name ||
            instance?.$location?.group?.displayName
    );
}

function isInstanceClosed(instance) {
    return Boolean(
        instance?.closedAt || instance?.closed_at || instance?.isClosed
    );
}

function groupProfileName(group) {
    return normalizeString(
        group?.name || group?.displayName || group?.shortCode
    );
}

function createEmptyMetadata(currentEndpoint = '') {
    return {
        currentEndpoint,
        region: '',
        instanceName: '',
        isClosed: false,
        groupName: '',
        worldName: '',
        worldNameHint: ''
    };
}

function normalizeMetadataEntry(entry, index) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const locationInfo =
        source.locationInfo && typeof source.locationInfo === 'object'
            ? source.locationInfo
            : {};
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

function uniqueIds(entries, fieldName) {
    const ids = new Set();
    for (const entry of entries) {
        const id = normalizeString(entry?.[fieldName]);
        if (id) {
            ids.add(id);
        }
    }
    return Array.from(ids);
}

function mapQueryResults(ids, queryResults) {
    const map = new Map();
    ids.forEach((id, index) => {
        const data = queryResults[index]?.data;
        if (data) {
            map.set(id, data);
        }
    });
    return map;
}

function resolveEntryCachedInstance(entry, cachedInstances) {
    return findCachedInstance(cachedInstances, [
        entry.locationTag,
        entry.currentLocation,
        entry.locationValue
    ]);
}

function resolveEntryWorldNameHint(entry) {
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
    entry,
    {
        cachedInstances,
        currentEndpoint,
        groupProfilesById,
        localWorldNamesById,
        worldProfilesById
    }
) {
    const cachedInstance = resolveEntryCachedInstance(entry, cachedInstances);
    const worldNameHint = resolveEntryWorldNameHint(entry);
    const cachedWorldName = normalizeWorldNameHint(
        readInstanceWorldName(cachedInstance),
        entry.locationInfo,
        entry.currentLocation
    );
    const hintedGroupName =
        normalizeGroupNameHint(entry.groupHint, entry.groupId) ||
        normalizeGroupNameHint(
            readInstanceGroupName(cachedInstance),
            entry.groupId
        );
    const resolvedInstanceName =
        readInstanceDisplayName(cachedInstance) ||
        normalizeString(entry.instanceName) ||
        normalizeString(entry.locationInfo?.instanceName);
    const groupName =
        groupProfileName(groupProfilesById.get(entry.groupId)) ||
        hintedGroupName;
    const localWorldName = normalizeWorldNameHint(
        localWorldNamesById.get(entry.worldId),
        entry.locationInfo,
        entry.currentLocation
    );
    const worldName =
        normalizeWorldNameHint(
            worldProfilesById.get(entry.worldId)?.name,
            entry.locationInfo,
            entry.currentLocation
        ) ||
        cachedWorldName ||
        localWorldName ||
        worldNameHint;

    return {
        currentEndpoint,
        region: resolveRegion(entry.locationInfo || {}),
        instanceName: resolvedInstanceName,
        isClosed: Boolean(cachedInstance && isInstanceClosed(cachedInstance)),
        groupName,
        worldName,
        worldNameHint
    };
}

function entryHasWorldNameFromQueryOrCache(
    entry,
    cachedInstances,
    worldProfilesById
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

export function useLocationMetadataBatch(entries = [], { endpoint = '' } = {}) {
    const storeEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentEndpoint = endpoint || storeEndpoint;
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const groupInstances =
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : [];
    const groupInstancesRevision =
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
    const worldIds = useMemo(
        () => uniqueIds(normalizedEntries, 'worldId'),
        [normalizedEntries]
    );
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
        combine: (results) => mapQueryResults(worldIds, results)
    });
    const groupProfilesById = useQueries({
        queries: groupIds.map((groupId) => ({
            queryKey: queryKeys.group(groupId, false, currentEndpoint),
            queryFn: () =>
                groupProfileRepository.getGroupProfile({
                    groupId,
                    endpoint: currentEndpoint,
                    includeRoles: false
                }),
            enabled: Boolean(groupId),
            staleTime: entityQueryPolicies.group.staleTime,
            gcTime: entityQueryPolicies.group.gcTime,
            retry: entityQueryPolicies.group.retry,
            refetchOnWindowFocus:
                entityQueryPolicies.group.refetchOnWindowFocus
        })),
        combine: (results) => mapQueryResults(groupIds, results)
    });
    const [localWorldNamesById, setLocalWorldNamesById] = useState(
        () => new Map()
    );
    const localWorldNameRequestIdsRef = useRef(new Set());
    const mountedRef = useRef(true);

    useEffect(
        () => {
            mountedRef.current = true;
            return () => {
                mountedRef.current = false;
            };
        },
        []
    );

    useEffect(() => {
        const missingWorldIds = new Set();

        for (const entry of normalizedEntries) {
            if (
                !entry.worldId ||
                localWorldNamesById.has(entry.worldId) ||
                localWorldNameRequestIdsRef.current.has(entry.worldId) ||
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
                    .then((name) => [worldId, normalizeString(name)])
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
        localWorldNamesById,
        normalizedEntries,
        worldProfilesById
    ]);

    return useMemo(() => {
        const metadataByKey = new Map();
        for (const entry of normalizedEntries) {
            metadataByKey.set(
                entry.key,
                resolveEntryMetadata(entry, {
                    cachedInstances,
                    currentEndpoint,
                    groupProfilesById,
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
