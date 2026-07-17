import {
    invalidateEntityQueries,
    queryKeys,
    setCachedQueryData
} from '@/lib/entityQueryCache';
import {
    commands,
    type VrchatAvatarImpostorCreateInput,
    type VrchatAvatarSaveInput
} from '@/platform/tauri/bindings';

import {
    avatarIdInput,
    normalizeEntityId,
    unwrapVrchatAvatarResponse
} from './shared';
import type { AvatarIdInput, AvatarRecord, SaveAvatarInput } from './types';

export async function selectAvatar({ avatarId, endpoint = '' }: AvatarIdInput) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.selectAvatar requires an avatar id.'
        );
    }

    const response = unwrapVrchatAvatarResponse<AvatarRecord>(
        await commands.appVrchatAvatarSelect(
            avatarIdInput(normalizedAvatarId, endpoint)
        ),
        `avatars/${encodeURIComponent(normalizedAvatarId)}/select`
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.avatar(normalizedAvatarId, endpoint),
            response.json
        );
    }
    return response;
}

export async function selectFallbackAvatar({
    avatarId,
    endpoint = ''
}: AvatarIdInput) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.selectFallbackAvatar requires an avatar id.'
        );
    }

    const response = unwrapVrchatAvatarResponse<AvatarRecord>(
        await commands.appVrchatAvatarSelectFallback(
            avatarIdInput(normalizedAvatarId, endpoint)
        ),
        `avatars/${encodeURIComponent(normalizedAvatarId)}/selectfallback`
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.avatar(normalizedAvatarId, endpoint),
            response.json
        );
    }
    return response;
}

export async function saveAvatar({
    avatarId,
    params = {},
    endpoint = ''
}: SaveAvatarInput) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.saveAvatar requires an avatar id.'
        );
    }

    const input = {
        avatarId: normalizedAvatarId,
        endpoint,
        params
    } satisfies VrchatAvatarSaveInput;
    const response = unwrapVrchatAvatarResponse<AvatarRecord>(
        await commands.appVrchatAvatarSave(input),
        `avatars/${encodeURIComponent(normalizedAvatarId)}`
    );
    if (response.json && typeof response.json === 'object') {
        setCachedQueryData(
            queryKeys.avatar(normalizedAvatarId, endpoint),
            response.json
        );
    }
    return response;
}

export async function deleteAvatar({ avatarId, endpoint = '' }: AvatarIdInput) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.deleteAvatar requires an avatar id.'
        );
    }

    const response = unwrapVrchatAvatarResponse<AvatarRecord>(
        await commands.appVrchatAvatarDelete(
            avatarIdInput(normalizedAvatarId, endpoint)
        ),
        `avatars/${encodeURIComponent(normalizedAvatarId)}`
    );
    await Promise.allSettled([
        invalidateEntityQueries(queryKeys.avatar(normalizedAvatarId, endpoint)),
        invalidateEntityQueries(
            queryKeys.avatarGallery(normalizedAvatarId, endpoint)
        )
    ]);
    return response;
}

export async function createImposter({
    avatarId,
    endpoint = ''
}: AvatarIdInput) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.createImposter requires an avatar id.'
        );
    }

    const input = {
        avatarId: normalizedAvatarId,
        endpoint,
        emptyBody: true
    } satisfies VrchatAvatarImpostorCreateInput;
    return unwrapVrchatAvatarResponse<AvatarRecord>(
        await commands.appVrchatAvatarImpostorCreate(input),
        `avatars/${encodeURIComponent(normalizedAvatarId)}/impostor/enqueue`
    );
}

export async function deleteImposter({
    avatarId,
    endpoint = ''
}: AvatarIdInput) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.deleteImposter requires an avatar id.'
        );
    }

    return unwrapVrchatAvatarResponse<AvatarRecord>(
        await commands.appVrchatAvatarImpostorDelete(
            avatarIdInput(normalizedAvatarId, endpoint)
        ),
        `avatars/${encodeURIComponent(normalizedAvatarId)}/impostor`
    );
}
