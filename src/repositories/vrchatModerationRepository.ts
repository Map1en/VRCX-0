import {
    commands,
    type LocalModerationOutput
} from '@/platform/tauri/bindings';

interface LocalModerationQueryInput {
    ownerUserId?: string;
    userId?: string;
}

function normalizeUserId(value?: string): string {
    return value?.trim() ?? '';
}

async function getAllLocalModerations(ownerUserId: string) {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    if (!normalizedOwnerUserId) {
        return [];
    }

    const rows = await commands.appLocalModerationList(normalizedOwnerUserId);
    return rows.map((row) => ({
        userId: row.userId,
        updatedAt: row.updatedAt,
        displayName: row.displayName,
        block: row.block,
        mute: row.mute
    }));
}

async function getLocalModerationRow(
    ownerUserId: string,
    userId: string
): Promise<LocalModerationOutput | null> {
    const normalizedOwnerUserId = normalizeUserId(ownerUserId);
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedOwnerUserId || !normalizedUserId) {
        return null;
    }

    const row = await commands.appLocalModerationGet(
        normalizedOwnerUserId,
        normalizedUserId
    );
    if (!row) {
        return null;
    }
    return row;
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
        block: row?.block ?? false,
        mute: row?.mute ?? false
    };
}

const vrchatModerationRepository = Object.freeze({
    getAllLocalModerations,
    getLocalModeration
});

export default vrchatModerationRepository;
