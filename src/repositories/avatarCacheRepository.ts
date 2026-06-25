import { commands } from '@/platform/tauri/bindings';
import type {
    AvatarTagInput,
    AvatarTagsPatchInput
} from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';

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

function parseInteger(value: unknown, fallback: number) {
    return Number.parseInt(String(value ?? fallback), 10) || fallback;
}

function normalizeAvatarCacheRow(
    row: ObjectRow | unknown[] | null | undefined
) {
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
    return commands.appAvatarCacheUpsert({
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
    });
}

async function getCachedAvatarById(id: unknown) {
    const normalizedId = normalizeString(id);
    if (!normalizedId) {
        return null;
    }

    const row = (await commands.appAvatarCacheGet(
        normalizedId
    )) as ObjectRow | null;
    return row ? normalizeAvatarCacheRow(row) : null;
}

async function getAvatarCache() {
    const rows = (await commands.appAvatarCacheList()) as ObjectRow[];
    return Array.isArray(rows) ? rows.map(normalizeAvatarCacheRow) : [];
}

async function removeAvatarFromCache(avatarId: unknown) {
    const normalizedAvatarId = normalizeString(avatarId);
    if (!normalizedAvatarId) {
        return;
    }
    await commands.appAvatarCacheRemove(normalizedAvatarId);
}

async function addAvatarToHistory(userId: unknown, avatarId: unknown) {
    const normalizedAvatarId = normalizeString(avatarId);
    if (!normalizedAvatarId) {
        return;
    }

    await commands.appAvatarHistoryAdd(userId as string, normalizedAvatarId);
}

async function addAvatarTimeSpent(
    userId: unknown,
    avatarId: unknown,
    timeSpent: unknown
) {
    const normalizedAvatarId = normalizeString(avatarId);
    const normalizedTimeSpent = parseInteger(timeSpent, 0);
    if (!normalizedAvatarId) {
        return;
    }

    await commands.appAvatarTimeSpentAdd(
        userId as string,
        normalizedAvatarId,
        normalizedTimeSpent
    );
}

async function getAvatarTimeSpent(userId: unknown, avatarId: unknown) {
    const normalizedAvatarId = normalizeString(avatarId);
    const ref = {
        timeSpent: 0,
        avatarId: normalizedAvatarId
    };
    if (!normalizedAvatarId) {
        return ref;
    }

    const row = (await commands.appAvatarTimeSpentGet(
        userId as string,
        normalizedAvatarId
    )) as ObjectRow | null;
    ref.timeSpent = parseInteger(row?.timeSpent ?? row?.time_spent, 0);
    return ref;
}

async function getAllAvatarTimeSpent(userId: unknown) {
    const map = new Map<unknown, number>();
    const rows = (await commands.appAvatarTimeSpentList(userId as string)) as
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
    const rows = (await commands.appAvatarHistoryList(
        normalizeString(userId),
        parseInteger(limit, 100)
    )) as ObjectRow[];
    return Array.isArray(rows) ? rows.map(normalizeAvatarCacheRow) : [];
}

async function clearAvatarHistory(userId: unknown) {
    await commands.appAvatarHistoryClear(userId as string);
}

async function getAvatarTags(avatarId: unknown) {
    const rows = (await commands.appAvatarTagsGet(
        normalizeString(avatarId)
    )) as ObjectRow[];
    return (Array.isArray(rows) ? rows : []).map((row) => ({
        tag: row.tag,
        color: row.color || null
    }));
}

async function getAllAvatarTags() {
    const map = new Map<unknown, AvatarTag[]>();
    const rows = (await commands.appAvatarTagsList()) as ObjectRow[];
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
    const tags = (await commands.appAvatarTagsDistinct()) as unknown[];
    return Array.isArray(tags) ? tags : [];
}

async function addAvatarTag(
    avatarId: unknown,
    tag: unknown,
    color: unknown = null
) {
    await commands.appAvatarTagAdd(normalizeString(avatarId), tag, color);
}

async function updateAvatarTagColor(
    avatarId: unknown,
    tag: unknown,
    color: unknown
) {
    await commands.appAvatarTagUpdateColor(
        normalizeString(avatarId),
        tag,
        color
    );
}

async function removeAvatarTag(avatarId: unknown, tag: unknown) {
    await commands.appAvatarTagRemove(normalizeString(avatarId), tag);
}

async function removeAllAvatarTags(avatarId: unknown) {
    await commands.appAvatarTagsRemoveAll(normalizeString(avatarId));
}

async function replaceAvatarTags(avatarId: unknown, entries: AvatarTag[] = []) {
    await commands.appAvatarTagsReplace(
        normalizeString(avatarId),
        (Array.isArray(entries) ? entries : []) as AvatarTagInput[]
    );
}

async function patchAvatarTags(
    avatarId: unknown,
    previousEntries: AvatarTag[] = [],
    nextEntries: AvatarTag[] = []
) {
    await commands.appAvatarTagsPatch(normalizeString(avatarId), {
        previousEntries: Array.isArray(previousEntries) ? previousEntries : [],
        nextEntries: Array.isArray(nextEntries) ? nextEntries : []
    } as AvatarTagsPatchInput);
}

const avatarCacheRepository = Object.freeze({
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
export default avatarCacheRepository;
