import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
    gameLogRepository,
    groupProfileRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import {
    entityQueryPolicies,
    queryKeys
} from '@/services/entityQueryCacheService.js';
import { parseLocation, resolveRegion } from '@/shared/utils/location.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

const WORLD_ID_PATTERN =
    /(?:^|\b)wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::|$|\s)/i;

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

export function useLocationMetadata({
    locationInfo,
    currentLocation = '',
    endpoint = '',
    hint = '',
    worldNameHint: providedWorldNameHint = '',
    groupHint = '',
    instanceName = ''
}) {
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
    const [localWorldName, setLocalWorldName] = useState('');
    const normalizedCurrentLocation = normalizeString(
        currentLocation || locationInfo?.tag
    );
    const locationTag = normalizeString(locationInfo?.tag);
    const locationValue = normalizeString(locationInfo?.location);
    const worldId = normalizeString(locationInfo?.worldId);
    const groupId = normalizeString(locationInfo?.groupId);
    const cachedInstance = useMemo(
        () =>
            findCachedInstance(cachedInstances, [
                locationTag,
                normalizedCurrentLocation,
                locationValue
            ]),
        [cachedInstances, locationTag, normalizedCurrentLocation, locationValue]
    );
    const worldNameHint =
        normalizeWorldNameHint(hint, locationInfo, normalizedCurrentLocation) ||
        normalizeWorldNameHint(
            providedWorldNameHint,
            locationInfo,
            normalizedCurrentLocation
        );
    const cachedWorldName = normalizeWorldNameHint(
        readInstanceWorldName(cachedInstance),
        locationInfo,
        normalizedCurrentLocation
    );
    const hintedGroupName =
        normalizeString(groupHint) || readInstanceGroupName(cachedInstance);
    const resolvedInstanceName =
        readInstanceDisplayName(cachedInstance) ||
        normalizeString(instanceName) ||
        normalizeString(locationInfo?.instanceName);

    const groupProfileQuery = useQuery({
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
        refetchOnWindowFocus: entityQueryPolicies.group.refetchOnWindowFocus
    });
    const worldProfileQuery = useQuery({
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
    });

    const groupName = useMemo(
        () => groupProfileName(groupProfileQuery.data) || hintedGroupName,
        [groupProfileQuery.data, hintedGroupName]
    );
    const worldName =
        normalizeWorldNameHint(
            worldProfileQuery.data?.name,
            locationInfo,
            normalizedCurrentLocation
        ) ||
        cachedWorldName ||
        localWorldName ||
        worldNameHint;

    useEffect(() => {
        let active = true;
        setLocalWorldName('');

        if (!worldId || cachedWorldName) {
            return () => {
                active = false;
            };
        }

        gameLogRepository
            .getWorldNameByWorldId(worldId)
            .then((name) => {
                const nextName = normalizeWorldNameHint(
                    name,
                    locationInfo,
                    normalizedCurrentLocation
                );
                if (active && nextName) {
                    setLocalWorldName(nextName);
                }
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [
        cachedWorldName,
        locationInfo,
        normalizedCurrentLocation,
        worldId,
        worldNameHint
    ]);

    return {
        currentEndpoint,
        region: resolveRegion(locationInfo || {}),
        instanceName: resolvedInstanceName,
        isClosed: Boolean(cachedInstance && isInstanceClosed(cachedInstance)),
        groupName,
        worldName,
        worldNameHint
    };
}
