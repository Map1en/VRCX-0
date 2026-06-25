import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';

import avatarCacheRepository from './avatarCacheRepository';
import userSessionRepository from './userSessionRepository';
import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    unwrapErrorMessage
} from './vrchatRequest';

const PAGE_SIZE = 50;
const MAX_OFFSET = 5000;

type AvatarRecord = Record<string, unknown>;
type VrchatApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
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
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const requestError = createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage: 'VRChat avatar request failed'
            }),
            response.status,
            path,
            json
        );
        notifyVrchatAuthFailure(requestError);
        throw requestError;
    }

    return {
        json: json as TJson,
        status: response.status,
        raw: response.raw
    };
}

interface AvatarRequestOptions {
    endpoint?: string;
}

interface AvatarPageOptions extends AvatarRequestOptions {
    offset?: number;
    n?: number;
}

interface AvatarByIdOptions extends AvatarRequestOptions {
    avatarId?: unknown;
}

interface MyAvatarsOptions extends AvatarRequestOptions {
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

interface SaveAvatarInput extends AvatarRequestOptions {
    avatarId?: unknown;
    params?: Record<string, unknown>;
}

interface AvatarIdInput extends AvatarRequestOptions {
    avatarId?: unknown;
}

interface AvatarStylesInput extends AvatarRequestOptions {
    force?: boolean;
}

async function getAvatarsPage({
    endpoint = '',
    offset = 0,
    n = PAGE_SIZE
}: AvatarPageOptions = {}) {
    return unwrapVrchatAvatarResponse<AvatarRecord[]>(
        await commands.appVrchatAvatarListByUserGet({
            endpoint,
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

async function getMyAvatarById({
    avatarId,
    endpoint = ''
}: AvatarByIdOptions = {}) {
    const normalizedAvatarId = avatarIdFromValue(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'MyAvatarRepository.getMyAvatarById requires an avatar id.'
        );
    }

    for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
        const response = await getAvatarsPage({
            endpoint,
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
    endpoint = '',
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
            endpoint,
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
        const nextAvatar: MyAvatarRecord = {
            ...avatar,
            $tags: (tagsMap.get(avatar.id) || [])
                .map(normalizeAvatarTagEntry)
                .filter((entry): entry is AvatarTagEntry => Boolean(entry)),
            $timeSpent: avatarTimeSpentMap.get(avatar.id) || 0
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

async function saveAvatar({
    avatarId,
    endpoint = '',
    params = {}
}: SaveAvatarInput) {
    const normalizedAvatarId =
        typeof avatarId === 'string' ? avatarId.trim() : '';
    if (!normalizedAvatarId) {
        throw new Error('MyAvatarRepository.saveAvatar requires an avatar id.');
    }

    const response = unwrapVrchatAvatarResponse<AvatarRecord>(
        await commands.appVrchatAvatarSave({
            avatarId: normalizedAvatarId,
            endpoint,
            params: {
                id: normalizedAvatarId,
                ...params
            }
        }),
        `avatars/${encodeURIComponent(normalizedAvatarId)}`
    );

    return response.json;
}

async function createImpostor({ avatarId, endpoint = '' }: AvatarIdInput = {}) {
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
            endpoint,
            emptyBody: false
        }),
        `avatars/${encodeURIComponent(normalizedAvatarId)}/impostor/enqueue`
    );

    return response.json;
}

async function getAvailableAvatarStyles({
    endpoint = '',
    force = false
}: AvatarStylesInput = {}) {
    return fetchCachedData({
        queryKey: queryKeys.avatarStyles(endpoint),
        policy: entityQueryPolicies.avatarStyles,
        force,
        queryFn: async () => {
            const response = unwrapVrchatAvatarResponse(
                await commands.appVrchatAvatarStylesGet({ endpoint }),
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
