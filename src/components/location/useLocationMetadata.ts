import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import gameLogRepository from '@/repositories/gameLogRepository';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
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
    GroupProfileRecord,
    LocationMetadata,
    LocationMetadataEntry,
    WorldProfileRecord
} from './location-metadata/locationMetadataTypes';

export type { LocationMetadata, LocationMetadataEntry };

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
                    worldId
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
