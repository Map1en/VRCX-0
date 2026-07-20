import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import avatarCacheRepository from './avatarCacheRepository';
import type { AvatarStyleRecord } from './avatarProfileRepository';
import userSessionRepository from './userSessionRepository';
import { unwrapVrchatResponse } from './vrchatRequest';

const PAGE_SIZE = 50;
const MAX_OFFSET = 5000;

type AvatarRecord = Record<string, unknown>;
type VrchatApiResult = {
    status: number;
    data: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeAvatarTagEntry(entry: unknown): AvatarTagEntry | null {
    if (!isRecord(entry) || typeof entry.tag !== 'string') {
        return null;
    }

    const tag = entry.tag.trim();
    if (!tag) {
        return null;
    }

    return {
        tag,
        color: typeof entry.color === 'string' ? entry.color : null
    };
}

function unwrapVrchatAvatarResponse<TJson = unknown>(
    response: VrchatApiResult,
    path: string
) {
    return unwrapVrchatResponse<TJson>(response, path, {
        fallbackMessage: 'VRChat avatar request failed'
    });
}

interface AvatarPageOptions {
    offset?: number;
    n?: number;
}

interface AvatarByIdOptions {
    avatarId?: unknown;
}

interface MyAvatarsOptions {
    currentUserId?: string;
    currentAvatarId?: string;
    previousAvatarSwapTime?: number;
}

interface AvatarTagEntry {
    tag: string;
    color?: string | null;
}

type MyAvatarRecord = AvatarRecord & {
    $tags: AvatarTagEntry[];
    $timeSpent: number;
};

interface UpdateAvatarTagsInput {
    avatarId?: unknown;
    previousTags?: AvatarTagEntry[];
    nextTags?: AvatarTagEntry[];
}

interface SaveAvatarInput {
    avatarId?: unknown;
    params?: Record<string, unknown>;
}

interface AvatarIdInput {
    avatarId?: unknown;
}

interface AvatarStylesInput {
    force?: boolean;
}

async function getAvatarsPage({
    offset = 0,
    n = PAGE_SIZE
}: AvatarPageOptions = {}) {
    return unwrapVrchatAvatarResponse<AvatarRecord[]>(
        await commands.appVrchatAvatarListByUserGet({
            user: 'me',
            n,
            offset,
            sort: 'updated',
            order: 'descending',
            releaseStatus: 'all'
        }),
        'avatars'
    );
}

function avatarIdFromValue(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

async function getMyAvatarById({ avatarId }: AvatarByIdOptions = {}) {
    const normalizedAvatarId = avatarIdFromValue(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'MyAvatarRepository.getMyAvatarById requires an avatar id.'
        );
    }

    for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
        const response = await getAvatarsPage({
            offset,
            n: PAGE_SIZE
        });
        const page = Array.isArray(response.json) ? response.json : [];
        const match = page.find(
            (avatar) => avatarIdFromValue(avatar?.id) === normalizedAvatarId
        );
        if (match) {
            return match;
        }

        if (page.length < PAGE_SIZE) {
            break;
        }
    }

    return null;
}

async function getMyAvatars({
    currentUserId = '',
    currentAvatarId = '',
    previousAvatarSwapTime = 0
}: MyAvatarsOptions = {}) {
    const avatars: AvatarRecord[] = [];

    if (currentUserId) {
        await userSessionRepository.ensureUserTables(currentUserId);
    }

    for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
        const response = await getAvatarsPage({
            offset,
            n: PAGE_SIZE
        });
        const page = Array.isArray(response.json) ? response.json : [];
        avatars.push(...page);

        if (page.length < PAGE_SIZE) {
            break;
        }
    }

    const [tagsMap, avatarTimeSpentMap] = await Promise.all([
        avatarCacheRepository.getAllAvatarTags(),
        currentUserId
            ? avatarCacheRepository.getAllAvatarTimeSpent(currentUserId)
            : Promise.resolve(new Map())
    ]);

    return avatars.map((avatar: AvatarRecord) => {
        const avatarId = normalizeString(avatar.id);
        const nextAvatar: MyAvatarRecord = {
            ...avatar,
            $tags: (tagsMap.get(avatarId) || [])
                .map(normalizeAvatarTagEntry)
                .filter((entry): entry is AvatarTagEntry => Boolean(entry)),
            $timeSpent: avatarTimeSpentMap.get(avatarId) || 0
        };

        if (
            currentAvatarId &&
            avatar.id === currentAvatarId &&
            Number.isFinite(previousAvatarSwapTime) &&
            previousAvatarSwapTime > 0
        ) {
            nextAvatar.$timeSpent += Date.now() - previousAvatarSwapTime;
        }

        return nextAvatar;
    });
}

async function updateAvatarTags({
    avatarId,
    previousTags = [],
    nextTags = []
}: UpdateAvatarTagsInput) {
    const normalizedAvatarId =
        typeof avatarId === 'string' ? avatarId.trim() : '';
    if (!normalizedAvatarId) {
        throw new Error(
            'MyAvatarRepository.updateAvatarTags requires an avatar id.'
        );
    }

    const previousMap = new Map(
        (Array.isArray(previousTags) ? previousTags : [])
            .filter(
                (entry): entry is AvatarTagEntry =>
                    typeof entry?.tag === 'string' && Boolean(entry.tag.trim())
            )
            .map((entry) => [
                entry.tag.trim(),
                { tag: entry.tag.trim(), color: entry.color || null }
            ])
    );
    const nextMap = new Map(
        (Array.isArray(nextTags) ? nextTags : [])
            .filter(
                (entry): entry is AvatarTagEntry =>
                    typeof entry?.tag === 'string' && Boolean(entry.tag.trim())
            )
            .map((entry) => [
                entry.tag.trim(),
                { tag: entry.tag.trim(), color: entry.color || null }
            ])
    );

    const nextEntries = Array.from(nextMap.values());
    const previousEntries = Array.from(previousMap.values());
    if (JSON.stringify(previousEntries) !== JSON.stringify(nextEntries)) {
        await avatarCacheRepository.patchAvatarTags(
            normalizedAvatarId,
            previousEntries,
            nextEntries
        );
    }

    return nextEntries;
}

async function saveAvatar({ avatarId, params = {} }: SaveAvatarInput) {
    const normalizedAvatarId =
        typeof avatarId === 'string' ? avatarId.trim() : '';
    if (!normalizedAvatarId) {
        throw new Error('MyAvatarRepository.saveAvatar requires an avatar id.');
    }

    const response = unwrapVrchatAvatarResponse<AvatarRecord>(
        await commands.appVrchatAvatarSave({
            avatarId: normalizedAvatarId,
            params: {
                id: normalizedAvatarId,
                ...params
            }
        }),
        `avatars/${encodeURIComponent(normalizedAvatarId)}`
    );

    return response.json;
}

async function createImpostor({ avatarId }: AvatarIdInput = {}) {
    const normalizedAvatarId =
        typeof avatarId === 'string' ? avatarId.trim() : '';
    if (!normalizedAvatarId) {
        throw new Error(
            'MyAvatarRepository.createImpostor requires an avatar id.'
        );
    }

    const response = unwrapVrchatAvatarResponse(
        await commands.appVrchatAvatarImpostorCreate({
            avatarId: normalizedAvatarId,
            emptyBody: false
        }),
        `avatars/${encodeURIComponent(normalizedAvatarId)}/impostor/enqueue`
    );

    return response.json;
}

async function getAvailableAvatarStyles({
    force = false
}: AvatarStylesInput = {}): Promise<AvatarStyleRecord[]> {
    return fetchCachedData({
        queryKey: queryKeys.avatarStyles(DEFAULT_VRCHAT_API_ENDPOINT),
        policy: entityQueryPolicies.avatarStyles,
        force,
        queryFn: async () => {
            const response = unwrapVrchatAvatarResponse<AvatarStyleRecord[]>(
                await commands.appVrchatAvatarStylesGet(),
                'avatarStyles'
            );
            return Array.isArray(response.json) ? response.json : [];
        }
    });
}

const myAvatarRepository = Object.freeze({
    getAvatarsPage,
    getMyAvatarById,
    getMyAvatars,
    updateAvatarTags,
    saveAvatar,
    createImpostor,
    getAvailableAvatarStyles
});

export {
    getAvatarsPage,
    getMyAvatarById,
    getMyAvatars,
    updateAvatarTags,
    saveAvatar,
    createImpostor,
    getAvailableAvatarStyles
};
export default myAvatarRepository;
