type FavoriteRemoteDetailsCacheStats = {
    detailCacheCount: number;
    detailPromiseCount: number;
};

const detailCache = new Map<unknown, unknown>();
const detailPromises = new Map<unknown, unknown>();

let detailCacheGeneration = 0;

export function clearFavoriteRemoteDetailsCache(): FavoriteRemoteDetailsCacheStats {
    const result: any = {
        detailCacheCount: detailCache.size,
        detailPromiseCount: detailPromises.size
    };
    detailCacheGeneration += 1;
    detailCache.clear();
    detailPromises.clear();
    return result;
}

export function invalidateFavoriteRemoteDetailsCacheForType(
    type: 'avatar' | 'world'
): FavoriteRemoteDetailsCacheStats {
    const prefix = `${type}::`;
    let detailCacheCount = 0;
    let detailPromiseCount = 0;
    for (const cacheKey of detailCache.keys()) {
        if (typeof cacheKey === 'string' && cacheKey.startsWith(prefix)) {
            detailCache.delete(cacheKey);
            detailCacheCount += 1;
        }
    }
    for (const cacheKey of detailPromises.keys()) {
        if (typeof cacheKey === 'string' && cacheKey.startsWith(prefix)) {
            detailPromises.delete(cacheKey);
            detailPromiseCount += 1;
        }
    }
    detailCacheGeneration += 1;
    return { detailCacheCount, detailPromiseCount };
}

export function getFavoriteRemoteDetailsCacheStats(): FavoriteRemoteDetailsCacheStats {
    return {
        detailCacheCount: detailCache.size,
        detailPromiseCount: detailPromises.size
    };
}

export function getFavoriteRemoteDetailsCacheGeneration(): number {
    return detailCacheGeneration;
}

export function getFavoriteRemoteDetailsCache(cacheKey: unknown): unknown {
    return detailCache.get(cacheKey);
}

export function setFavoriteRemoteDetailsCache(
    cacheKey: unknown,
    state: unknown
): void {
    detailCache.set(cacheKey, state);
}

export function getFavoriteRemoteDetailsPromise(cacheKey: unknown): unknown {
    return detailPromises.get(cacheKey);
}

export function setFavoriteRemoteDetailsPromise(
    cacheKey: unknown,
    promise: unknown
): void {
    detailPromises.set(cacheKey, promise);
}

export function deleteFavoriteRemoteDetailsPromise(cacheKey: unknown): void {
    detailPromises.delete(cacheKey);
}
