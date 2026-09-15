import { commands } from '@/platform/tauri/bindings';
import type {
    AvatarTagInput,
    AvatarTagsPatchInput,
    JsonValue
} from '@/platform/tauri/bindings';

interface AvatarTag {
    tag?: string;
    color?: JsonValue;
}

function normalizeAvatarTagInput(entry: AvatarTag): AvatarTagInput {
    return {
        tag: entry.tag?.trim() ?? '',
        color: entry.color ?? null
    };
}

async function addAvatarTimeSpent(
    userId: string,
    avatarId: string,
    timeSpent: number
) {
    const normalizedUserId = userId.trim();
    const normalizedAvatarId = avatarId.trim();
    const normalizedTimeSpent = Number.isFinite(timeSpent)
        ? Math.trunc(timeSpent)
        : 0;
    if (!normalizedUserId || !normalizedAvatarId) {
        return;
    }

    await commands.appAvatarTimeSpentAdd(
        normalizedUserId,
        normalizedAvatarId,
        normalizedTimeSpent
    );
}

async function getAvatarTimeSpent(userId: string, avatarId: string) {
    const normalizedUserId = userId.trim();
    const normalizedAvatarId = avatarId.trim();
    const ref = {
        timeSpent: 0,
        avatarId: normalizedAvatarId
    };
    if (!normalizedUserId || !normalizedAvatarId) {
        return ref;
    }

    const row = await commands.appAvatarTimeSpentGet(
        normalizedUserId,
        normalizedAvatarId
    );
    ref.timeSpent = row.timeSpent;
    return ref;
}

async function getAllAvatarTimeSpent(userId: string) {
    const map = new Map<string, number>();
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
        return map;
    }

    const rows = await commands.appAvatarTimeSpentList(normalizedUserId);
    for (const row of rows) {
        const avatarId = row.avatarId;
        if (avatarId) {
            map.set(avatarId, row.timeSpent);
        }
    }
    return map;
}

async function getAvatarHistory(userId: string, limit = 100) {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
        return [];
    }

    const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 100;
    return commands.appAvatarHistoryList(
        normalizedUserId,
        normalizedLimit || 100
    );
}

async function clearAvatarHistory(userId: string) {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
        return;
    }
    await commands.appAvatarHistoryClear(normalizedUserId);
}

async function getAvatarTags(avatarId: string) {
    const normalizedAvatarId = avatarId.trim();
    if (!normalizedAvatarId) {
        return [];
    }
    const rows = await commands.appAvatarTagsGet(normalizedAvatarId);
    return rows.map((row) => ({
        tag: row.tag,
        color: row.color || null
    }));
}

async function getAllAvatarTags() {
    const map = new Map<string, AvatarTag[]>();
    const rows = await commands.appAvatarTagsList();
    for (const row of rows) {
        const avatarId = row.avatarId;
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
    return commands.appAvatarTagsDistinct();
}

async function addAvatarTag(
    avatarId: string,
    tag: string,
    color: JsonValue = null
) {
    await commands.appAvatarTagAdd(avatarId.trim(), tag, color);
}

async function updateAvatarTagColor(
    avatarId: string,
    tag: string,
    color: JsonValue
) {
    await commands.appAvatarTagUpdateColor(avatarId.trim(), tag, color);
}

async function removeAvatarTag(avatarId: string, tag: string) {
    await commands.appAvatarTagRemove(avatarId.trim(), tag);
}

async function removeAllAvatarTags(avatarId: string) {
    await commands.appAvatarTagsRemoveAll(avatarId.trim());
}

async function replaceAvatarTags(avatarId: string, entries: AvatarTag[] = []) {
    await commands.appAvatarTagsReplace(
        avatarId.trim(),
        entries.map(normalizeAvatarTagInput)
    );
}

async function patchAvatarTags(
    avatarId: string,
    previousEntries: AvatarTag[] = [],
    nextEntries: AvatarTag[] = []
) {
    const patch: AvatarTagsPatchInput = {
        previousEntries: previousEntries.map(normalizeAvatarTagInput),
        nextEntries: nextEntries.map(normalizeAvatarTagInput)
    };
    await commands.appAvatarTagsPatch(avatarId.trim(), patch);
}

const avatarLocalRepository = Object.freeze({
    addAvatarTag,
    addAvatarTimeSpent,
    clearAvatarHistory,
    getAllAvatarTags,
    getAllAvatarTimeSpent,
    getAllDistinctTags,
    getAvatarHistory,
    getAvatarTags,
    getAvatarTimeSpent,
    removeAllAvatarTags,
    removeAvatarTag,
    patchAvatarTags,
    replaceAvatarTags,
    updateAvatarTagColor
});

export default avatarLocalRepository;
