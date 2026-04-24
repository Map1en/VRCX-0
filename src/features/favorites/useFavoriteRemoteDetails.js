import { useEffect, useMemo, useState } from 'react';

import { vrchatFavoriteRepository } from '@/repositories/index.js';
import {
    deleteFavoriteRemoteDetailsPromise,
    getFavoriteRemoteDetailsCache,
    getFavoriteRemoteDetailsCacheGeneration,
    getFavoriteRemoteDetailsPromise,
    setFavoriteRemoteDetailsCache,
    setFavoriteRemoteDetailsPromise
} from '@/services/favoriteRemoteDetailsCacheService.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

function normalizeValues(values) {
    return Array.from(
        new Set(
            (Array.isArray(values) ? values : [])
                .map((value) =>
                    typeof value === 'string'
                        ? value.trim()
                        : String(value ?? '').trim()
                )
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
            typeof item?.id === 'string'
                ? item.id.trim()
                : String(item?.id ?? '').trim();
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

    const worlds = await vrchatFavoriteRepository.getAllFavoriteWorlds({
        endpoint
    });
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
    const normalizedIds = useMemo(
        () => normalizeValues(favoriteIds),
        [favoriteIds]
    );
    const normalizedTags = useMemo(
        () => normalizeValues(avatarTags),
        [avatarTags]
    );
    const idsKey = normalizedIds.join('|');
    const tagsKey = normalizedTags.join('|');
    const cacheKey = buildCacheKey(type, endpoint, idsKey, tagsKey);
    const [state, setState] = useState(
        () => getFavoriteRemoteDetailsCache(cacheKey) ?? buildInitialState()
    );

    useEffect(() => {
        const cachedState = getFavoriteRemoteDetailsCache(cacheKey);
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

        const cachedState = getFavoriteRemoteDetailsCache(cacheKey);
        if (cachedState) {
            setState(cachedState);
            return;
        }

        let active = true;
        const effectGeneration = getFavoriteRemoteDetailsCacheGeneration();
        setState(
            buildInitialState(
                'running',
                type === 'avatar'
                    ? 'Loading remote avatar details.'
                    : 'Loading remote world details.'
            )
        );

        let promise = getFavoriteRemoteDetailsPromise(cacheKey);
        if (!promise) {
            const promiseGeneration = getFavoriteRemoteDetailsCacheGeneration();
            promise = loadRemoteDetails(type, endpoint, normalizedTags)
                .then((data) => {
                    if (
                        promiseGeneration !==
                        getFavoriteRemoteDetailsCacheGeneration()
                    ) {
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
                    setFavoriteRemoteDetailsCache(cacheKey, nextState);
                    return nextState;
                })
                .finally(() => {
                    if (
                        promiseGeneration ===
                        getFavoriteRemoteDetailsCacheGeneration()
                    ) {
                        deleteFavoriteRemoteDetailsPromise(cacheKey);
                    }
                });
            setFavoriteRemoteDetailsPromise(cacheKey, promise);
        }

        promise
            .then((nextState) => {
                if (active && nextState) {
                    setState(nextState);
                }
            })
            .catch((error) => {
                if (
                    !active ||
                    effectGeneration !==
                        getFavoriteRemoteDetailsCacheGeneration()
                ) {
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
    }, [
        cacheKey,
        enabled,
        endpoint,
        normalizedIds,
        normalizedTags,
        refreshToken,
        type
    ]);

    return state;
}
