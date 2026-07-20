import {
    commands,
    type VrchatAvatarModerationInput as IpcVrchatAvatarModerationInput
} from '@/platform/tauri/bindings';

import {
    isRecord,
    normalizeEntityId,
    normalizeString,
    unwrapVrchatAvatarResponse
} from './shared';
import type {
    AvatarModerationDeleteRecord,
    AvatarModerationInput,
    AvatarModerationRecord
} from './types';

export async function getAvatarModerations() {
    const response = unwrapVrchatAvatarResponse(
        await commands.appVrchatAvatarModerationsGet(),
        'auth/user/avatarmoderations'
    );
    return {
        ...response,
        json: Array.isArray(response.json) ? response.json.filter(isRecord) : []
    };
}

export async function sendAvatarModeration({
    avatarId,
    type = 'block'
}: AvatarModerationInput) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    const normalizedType = normalizeString(type) || 'block';
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.sendAvatarModeration requires an avatar id.'
        );
    }

    const input = {
        avatarId: normalizedAvatarId,
        type: normalizedType
    } satisfies IpcVrchatAvatarModerationInput;
    return unwrapVrchatAvatarResponse<AvatarModerationRecord>(
        await commands.appVrchatAvatarModerationSend(input),
        'auth/user/avatarmoderations'
    );
}

export async function deleteAvatarModeration({
    avatarId,
    type = 'block'
}: AvatarModerationInput) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    const normalizedType = normalizeString(type) || 'block';
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.deleteAvatarModeration requires an avatar id.'
        );
    }

    const input = {
        avatarId: normalizedAvatarId,
        type: normalizedType
    } satisfies IpcVrchatAvatarModerationInput;
    return unwrapVrchatAvatarResponse<AvatarModerationDeleteRecord>(
        await commands.appVrchatAvatarModerationDelete(input),
        'auth/user/avatarmoderations'
    );
}
