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

export function getFavoriteRemoteDetailsCacheGeneration() {
    return detailCacheGeneration;
}

export function getFavoriteRemoteDetailsCache(cacheKey) {
    return detailCache.get(cacheKey);
}

export function setFavoriteRemoteDetailsCache(cacheKey, state) {
    detailCache.set(cacheKey, state);
}

export function getFavoriteRemoteDetailsPromise(cacheKey) {
    return detailPromises.get(cacheKey);
}

export function setFavoriteRemoteDetailsPromise(cacheKey, promise) {
    detailPromises.set(cacheKey, promise);
}

export function deleteFavoriteRemoteDetailsPromise(cacheKey) {
    detailPromises.delete(cacheKey);
}
