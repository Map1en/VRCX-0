import { useEffect, useMemo, useState } from 'react';

import { vrchatFavoriteRepository } from '@/repositories/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

const detailCache = new Map();
const detailPromises = new Map();
let detailCacheGeneration = 0;

export function clearFavoriteRemoteDetailsCache() {
    const result = {
        detailCacheCount: detailCache.size,
        detailPromiseCount: detailPromises.size
    };
    detailCacheGeneration += 1;
    detailCache.clear();
    detailPromises.clear();
    return result;
}

export function getFavoriteRemoteDetailsCacheStats() {
    return {
        detailCacheCount: detailCache.size,
        detailPromiseCount: detailPromises.size
    };
}

function normalizeValues(values) {
    return Array.from(
        new Set(
            (Array.isArray(values) ? values : [])
                .map((value) => (typeof value === 'string' ? value.trim() : String(value ?? '').trim()))
                .filter(Boolean)
        )
    );
}

function buildCacheKey(type, endpoint, idsKey, tagsKey) {
    return [type, endpoint || '', idsKey || '', tagsKey || ''].join('::');
}

function buildInitialState(status = 'idle', detail = '') {
    return {
        status,
        detail,
        data: {},
        lastLoadedAt: null
    };
}

function mapEntitiesById(items) {
    const byId = {};
    for (const item of Array.isArray(items) ? items : []) {
        const itemId =
            typeof item?.id === 'string' ? item.id.trim() : String(item?.id ?? '').trim();
        if (!itemId) {
            continue;
        }
        byId[itemId] = item;
    }
    return byId;
}

async function loadRemoteDetails(type, endpoint, tags) {
    if (type === 'avatar') {
        const avatars = await vrchatFavoriteRepository.getAllFavoriteAvatars({
            endpoint,
            tags
        });
        return mapEntitiesById(
            avatars.filter((avatar) => avatar?.releaseStatus !== 'hidden')
        );
    }

    const worlds = await vrchatFavoriteRepository.getAllFavoriteWorlds({ endpoint });
    return mapEntitiesById(worlds);
}

export function useFavoriteRemoteDetails({
    type,
    favoriteIds = [],
    avatarTags = [],
    enabled = true,
    refreshToken = 0
}) {
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const normalizedIds = useMemo(() => normalizeValues(favoriteIds), [favoriteIds]);
    const normalizedTags = useMemo(() => normalizeValues(avatarTags), [avatarTags]);
    const idsKey = normalizedIds.join('|');
    const tagsKey = normalizedTags.join('|');
    const cacheKey = buildCacheKey(type, endpoint, idsKey, tagsKey);
    const [state, setState] = useState(() => detailCache.get(cacheKey) ?? buildInitialState());

    useEffect(() => {
        const cachedState = detailCache.get(cacheKey);
        if (cachedState) {
            setState(cachedState);
            return;
        }

        if (!enabled || normalizedIds.length === 0) {
            setState(buildInitialState('ready'));
            return;
        }

        setState(
            buildInitialState(
                'idle',
                type === 'avatar'
                    ? 'Remote avatar detail sync is waiting to start.'
                    : 'Remote world detail sync is waiting to start.'
            )
        );
    }, [cacheKey, enabled, normalizedIds.length, refreshToken, type]);

    useEffect(() => {
        if (!enabled || normalizedIds.length === 0) {
            return;
        }

        const cachedState = detailCache.get(cacheKey);
        if (cachedState) {
            setState(cachedState);
            return;
        }

        let active = true;
        const effectGeneration = detailCacheGeneration;
        setState(
            buildInitialState(
                'running',
                type === 'avatar'
                    ? 'Loading remote avatar details.'
                    : 'Loading remote world details.'
            )
        );

        let promise = detailPromises.get(cacheKey);
        if (!promise) {
            const promiseGeneration = detailCacheGeneration;
            promise = loadRemoteDetails(type, endpoint, normalizedTags)
                .then((data) => {
                    if (promiseGeneration !== detailCacheGeneration) {
                        return null;
                    }
                    const filtered = {};
                    for (const favoriteId of normalizedIds) {
                        if (data[favoriteId]) {
                            filtered[favoriteId] = data[favoriteId];
                        }
                    }

                    const nextState = {
                        status: 'ready',
                        detail:
                            type === 'avatar'
                                ? `Loaded remote avatar details for ${Object.keys(filtered).length} favorites.`
                                : `Loaded remote world details for ${Object.keys(filtered).length} favorites.`,
                        data: filtered,
                        lastLoadedAt: new Date().toISOString()
                    };
                    detailCache.set(cacheKey, nextState);
                    return nextState;
                })
                .finally(() => {
                    if (promiseGeneration === detailCacheGeneration) {
                        detailPromises.delete(cacheKey);
                    }
                });
            detailPromises.set(cacheKey, promise);
        }

        promise
            .then((nextState) => {
                if (active && nextState) {
                    setState(nextState);
                }
            })
            .catch((error) => {
                if (!active || effectGeneration !== detailCacheGeneration) {
                    return;
                }

                setState({
                    status: 'error',
                    detail:
                        error instanceof Error
                            ? error.message
                            : `Failed to load remote ${type} favorites.`,
                    data: {},
                    lastLoadedAt: new Date().toISOString()
                });
            });

        return () => {
            active = false;
        };
    }, [cacheKey, enabled, endpoint, normalizedIds, normalizedTags, refreshToken, type]);

    return state;
}
