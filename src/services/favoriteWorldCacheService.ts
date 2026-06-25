import favoritePersistenceRepository, {
    type FavoriteCacheEntity
} from '@/repositories/favoritePersistenceRepository';
import { useFavoriteStore } from '@/state/favoriteStore';

function normalizeEntityId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeString(value: unknown) {
    return typeof value === 'string' ? value : String(value ?? '');
}

function canPersistWorldSnapshot(world: any) {
    const releaseStatus = normalizeEntityId(world?.releaseStatus).toLowerCase();
    if (releaseStatus !== 'public') {
        return false;
    }

    const name = normalizeString(world?.name).trim();
    const imageUrl =
        normalizeString(world?.thumbnailImageUrl).trim() ||
        normalizeString(world?.imageUrl).trim();
    return Boolean(name && imageUrl);
}

function buildWorldCacheEntry(
    world: any,
    fallbackWorldId?: unknown
): FavoriteCacheEntity | null {
    if (!world || typeof world !== 'object') {
        return null;
    }

    const id =
        normalizeEntityId(world.id) || normalizeEntityId(fallbackWorldId);
    if (!id) {
        return null;
    }

    if (!canPersistWorldSnapshot(world)) {
        return null;
    }

    return {
        id,
        authorId: normalizeEntityId(world.authorId),
        authorName: normalizeString(world.authorName),
        created_at: normalizeString(world.created_at ?? world.createdAt),
        description: normalizeString(world.description),
        imageUrl: normalizeString(world.imageUrl),
        name: normalizeString(world.name),
        releaseStatus: normalizeString(world.releaseStatus),
        thumbnailImageUrl: normalizeString(world.thumbnailImageUrl),
        updated_at: normalizeString(world.updated_at ?? world.updatedAt),
        version: Number(world.version) || 0
    };
}

export async function cacheWorldDetails(world: any, fallbackWorldId?: unknown) {
    const entry = buildWorldCacheEntry(world, fallbackWorldId);
    if (!entry) {
        return false;
    }

    await favoritePersistenceRepository.addWorldToCache(entry);
    return true;
}

export async function cacheWorldDetailsById(worldsById: any) {
    await Promise.all(
        Object.entries(worldsById || {}).map(([worldId, world]) =>
            cacheWorldDetails(world, worldId)
        )
    );
}

function isFavoriteWorldId(id: string) {
    const state = useFavoriteStore.getState();
    return (
        state.favoriteWorldIds.includes(id) ||
        state.localWorldFavoritesList.includes(id)
    );
}

export async function cacheFavoriteWorldDetails(world: any) {
    const id = normalizeEntityId(world?.id);
    if (!id) {
        return false;
    }

    if (!isFavoriteWorldId(id)) {
        return false;
    }

    return cacheWorldDetails(world);
}

function reportWorldCacheError(error: unknown) {
    console.warn('Failed to cache favorite world details:', error);
}

export function persistWorldDetails(world: any, fallbackWorldId?: unknown) {
    void cacheWorldDetails(world, fallbackWorldId).catch(reportWorldCacheError);
}

export function persistWorldDetailsById(worldsById: any) {
    void cacheWorldDetailsById(worldsById).catch(reportWorldCacheError);
}

export function persistFavoriteWorldDetails(world: any) {
    void cacheFavoriteWorldDetails(world).catch(reportWorldCacheError);
}
