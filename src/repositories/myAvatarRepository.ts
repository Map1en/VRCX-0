import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import {
    commands,
    type AvatarUpdateRequest,
    type HttpApiExecuteResponse
} from '@/platform/tauri/bindings';
import { isRecord } from '@/shared/utils/record';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import avatarLocalRepository from './avatarLocalRepository';
import type { AvatarStyleRecord } from './avatarProfileRepository';
import { unwrapVrchatResponse } from './vrchatRequest';

type AvatarRecord = Record<string, unknown>;
type VrchatApiResult = HttpApiExecuteResponse;

function unwrapVrchatAvatarResponse<TJson = unknown>(
    response: VrchatApiResult,
    path: string
) {
    return unwrapVrchatResponse<TJson>(response, path, {
        fallbackMessage: 'VRChat avatar request failed'
    });
}

interface AvatarByIdOptions {
    avatarId?: string;
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
    id: string;
    name?: string;
    $tags: AvatarTagEntry[];
    $timeSpent: number;
};

interface UpdateAvatarTagsInput {
    avatarId?: string;
    previousTags?: AvatarTagEntry[];
    nextTags?: AvatarTagEntry[];
}

interface SaveAvatarInput {
    avatarId?: string;
    params?: Omit<AvatarUpdateRequest, 'id'>;
}

interface AvatarIdInput {
    avatarId?: string;
}

interface AvatarStylesInput {
    force?: boolean;
}

function avatarIdFromValue(value?: string): string {
    return value?.trim() ?? '';
}

async function getMyAvatarById({ avatarId }: AvatarByIdOptions = {}) {
    const normalizedAvatarId = avatarIdFromValue(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'MyAvatarRepository.getMyAvatarById requires an avatar id.'
        );
    }

    const avatar = await commands.appMyAvatarByIdGet({
        avatarId: normalizedAvatarId
    });
    return isRecord(avatar) ? avatar : null;
}

async function getMyAvatars({
    currentAvatarId = '',
    previousAvatarSwapTime = 0
}: MyAvatarsOptions = {}) {
    const avatars = await commands.appMyAvatarsGet({
        currentAvatarId,
        previousAvatarSwapTime: Number.isFinite(previousAvatarSwapTime)
            ? previousAvatarSwapTime
            : 0
    });
    return (Array.isArray(avatars) ? avatars : []).filter(
        (avatar): avatar is MyAvatarRecord => isRecord(avatar)
    );
}

async function updateAvatarTags({
    avatarId,
    previousTags = [],
    nextTags = []
}: UpdateAvatarTagsInput) {
    const normalizedAvatarId = avatarId?.trim() ?? '';
    if (!normalizedAvatarId) {
        throw new Error(
            'MyAvatarRepository.updateAvatarTags requires an avatar id.'
        );
    }

    const previousMap = new Map(
        previousTags
            .filter((entry) => Boolean(entry.tag.trim()))
            .map((entry) => [
                entry.tag.trim(),
                { tag: entry.tag.trim(), color: entry.color || null }
            ])
    );
    const nextMap = new Map(
        nextTags
            .filter((entry) => Boolean(entry.tag.trim()))
            .map((entry) => [
                entry.tag.trim(),
                { tag: entry.tag.trim(), color: entry.color || null }
            ])
    );

    const nextEntries = Array.from(nextMap.values());
    const previousEntries = Array.from(previousMap.values());
    if (JSON.stringify(previousEntries) !== JSON.stringify(nextEntries)) {
        await avatarLocalRepository.patchAvatarTags(
            normalizedAvatarId,
            previousEntries,
            nextEntries
        );
    }

    return nextEntries;
}

async function saveAvatar({ avatarId, params = {} }: SaveAvatarInput) {
    const normalizedAvatarId = avatarId?.trim() ?? '';
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
    const normalizedAvatarId = avatarId?.trim() ?? '';
    if (!normalizedAvatarId) {
        throw new Error(
            'MyAvatarRepository.createImpostor requires an avatar id.'
        );
    }

    const response = unwrapVrchatAvatarResponse(
        await commands.appVrchatAvatarImpostorCreate({
            avatarId: normalizedAvatarId
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
    getMyAvatarById,
    getMyAvatars,
    updateAvatarTags,
    saveAvatar,
    createImpostor,
    getAvailableAvatarStyles
});

export default myAvatarRepository;
