import { backend } from '@/platform/index.js';

type ObjectRow = Record<string, unknown>;

interface AvatarCacheInput {
    id?: unknown;
    authorId?: unknown;
    authorName?: unknown;
    created_at?: unknown;
    description?: unknown;
    imageUrl?: unknown;
    name?: unknown;
    releaseStatus?: unknown;
    thumbnailImageUrl?: unknown;
    updated_at?: unknown;
    version?: unknown;
}

interface AvatarTag {
    tag: unknown;
    color: unknown;
}

function asObjectRow(row: ObjectRow | unknown[] | null | undefined): ObjectRow {
    return row && !Array.isArray(row) ? row : {};
}

function normalizeId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function parseInteger(value: unknown, fallback: number) {
    return Number.parseInt((value ?? fallback) as string, 10) || fallback;
}

function normalizeAvatarCacheRow(row: ObjectRow | unknown[] | null | undefined) {
    if (Array.isArray(row)) {
        return {
            id: row[0] ?? '',
            authorId: row[2] ?? '',
            authorName: row[3] ?? '',
            created_at: row[4] ?? '',
            description: row[5] ?? '',
            imageUrl: row[6] ?? '',
            name: row[7] ?? '',
            releaseStatus: row[8] ?? '',
            thumbnailImageUrl: row[9] ?? '',
            updated_at: row[10] ?? '',
            version: row[11] ?? 0
        };
    }

    const record = asObjectRow(row);
    return {
        id: record.id ?? '',
        authorId: record.author_id ?? record.authorId ?? '',
        authorName: record.author_name ?? record.authorName ?? '',
        created_at: record.created_at ?? '',
        description: record.description ?? '',
        imageUrl: record.image_url ?? record.imageUrl ?? '',
        name: record.name ?? '',
        releaseStatus: record.release_status ?? record.releaseStatus ?? '',
        thumbnailImageUrl:
            record.thumbnail_image_url ?? record.thumbnailImageUrl ?? '',
        updated_at: record.updated_at ?? '',
        version: record.version ?? 0
    };
}

async function addAvatarToCache(entry: AvatarCacheInput) {
    return backend.app.AvatarCacheUpsert({
        entry: {
            id: entry.id,
            authorId: entry.authorId,
            authorName: entry.authorName,
            createdAt: entry.created_at,
            description: entry.description,
            imageUrl: entry.imageUrl,
            name: entry.name,
            releaseStatus: entry.releaseStatus,
            thumbnailImageUrl: entry.thumbnailImageUrl,
            updatedAt: entry.updated_at,
            version: entry.version
        }
    });
}

async function getCachedAvatarById(id: unknown) {
    const normalizedId = normalizeId(id);
    if (!normalizedId) {
        return null;
    }

    const row = (await backend.app.AvatarCacheGet({
        avatarId: normalizedId
    })) as ObjectRow | null;
    return row ? normalizeAvatarCacheRow(row) : null;
}

async function getAvatarCache() {
    const rows = (await backend.app.AvatarCacheList()) as ObjectRow[];
    return Array.isArray(rows) ? rows.map(normalizeAvatarCacheRow) : [];
}

async function removeAvatarFromCache(avatarId: unknown) {
    const normalizedAvatarId = normalizeId(avatarId);
    if (!normalizedAvatarId) {
        return;
    }
    await backend.app.AvatarCacheRemove({ avatarId: normalizedAvatarId });
}

async function addAvatarToHistory(userId: unknown, avatarId: unknown) {
    const normalizedAvatarId = normalizeId(avatarId);
    if (!normalizedAvatarId) {
        return;
    }

    await backend.app.AvatarHistoryAdd({
        userId,
        avatarId: normalizedAvatarId
    });
}

async function addAvatarTimeSpent(
    userId: unknown,
    avatarId: unknown,
    timeSpent: unknown
) {
    const normalizedAvatarId = normalizeId(avatarId);
    const normalizedTimeSpent = parseInteger(timeSpent, 0);
    if (!normalizedAvatarId) {
        return;
    }

    await backend.app.AvatarTimeSpentAdd({
        userId,
        avatarId: normalizedAvatarId,
        timeSpent: normalizedTimeSpent
    });
}

async function getAvatarTimeSpent(userId: unknown, avatarId: unknown) {
    const normalizedAvatarId = normalizeId(avatarId);
    const ref = {
        timeSpent: 0,
        avatarId: normalizedAvatarId
    };
    if (!normalizedAvatarId) {
        return ref;
    }

    const row = (await backend.app.AvatarTimeSpentGet({
        userId,
        avatarId: normalizedAvatarId
    })) as ObjectRow | null;
    ref.timeSpent = parseInteger(row?.timeSpent ?? row?.time_spent, 0);
    return ref;
}

async function getAllAvatarTimeSpent(userId: unknown) {
    const map = new Map<unknown, number>();
    const rows = (await backend.app.AvatarTimeSpentList({ userId })) as
        | ObjectRow[]
        | null;
    for (const row of Array.isArray(rows) ? rows : []) {
        const avatarId = row.avatarId ?? row.avatar_id;
        if (avatarId) {
            map.set(avatarId, parseInteger(row.timeSpent ?? row.time_spent, 0));
        }
    }
    return map;
}

async function getAvatarHistory(userId: unknown, limit: unknown = 100) {
    const rows = (await backend.app.AvatarHistoryList({
        userId: normalizeId(userId),
        limit: parseInteger(limit, 100)
    })) as ObjectRow[];
    return Array.isArray(rows) ? rows.map(normalizeAvatarCacheRow) : [];
}

async function clearAvatarHistory(userId: unknown) {
    await backend.app.AvatarHistoryClear({ userId });
}

async function getAvatarTags(avatarId: unknown) {
    const rows = (await backend.app.AvatarTagsGet({
        avatarId: normalizeId(avatarId)
    })) as ObjectRow[];
    return (Array.isArray(rows) ? rows : []).map((row) => ({
        tag: row.tag,
        color: row.color || null
    }));
}

async function getAllAvatarTags() {
    const map = new Map<unknown, AvatarTag[]>();
    const rows = (await backend.app.AvatarTagsList()) as ObjectRow[];
    for (const row of Array.isArray(rows) ? rows : []) {
        const avatarId = row.avatarId ?? row.avatar_id;
        const tag = row.tag;
        const color = row.color || null;
        if (!map.has(avatarId)) {
            map.set(avatarId, []);
        }
        map.get(avatarId)?.push({ tag, color });
    }
    return map;
}

async function getAllDistinctTags() {
    const tags = (await backend.app.AvatarTagsDistinct()) as unknown[];
    return Array.isArray(tags) ? tags : [];
}

async function addAvatarTag(avatarId: unknown, tag: unknown, color = null) {
    await backend.app.AvatarTagAdd({
        avatarId: normalizeId(avatarId),
        tag,
        color
    });
}

async function updateAvatarTagColor(
    avatarId: unknown,
    tag: unknown,
    color: unknown
) {
    await backend.app.AvatarTagUpdateColor({
        avatarId: normalizeId(avatarId),
        tag,
        color
    });
}

async function removeAvatarTag(avatarId: unknown, tag: unknown) {
    await backend.app.AvatarTagRemove({
        avatarId: normalizeId(avatarId),
        tag
    });
}

async function removeAllAvatarTags(avatarId: unknown) {
    await backend.app.AvatarTagsRemoveAll({
        avatarId: normalizeId(avatarId)
    });
}

async function replaceAvatarTags(avatarId: unknown, entries: AvatarTag[] = []) {
    await backend.app.AvatarTagsReplace({
        avatarId: normalizeId(avatarId),
        entries: Array.isArray(entries) ? entries : []
    });
}

async function patchAvatarTags(
    avatarId: unknown,
    previousEntries: AvatarTag[] = [],
    nextEntries: AvatarTag[] = []
) {
    await backend.app.AvatarTagsPatch({
        avatarId: normalizeId(avatarId),
        patch: {
            previousEntries: Array.isArray(previousEntries)
                ? previousEntries
                : [],
            nextEntries: Array.isArray(nextEntries) ? nextEntries : []
        }
    });
}

const avatarLocalRepository = Object.freeze({
    addAvatarTag,
    addAvatarTimeSpent,
    addAvatarToCache,
    addAvatarToHistory,
    clearAvatarHistory,
    getAllAvatarTags,
    getAllAvatarTimeSpent,
    getAllDistinctTags,
    getAvatarCache,
    getAvatarHistory,
    getAvatarTags,
    getAvatarTimeSpent,
    getCachedAvatarById,
    removeAllAvatarTags,
    removeAvatarFromCache,
    removeAvatarTag,
    patchAvatarTags,
    replaceAvatarTags,
    updateAvatarTagColor
});

export {
    addAvatarTag,
    addAvatarTimeSpent,
    addAvatarToCache,
    addAvatarToHistory,
    clearAvatarHistory,
    getAllAvatarTags,
    getAllAvatarTimeSpent,
    getAllDistinctTags,
    getAvatarCache,
    getAvatarHistory,
    getAvatarTags,
    getAvatarTimeSpent,
    getCachedAvatarById,
    removeAllAvatarTags,
    removeAvatarFromCache,
    removeAvatarTag,
    patchAvatarTags,
    replaceAvatarTags,
    updateAvatarTagColor
};
export default avatarLocalRepository;
