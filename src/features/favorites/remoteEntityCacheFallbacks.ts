import { useEffect, useMemo, useState } from 'react';

import { hasDisplayableEntityDetail } from './favoriteEntityDetails';
import { normalizeFavoriteEntityId as normalizeEntityId } from './favoritesItems';

export type DetailMap = Record<string, unknown>;

export const EMPTY_FALLBACKS: DetailMap = {};

type FetchEntityById = (id: string) => Promise<unknown>;

function normalizeFavoriteIds(values: readonly string[]): string[] {
    return Array.from(
        new Set(values.map((value) => value.trim()).filter(Boolean))
    );
}

function hasDisplayableDetail(map: DetailMap | undefined, entityId: string) {
    return hasDisplayableEntityDetail(map?.[entityId]);
}

export function getRemoteEntityCacheFallbackIds({
    entityIds,
    detailSources,
    isReady
}: {
    entityIds: string[];
    detailSources: Array<DetailMap | undefined>;
    isReady: boolean;
}): string[] {
    if (!isReady) {
        return [];
    }

    return normalizeFavoriteIds(entityIds).filter((entityId) =>
        detailSources.every((source) => !hasDisplayableDetail(source, entityId))
    );
}

export function filterRemoteEntityCacheFallbacksById(
    fallbacksById: DetailMap,
    entityIds: string[]
): DetailMap {
    const next: DetailMap = {};
    for (const entityId of entityIds) {
        const fallback = fallbacksById[entityId];
        if (hasDisplayableEntityDetail(fallback)) {
            next[entityId] = fallback;
        }
    }
    return Object.keys(next).length > 0 ? next : EMPTY_FALLBACKS;
}

export async function loadRemoteEntityCacheFallbacksById(
    entityIds: string[],
    fetchById: FetchEntityById
): Promise<DetailMap> {
    if (entityIds.length === 0) {
        return EMPTY_FALLBACKS;
    }

    const rows = await Promise.allSettled(
        entityIds.map(async (entityId) => ({
            queryEntityId: entityId,
            entity: await fetchById(entityId)
        }))
    );
    const fallbacksById: DetailMap = {};
    for (const result of rows) {
        if (result.status !== 'fulfilled') {
            continue;
        }

        const { queryEntityId, entity } = result.value;
        if (!hasDisplayableEntityDetail(entity)) {
            continue;
        }

        const entityId = normalizeEntityId(entity.id) || queryEntityId;
        if (entityId) {
            fallbacksById[entityId] = entity;
        }
    }
    return Object.keys(fallbacksById).length > 0
        ? fallbacksById
        : EMPTY_FALLBACKS;
}

export function useRemoteEntityCacheFallbackLoader(
    fallbackIds: string[],
    fetchById: FetchEntityById,
    refreshToken: unknown = 0
): DetailMap {
    const fallbackKey = JSON.stringify(fallbackIds);
    const stableFallbackIds = useMemo(() => {
        const parsed: unknown = JSON.parse(fallbackKey);
        return Array.isArray(parsed)
            ? parsed.filter(
                  (value): value is string => typeof value === 'string'
              )
            : [];
    }, [fallbackKey]);
    const [fallbacksById, setFallbacksById] =
        useState<DetailMap>(EMPTY_FALLBACKS);

    useEffect(() => {
        let active = true;
        if (stableFallbackIds.length === 0) {
            setFallbacksById(EMPTY_FALLBACKS);
            return () => {
                active = false;
            };
        }

        setFallbacksById(EMPTY_FALLBACKS);
        loadRemoteEntityCacheFallbacksById(stableFallbackIds, fetchById)
            .then((nextFallbacksById) => {
                if (active) {
                    setFallbacksById(nextFallbacksById);
                }
            })
            .catch(() => {
                if (active) {
                    setFallbacksById(EMPTY_FALLBACKS);
                }
            });

        return () => {
            active = false;
        };
    }, [fetchById, refreshToken, stableFallbackIds]);

    return useMemo(
        () =>
            filterRemoteEntityCacheFallbacksById(
                fallbacksById,
                stableFallbackIds
            ),
        [fallbacksById, stableFallbackIds]
    );
}
