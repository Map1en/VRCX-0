import { useEffect, useState } from 'react';

import type { LoadStatus } from '@/domain/shared/types';
import { toLocalDayKey } from '@/lib/instanceActivityDate';
import instanceActivityRepository from '@/repositories/instanceActivityRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { parseLocation } from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';

import { getLocalDayBounds } from './instanceActivityRows';
import type {
    InstanceActivityRawRow,
    WorldDetailsById
} from './instanceActivityTypes';

type UseInstanceActivityDataOptions = {
    currentEndpoint: string;
    currentUserId: string;
    reloadToken: number;
    selectedDate: string;
};

type AvailableDatesState = {
    queryKey: string;
    dates: string[];
    status: LoadStatus;
    error: string;
};

type ActivityDataState = {
    queryKey: string;
    rows: InstanceActivityRawRow[];
    worldDetailsById: WorldDetailsById;
    status: LoadStatus;
    error: string;
};

function hasWorldName(
    world: unknown
): world is Record<string, unknown> & { name: string } {
    if (!isRecord(world)) {
        return false;
    }
    return typeof world.name === 'string' && Boolean(world.name.trim());
}

async function loadMissingWorldProfiles(
    worldIds: string[],
    worldDetailsById: WorldDetailsById
): Promise<WorldDetailsById> {
    const missingWorldIds = worldIds.filter(
        (worldId) => !hasWorldName(worldDetailsById[worldId])
    );
    if (!missingWorldIds.length) {
        return worldDetailsById;
    }

    const results = await Promise.allSettled(
        missingWorldIds.map((worldId) =>
            worldProfileRepository.getWorldProfile({ worldId })
        )
    );
    const nextWorldDetailsById: WorldDetailsById = { ...worldDetailsById };
    for (const result of results) {
        if (result.status !== 'fulfilled' || !hasWorldName(result.value)) {
            continue;
        }
        const world = result.value;
        const worldId = String(world.id || '').trim();
        if (!worldId) {
            continue;
        }
        nextWorldDetailsById[worldId] = {
            ...nextWorldDetailsById[worldId],
            ...world
        };
    }
    return nextWorldDetailsById;
}

export function useInstanceActivityData({
    currentEndpoint,
    currentUserId,
    reloadToken,
    selectedDate
}: UseInstanceActivityDataOptions) {
    const availableDatesQueryKey = currentUserId
        ? `${currentEndpoint}\u0000${currentUserId}\u0000${reloadToken}`
        : '';
    const activityDataQueryKey =
        currentUserId && selectedDate
            ? `${availableDatesQueryKey}\u0000${selectedDate}`
            : '';
    const [availableDatesState, setAvailableDatesState] =
        useState<AvailableDatesState>({
            queryKey: '',
            dates: [],
            status: 'idle',
            error: ''
        });
    const [activityDataState, setActivityDataState] =
        useState<ActivityDataState>({
            queryKey: '',
            rows: [],
            worldDetailsById: {},
            status: 'idle',
            error: ''
        });
    const visibleAvailableDatesState: AvailableDatesState =
        availableDatesState.queryKey === availableDatesQueryKey
            ? availableDatesState
            : {
                  queryKey: availableDatesQueryKey,
                  dates: [],
                  status: availableDatesQueryKey ? 'running' : 'idle',
                  error: ''
              };
    const visibleActivityDataState: ActivityDataState =
        activityDataState.queryKey === activityDataQueryKey
            ? activityDataState
            : {
                  queryKey: activityDataQueryKey,
                  rows: [],
                  worldDetailsById: {},
                  status: activityDataQueryKey ? 'running' : 'idle',
                  error: ''
              };

    useEffect(() => {
        let active = true;

        if (!currentUserId) {
            return () => {
                active = false;
            };
        }

        setAvailableDatesState({
            queryKey: availableDatesQueryKey,
            dates: [],
            status: 'running',
            error: ''
        });

        instanceActivityRepository
            .getAvailableDates(currentUserId)
            .then((rows) => {
                if (!active) {
                    return;
                }

                const uniqueDates = Array.from(
                    new Set(
                        rows
                            .map((value) => toLocalDayKey(value))
                            .filter(Boolean)
                    )
                ).sort((left, right) => right.localeCompare(left));
                setAvailableDatesState({
                    queryKey: availableDatesQueryKey,
                    dates: uniqueDates,
                    status: 'ready',
                    error: ''
                });
            })
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }

                setAvailableDatesState({
                    queryKey: availableDatesQueryKey,
                    dates: [],
                    status: 'error',
                    error: error instanceof Error ? error.message : ''
                });
            });

        return () => {
            active = false;
        };
    }, [availableDatesQueryKey, currentUserId]);

    useEffect(() => {
        let active = true;

        if (!currentUserId || !selectedDate) {
            return () => {
                active = false;
            };
        }

        const { start, end } = getLocalDayBounds(selectedDate);
        setActivityDataState({
            queryKey: activityDataQueryKey,
            rows: [],
            worldDetailsById: {},
            status: 'running',
            error: ''
        });

        instanceActivityRepository
            .getInstanceActivityRows(start.toISOString(), end.toISOString())
            .then(async (rows) => {
                if (!active) {
                    return;
                }

                const worldIds = Array.from(
                    new Set(
                        rows
                            .map((row) => parseLocation(row.location).worldId)
                            .filter((worldId): worldId is string =>
                                Boolean(worldId)
                            )
                    )
                );
                const nextWorldDetailsById =
                    await instanceActivityRepository.getWorldSummariesByIds(
                        worldIds
                    );
                const resolvedWorldDetailsById = await loadMissingWorldProfiles(
                    worldIds,
                    nextWorldDetailsById
                );

                if (!active) {
                    return;
                }

                setActivityDataState({
                    queryKey: activityDataQueryKey,
                    rows,
                    worldDetailsById: resolvedWorldDetailsById,
                    status: 'ready',
                    error: ''
                });
            })
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }

                setActivityDataState({
                    queryKey: activityDataQueryKey,
                    rows: [],
                    worldDetailsById: {},
                    status: 'error',
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Failed to load instance activity for the selected day.'
                });
            });

        return () => {
            active = false;
        };
    }, [activityDataQueryKey, currentUserId, selectedDate]);

    return {
        availableDates: visibleAvailableDatesState.dates,
        availableDatesError: visibleAvailableDatesState.error,
        availableDatesStatus: visibleAvailableDatesState.status,
        dataDetail: visibleActivityDataState.error,
        dataStatus: visibleActivityDataState.status,
        rawRows: visibleActivityDataState.rows,
        worldDetailsById: visibleActivityDataState.worldDetailsById
    };
}
