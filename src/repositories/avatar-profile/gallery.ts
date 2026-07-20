import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import {
    commands,
    type VrchatAvatarFileInput
} from '@/platform/tauri/bindings';
import { storeAvatarImage } from '@/shared/utils/avatar';
import { extractFileId } from '@/shared/utils/fileUtils';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import { normalizeFileResponse } from './normalization';
import {
    avatarIdInput,
    isRecord,
    normalizeEntityId,
    unwrapVrchatAvatarResponse
} from './shared';
import type {
    AvatarFileRecord,
    AvatarGalleryFile,
    CachedAvatarImage
} from './types';

const cachedAvatarNames = new Map<string, CachedAvatarImage>();

export function clearAvatarNameCache() {
    const size = cachedAvatarNames.size;
    cachedAvatarNames.clear();
    return size;
}

export function getAvatarNameCacheSize() {
    return cachedAvatarNames.size;
}

export async function getAvatarGallery({
    avatarId,
    force = false
}: {
    avatarId?: unknown;
    force?: boolean;
}): Promise<AvatarGalleryFile[]> {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.getAvatarGallery requires an avatar id.'
        );
    }

    const rows = await fetchCachedData({
        queryKey: queryKeys.avatarGallery(
            normalizedAvatarId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.avatarGallery,
        force,
        queryFn: async () => {
            const response = unwrapVrchatAvatarResponse(
                await commands.appVrchatAvatarGalleryGet(
                    avatarIdInput(normalizedAvatarId)
                ),
                'files'
            );
            const rows = Array.isArray(response.json)
                ? response.json
                : isRecord(response.json) && Array.isArray(response.json.files)
                  ? response.json.files
                  : [];
            return rows.filter(isRecord);
        }
    });
    return rows.slice().sort((a, b) => {
        if (!a?.order && !b?.order) {
            return 0;
        }
        return (Number(a?.order) || 0) - (Number(b?.order) || 0);
    });
}

export async function getAvatarNameFromImageUrl(imageUrl: unknown) {
    const fileId = extractFileId(String(imageUrl || ''));
    if (!fileId) {
        return {
            ownerId: '',
            avatarName: '-'
        };
    }

    const cacheKey = `${DEFAULT_VRCHAT_API_ENDPOINT}\u0000${fileId}`;
    if (cachedAvatarNames.has(cacheKey)) {
        return cachedAvatarNames.get(cacheKey);
    }

    try {
        const response = await fetchCachedData({
            queryKey: queryKeys.file(fileId, DEFAULT_VRCHAT_API_ENDPOINT),
            policy: entityQueryPolicies.fileObject,
            queryFn: async () => {
                return unwrapVrchatAvatarResponse<AvatarFileRecord>(
                    await commands.appVrchatAvatarFileGet({
                        fileId
                    } satisfies VrchatAvatarFileInput),
                    `file/${encodeURIComponent(fileId)}`
                );
            }
        });
        const nextInfo = storeAvatarImage(
            {
                json: normalizeFileResponse(response.json),
                params: { fileId }
            },
            new Map()
        );
        cachedAvatarNames.set(cacheKey, nextInfo);
        return nextInfo;
    } catch {
        return {
            ownerId: '',
            avatarName: '-'
        };
    }
}
