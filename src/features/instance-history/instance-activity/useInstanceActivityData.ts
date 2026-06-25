import { useEffect, useState } from 'react';

import instanceActivityRepository from '@/repositories/instanceActivityRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { parseLocation } from '@/shared/utils/location';

import { toLocalDayKey } from './instanceActivityDate';
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

function hasWorldName(world: unknown): world is { name: string } {
    if (!world || typeof world !== 'object') {
        return false;
    }
    return Boolean(String((world as { name?: unknown }).name || '').trim());
}

async function loadMissingWorldProfiles(
    worldIds: string[],
    worldDetailsById: WorldDetailsById,
    endpoint: string
): Promise<WorldDetailsById> {
    const missingWorldIds = worldIds.filter(
        (worldId) => !hasWorldName(worldDetailsById[worldId])
    );
    if (!missingWorldIds.length) {
        return worldDetailsById;
    }

    const results = await Promise.allSettled(
        missingWorldIds.map((worldId) =>
            worldProfileRepository.getWorldProfile({ worldId, endpoint })
        )
    );
    const nextWorldDetailsById: WorldDetailsById = { ...worldDetailsById };
    for (const result of results) {
        if (result.status !== 'fulfilled' || !hasWorldName(result.value)) {
            continue;
        }
        const world = result.value as Record<string, unknown> & {
            id?: string;
            name: string;
        };
        const worldId = String(world.id || '').trim();
        if (!worldId) {
            continue;
        }
        nextWorldDetailsById[worldId] = {
            ...(nextWorldDetailsById[worldId] || {}),
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
    const [availableDates, setAvailableDates] = useState<string[]>([]);
    const [dataStatus, setDataStatus] = useState('idle');
    const [dataDetail, setDataDetail] = useState('');
    const [rawRows, setRawRows] = useState<InstanceActivityRawRow[]>([]);
    const [worldDetailsById, setWorldDetailsById] = useState<WorldDetailsById>(
        {}
    );

    useEffect(() => {
        let active = true;

        if (!currentUserId) {
            setAvailableDates([]);
            return () => {
                active = false;
            };
        }

        instanceActivityRepository
            .getAvailableDates(currentUserId)
            .then((rows) => {
                if (!active) {
                    return;
                }

                const uniqueDates = Array.from(
                    new Set(
                        rows
                            .map((value) =>
                                toLocalDayKey(value as string | number | Date)
                            )
                            .filter(Boolean)
                    )
                ).sort((left, right) => right.localeCompare(left));
                setAvailableDates(uniqueDates);
            })
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }

                setDataDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load available instance activity dates.'
                );
            });

        return () => {
            active = false;
        };
    }, [currentUserId, reloadToken]);

    useEffect(() => {
        let active = true;

        if (!currentUserId || !selectedDate) {
            setDataStatus('idle');
            setRawRows([]);
            setWorldDetailsById({});
            return () => {
                active = false;
            };
        }

        const { start, end } = getLocalDayBounds(selectedDate);
        setDataStatus('running');
        setDataDetail('');

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
                            .filter(Boolean)
                    )
                ) as string[];
                const nextWorldDetailsById =
                    await instanceActivityRepository.getWorldSummariesByIds(
                        worldIds
                    );
                const resolvedWorldDetailsById = await loadMissingWorldProfiles(
                    worldIds,
                    nextWorldDetailsById,
                    currentEndpoint
                );

                if (!active) {
                    return;
                }

                setRawRows(rows);
                setWorldDetailsById(resolvedWorldDetailsById);
                setDataStatus('ready');
            })
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }

                setRawRows([]);
                setWorldDetailsById({});
                setDataStatus('error');
                setDataDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load instance activity for the selected day.'
                );
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId, selectedDate, reloadToken]);

    return {
        availableDates,
        dataDetail,
        dataStatus,
        rawRows,
        worldDetailsById
    };
}
