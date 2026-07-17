import type { storeAvatarImage } from '@/shared/utils/avatar';

export type AvatarRecord = Record<string, unknown>;
export type CachedAvatarImage = ReturnType<typeof storeAvatarImage>;

export type AvatarStyleRecord = AvatarRecord & {
    id?: string;
    name?: string;
    styleName?: string;
};

export type AvatarGalleryFile = AvatarRecord & {
    id?: string;
    fileId?: string;
    order?: number | string;
    url?: string;
    fileUrl?: string;
    imageUrl?: string;
    versions?: Array<
        AvatarRecord & {
            file?: AvatarRecord & { url?: string };
        }
    >;
};

export type AvatarFileVersion = AvatarRecord & {
    created_at?: string;
    status?: string;
    version?: number;
};

export type AvatarFileRecord = AvatarRecord & {
    extension?: string;
    id?: string;
    mimeType?: string;
    name?: string;
    ownerId?: string;
    tags?: string[];
    versions?: AvatarFileVersion[];
};

export type AvatarModerationRecord = AvatarRecord & {
    avatarModerationType?: string;
    created?: string | number;
    targetAvatarId?: string;
};

export type AvatarModerationDeleteRecord = AvatarRecord & {
    OK?: string;
};

export interface AvatarProfileExtras extends AvatarRecord {
    cachedAvatar?: unknown;
    localTags?: unknown[];
    timeSpent?: unknown;
    memo?: unknown;
}

export interface AvatarListOptions {
    userId?: unknown;
    user?: string;
    endpoint?: string;
    n?: number;
    offset?: number;
    sort?: string;
    order?: string;
    releaseStatus?: string;
}

export interface AvatarRequestOptions {
    endpoint?: string;
}

export interface AvatarIdInput extends AvatarRequestOptions {
    avatarId?: unknown;
}

export interface SaveAvatarInput extends AvatarIdInput {
    params?: Record<string, unknown>;
}

export interface AvatarStylesInput extends AvatarRequestOptions {
    force?: boolean;
}

export interface CollectPagesOptions {
    pageSize?: number;
    maxPages?: number;
}

export interface AvatarProfileInput extends AvatarIdInput {
    force?: boolean;
    dialog?: boolean;
    allowLocalFallback?: boolean;
    currentUserId?: unknown;
}

export interface AvatarModerationInput extends AvatarIdInput {
    type?: unknown;
}
