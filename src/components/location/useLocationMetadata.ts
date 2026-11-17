import { useQueries } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { GroupInstanceRecord } from '@/domain/entities/group';
import { groupProfileQueryOptions } from '@/lib/groupProfileQuery';
import gameLogRepository from '@/repositories/gameLogRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { parseLocation, type ParsedLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { useLocationHintStore } from '@/state/locationHintStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { buildCachedInstanceMap } from './location-metadata/locationMetadataCache';
import {
    createEmptyMetadata,
    entryHasWorldNameFromQueryOrCache,
    entryHasWorldNameWithoutRemoteQuery,
    mapQueryResults,
    normalizeMetadataEntry,
    resolveEntryMetadata,
    uniqueIds
} from './location-metadata/locationMetadataResolution';
import type {
    LocationGroupProfile,
    LocationMetadata,
    LocationMetadataEntry,
    LocationWorldProfile
} from './location-metadata/locationMetadataTypes';

export type { LocationMetadata, LocationMetadataEntry };

const WORLD_PROFILE_REQUEST_KEY_SEPARATOR = '\u0000';
const EMPTY_GROUP_INSTANCES: GroupInstanceRecord[] = [];

function isSameLocationMetadata(
    left: LocationMetadata,
    right: LocationMetadata
): boolean {
    return (
        left.currentEndpoint === right.currentEndpoint &&
        left.region === right.region &&
        left.instanceName === right.instanceName &&
        left.isClosed === right.isClosed &&
        left.groupName === right.groupName &&
        left.groupNamePending === right.groupNamePending &&
        left.worldName === right.worldName &&
        left.worldNameHint === right.worldNameHint &&
        left.worldNamePending === right.worldNamePending
    );
}

export function useLocationMetadataBatch(
    entries: readonly (LocationMetadataEntry | null | undefined)[] = [],
    { endpoint = '' }: { endpoint?: string } = {}
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
            : EMPTY_GROUP_INSTANCES;
    const groupInstancesRevision =
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.lastLoadedAt ||
              groupInstancesState.fetchedAt ||
              groupInstancesState.status
            : '';
    const cachedInstanceSnapshot = useMemo(
        () => ({
            revision: groupInstancesRevision,
            instances: buildCachedInstanceMap(groupInstances)
        }),
        [groupInstances, groupInstancesRevision]
    );
    const cachedInstances = cachedInstanceSnapshot.instances;
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
    const [worldProfilesById, setWorldProfilesById] = useState(
        () => new Map<string, LocationWorldProfile>()
    );
    const [settledWorldProfileIds, setSettledWorldProfileIds] = useState(
        () => new Set<string>()
    );
    const worldProfilesByIdRef = useRef(worldProfilesById);
    const worldProfilesEndpointRef = useRef(currentEndpoint);
    const worldProfileRequestsRef = useRef(
        new Map<string, Promise<LocationWorldProfile | null>>()
    );
    const worldIdsKey = [...worldIds]
        .sort()
        .join(WORLD_PROFILE_REQUEST_KEY_SEPARATOR);
    useEffect(() => {
        let active = true;
        const requestedWorldIds = worldIdsKey
            ? worldIdsKey.split(WORLD_PROFILE_REQUEST_KEY_SEPARATOR)
            : [];
        const endpointChanged =
            worldProfilesEndpointRef.current !== currentEndpoint;
        if (endpointChanged) {
            worldProfilesEndpointRef.current = currentEndpoint;
            worldProfilesByIdRef.current = new Map();
            setSettledWorldProfileIds(new Set());
        }

        const retainedProfiles = new Map<string, LocationWorldProfile>();
        for (const worldId of requestedWorldIds) {
            const profile = worldProfilesByIdRef.current.get(worldId);
            if (profile) {
                retainedProfiles.set(worldId, profile);
            }
        }
        if (
            endpointChanged ||
            retainedProfiles.size !== worldProfilesByIdRef.current.size
        ) {
            worldProfilesByIdRef.current = retainedProfiles;
            setWorldProfilesById(retainedProfiles);
        }

        const missingWorldIds = requestedWorldIds.filter(
            (worldId) => !retainedProfiles.has(worldId)
        );
        if (!missingWorldIds.length) {
            return () => {
                active = false;
            };
        }

        const requests = missingWorldIds.map((worldId) => {
            const requestKey = `${currentEndpoint}${WORLD_PROFILE_REQUEST_KEY_SEPARATOR}${worldId}`;
            const existingRequest =
                worldProfileRequestsRef.current.get(requestKey);
            if (existingRequest) {
                return existingRequest;
            }
            const request = worldProfileRepository
                .getWorldProfile({ worldId })
                .catch(() => null)
                .finally(() => {
                    worldProfileRequestsRef.current.delete(requestKey);
                });
            worldProfileRequestsRef.current.set(requestKey, request);
            return request;
        });

        Promise.all(requests).then((profiles) => {
            if (!active) {
                return;
            }
            const resolvedProfiles = new Map<string, LocationWorldProfile>();
            profiles.forEach((profile, index) => {
                if (profile) {
                    resolvedProfiles.set(missingWorldIds[index], profile);
                }
            });
            const nextProfiles = new Map<string, LocationWorldProfile>();
            for (const worldId of requestedWorldIds) {
                const profile =
                    resolvedProfiles.get(worldId) ||
                    worldProfilesByIdRef.current.get(worldId);
                if (profile) {
                    nextProfiles.set(worldId, profile);
                }
            }
            worldProfilesByIdRef.current = nextProfiles;
            setWorldProfilesById(nextProfiles);
            setSettledWorldProfileIds((currentIds) => {
                const nextIds = new Set(currentIds);
                for (const worldId of missingWorldIds) {
                    nextIds.add(worldId);
                }
                return nextIds;
            });
        });
        return () => {
            active = false;
        };
    }, [currentEndpoint, worldIdsKey]);
    const { groupProfilesById, pendingGroupIds } = useQueries({
        queries: groupIds.map((groupId) =>
            groupProfileQueryOptions(groupId, currentEndpoint)
        ),
        combine: (results) => ({
            groupProfilesById: mapQueryResults<LocationGroupProfile>(
                groupIds,
                results
            ),
            pendingGroupIds: new Set(
                groupIds.filter((_, index) => results[index]?.isPending)
            )
        })
    });
    const [settledLocalWorldIds, setSettledLocalWorldIds] = useState(
        () => new Set<string>()
    );
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
            if (!mountedRef.current) {
                return;
            }
            setSettledLocalWorldIds((currentIds) => {
                const nextIds = new Set(currentIds);
                for (const worldId of worldIdsToLoad) {
                    nextIds.add(worldId);
                }
                return nextIds;
            });
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

    const previousMetadataByKeyRef = useRef(
        new Map<string, LocationMetadata>()
    );
    const metadataByKey = useMemo(() => {
        const previousMetadataByKey = previousMetadataByKeyRef.current;
        const nextMetadataByKey = new Map<string, LocationMetadata>();
        for (const entry of normalizedEntries) {
            const metadata = resolveEntryMetadata(entry, {
                cachedInstances,
                currentEndpoint,
                groupProfilesById,
                pendingGroupIds,
                locationHintsByKey,
                localWorldNamesById,
                settledLocalWorldIds,
                settledWorldProfileIds,
                worldProfilesById
            });
            const previous = previousMetadataByKey.get(entry.key);
            nextMetadataByKey.set(
                entry.key,
                previous && isSameLocationMetadata(previous, metadata)
                    ? previous
                    : metadata
            );
        }
        return nextMetadataByKey;
    }, [
        cachedInstances,
        currentEndpoint,
        groupProfilesById,
        locationHintsByKey,
        localWorldNamesById,
        normalizedEntries,
        pendingGroupIds,
        settledLocalWorldIds,
        settledWorldProfileIds,
        worldProfilesById
    ]);
    useLayoutEffect(() => {
        previousMetadataByKeyRef.current = metadataByKey;
    }, [metadataByKey]);
    return metadataByKey;
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
    locationInfo?: ParsedLocation | string | null;
    currentLocation?: string;
    endpoint?: string;
    hint?: string | null;
    worldNameHint?: string;
    groupHint?: string;
    instanceName?: string;
}) {
    const entry = useMemo(
        () => [
            {
                key: 'location',
                locationInfo: parseLocation(locationInfo || currentLocation),
                currentLocation: normalizeString(currentLocation),
                hint: normalizeString(hint),
                worldNameHint: normalizeString(providedWorldNameHint),
                groupHint: normalizeString(groupHint),
                instanceName: normalizeString(instanceName)
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
