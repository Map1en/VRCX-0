import { useEffect, useMemo, useState } from 'react';

import vrchatFavoriteRepository from '@/repositories/vrchatFavoriteRepository';
import {
    deleteFavoriteRemoteDetailsPromise,
    getFavoriteRemoteDetailsCache,
    getFavoriteRemoteDetailsCacheGeneration,
    getFavoriteRemoteDetailsPromise,
    setFavoriteRemoteDetailsCache,
    setFavoriteRemoteDetailsPromise
} from '@/services/favoriteRemoteDetailsCacheService';
import { persistWorldDetailsById } from '@/services/favoriteWorldCacheService';
import { useRuntimeStore } from '@/state/runtimeStore';

function normalizeValues(values: any) {
    return Array.from(
        new Set(
            (Array.isArray(values) ? values : [])
                .map((value: any) =>
                    typeof value === 'string'
                        ? value.trim()
                        : String(value ?? '').trim()
                )
                .filter(Boolean)
        )
    );
}

function buildCacheKey(type: any, endpoint: any, idsKey: any, tagsKey: any) {
    return [type, endpoint || '', idsKey || '', tagsKey || ''].join('::');
}

interface RemoteDetailsState {
    status: string;
    detail: string;
    data: Record<string, unknown>;
    lastLoadedAt: string | null;
}

function isRemoteDetailsState(value: unknown): value is RemoteDetailsState {
    return Boolean(
        value &&
        typeof value === 'object' &&
        typeof Reflect.get(value, 'status') === 'string' &&
        typeof Reflect.get(value, 'detail') === 'string'
    );
}

function getCachedRemoteDetailsState(cacheKey: unknown) {
    const cachedState = getFavoriteRemoteDetailsCache(cacheKey);
    return isRemoteDetailsState(cachedState) ? cachedState : null;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return Boolean(
        value &&
        typeof value === 'object' &&
        typeof Reflect.get(value, 'then') === 'function'
    );
}

function buildInitialState(
    status: string = 'idle',
    detail: string = ''
): RemoteDetailsState {
    return {
        status,
        detail,
        data: {},
        lastLoadedAt: null
    };
}

function mapEntitiesById(items: any): Record<string, unknown> {
    const byId: Record<string, unknown> = {};
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

async function loadRemoteDetails(type: any, endpoint: any, tags: any) {
    if (type === 'avatar') {
        const avatars = await vrchatFavoriteRepository.getAllFavoriteAvatars({
            endpoint,
            tags
        });
        return mapEntitiesById(
            avatars.filter((avatar: any) => avatar?.releaseStatus !== 'hidden')
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
}: any) {
    const endpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
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
        () => getCachedRemoteDetailsState(cacheKey) ?? buildInitialState()
    );

    useEffect(() => {
        const cachedState = getCachedRemoteDetailsState(cacheKey);
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

        const cachedState = getCachedRemoteDetailsState(cacheKey);
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
        if (!isPromiseLike(promise)) {
            const promiseGeneration = getFavoriteRemoteDetailsCacheGeneration();
            promise = loadRemoteDetails(type, endpoint, normalizedTags)
                .then((data: any) => {
                    if (
                        promiseGeneration !==
                        getFavoriteRemoteDetailsCacheGeneration()
                    ) {
                        return null;
                    }
                    const filtered: Record<string, unknown> = {};
                    for (const favoriteId of normalizedIds) {
                        if (data[favoriteId]) {
                            filtered[favoriteId] = data[favoriteId];
                        }
                    }
                    if (type === 'world') {
                        persistWorldDetailsById(filtered);
                    }

                    const nextState: RemoteDetailsState = {
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

        Promise.resolve(promise)
            .then((nextState: unknown) => {
                if (active && isRemoteDetailsState(nextState)) {
                    setState(nextState);
                }
            })
            .catch((error: any) => {
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
