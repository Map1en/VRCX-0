import type {
    AvatarLocalTag,
    AvatarProfileRecord,
    EntityRecord,
    UnityPackageRecord
} from '@/domain/entities/profileEntities';

import {
    isRecord,
    normalizeArray,
    normalizeEntityId,
    normalizeMemoString,
    normalizeString,
    normalizeTimestamp,
    parseInteger
} from './shared';
import type { AvatarFileVersion, AvatarProfileExtras } from './types';

export function normalizeLocalTags(values: unknown): AvatarLocalTag[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .map((entry) => {
            const source = isRecord(entry) ? entry : {};
            return {
                tag: normalizeString(source.tag),
                color: normalizeString(source.color) || null
            };
        })
        .filter((entry) => entry.tag);
}

function normalizeUnityPackages(values: unknown): UnityPackageRecord[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return values.filter((value): value is EntityRecord =>
        Boolean(value && typeof value === 'object')
    );
}

export function normalizeFileResponse(json: unknown): {
    versions: AvatarFileVersion[];
    name?: string;
    ownerId?: string;
} {
    if (isRecord(json) && Array.isArray(json.versions)) {
        return {
            versions: json.versions.filter(isRecord),
            name: typeof json.name === 'string' ? json.name : '',
            ownerId: typeof json.ownerId === 'string' ? json.ownerId : ''
        };
    }

    return { versions: [], name: '', ownerId: '' };
}

function normalizeAvatarProfile(
    avatar: unknown,
    extras: AvatarProfileExtras = {}
): AvatarProfileRecord {
    const source = isRecord(avatar) ? avatar : {};
    return {
        ...source,
        id: normalizeEntityId(source.id),
        name: normalizeString(source.name),
        description: normalizeString(source.description),
        authorId: normalizeEntityId(source.authorId ?? source.author_id),
        authorName:
            normalizeEntityId(source.authorName ?? source.author_name) ||
            normalizeEntityId(source.authorId ?? source.author_id) ||
            'Unknown author',
        releaseStatus:
            normalizeEntityId(source.releaseStatus ?? source.release_status) ||
            'unknown',
        thumbnailImageUrl: normalizeString(
            source.thumbnailImageUrl ?? source.thumbnail_image_url
        ),
        imageUrl: normalizeString(source.imageUrl ?? source.image_url),
        created_at: normalizeTimestamp(source.created_at ?? source.createdAt),
        updated_at: normalizeTimestamp(source.updated_at ?? source.updatedAt),
        version: parseInteger(source.version),
        tags: normalizeArray(source.tags),
        unityPackages: normalizeUnityPackages(source.unityPackages),
        $tags: normalizeLocalTags(extras.localTags ?? source.$tags),
        $timeSpent: Math.max(
            0,
            parseInteger(extras.timeSpent ?? source.$timeSpent)
        ),
        $memo: normalizeMemoString(extras.memo ?? source.$memo),
        $isCached: Boolean(extras.cachedAvatar)
    };
}

export function normalize(
    avatar: unknown,
    extras: AvatarProfileExtras = {}
): AvatarProfileRecord {
    return normalizeAvatarProfile(avatar, extras);
}
