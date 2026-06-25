import { commands } from '@/platform/tauri/bindings';

interface LocalModerationRow {
    userId?: unknown;
    updatedAt?: unknown;
    displayName?: unknown;
    block?: unknown;
    mute?: unknown;
}

interface LocalModerationQueryInput {
    ownerUserId?: unknown;
    userId?: unknown;
}

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

async function getAllLocalModerations(ownerUserId: unknown) {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    if (!normalizedOwnerUserId) {
        return [];
    }

    const rows = (await commands.appLocalModerationList(
        normalizedOwnerUserId
    )) as LocalModerationRow[];
    return Array.isArray(rows)
        ? rows.map((row) => ({
              userId: row.userId,
              updatedAt: row.updatedAt,
              displayName: row.displayName,
              block: Boolean(row.block),
              mute: Boolean(row.mute)
          }))
        : [];
}

async function getLocalModerationRow(ownerUserId: unknown, userId: unknown) {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedOwnerUserId || !normalizedUserId) {
        return {};
    }

    const row = (await commands.appLocalModerationGet(
        normalizedOwnerUserId,
        normalizedUserId
    )) as LocalModerationRow | null;
    if (!row) {
        return {};
    }
    return {
        userId: row.userId,
        updatedAt: row.updatedAt,
        displayName: row.displayName,
        block: Boolean(row.block),
        mute: Boolean(row.mute)
    };
}

async function getLocalModeration({
    ownerUserId = '',
    userId
}: LocalModerationQueryInput = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return {
            userId: '',
            block: false,
            mute: false
        };
    }

    const row = await getLocalModerationRow(ownerUserId, normalizedUserId);
    return {
        userId: normalizedUserId,
        block: Boolean(row?.block),
        mute: Boolean(row?.mute)
    };
}

const vrchatModerationRepository = Object.freeze({
    getAllLocalModerations,
    getLocalModeration
});

export { getAllLocalModerations, getLocalModeration };
export default vrchatModerationRepository;
