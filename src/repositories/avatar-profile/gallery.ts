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
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint';

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
    AvatarRequestOptions,
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
    endpoint = '',
    force = false
}: {
    avatarId?: unknown;
    endpoint?: string;
    force?: boolean;
}): Promise<AvatarGalleryFile[]> {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.getAvatarGallery requires an avatar id.'
        );
    }

    const rows = await fetchCachedData({
        queryKey: queryKeys.avatarGallery(normalizedAvatarId, endpoint),
        policy: entityQueryPolicies.avatarGallery,
        force,
        queryFn: async () => {
            const response = unwrapVrchatAvatarResponse(
                await commands.appVrchatAvatarGalleryGet(
                    avatarIdInput(normalizedAvatarId, endpoint)
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

export async function getAvatarNameFromImageUrl(
    imageUrl: unknown,
    { endpoint = '' }: AvatarRequestOptions = {}
) {
    const fileId = extractFileId(String(imageUrl || ''));
    if (!fileId) {
        return {
            ownerId: '',
            avatarName: '-'
        };
    }

    const cacheKey = `${normalizeVrchatEndpointDomain(endpoint)}\u0000${fileId}`;
    if (cachedAvatarNames.has(cacheKey)) {
        return cachedAvatarNames.get(cacheKey);
    }

    try {
        const response = await fetchCachedData({
            queryKey: queryKeys.file(fileId, endpoint),
            policy: entityQueryPolicies.fileObject,
            queryFn: async () => {
                return unwrapVrchatAvatarResponse<AvatarFileRecord>(
                    await commands.appVrchatAvatarFileGet({
                        fileId,
                        endpoint
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
