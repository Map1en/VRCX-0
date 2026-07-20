import type { TFunction } from 'i18next';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type {
    AvatarLocalTag,
    AvatarProfileRecord,
    EntityRecord,
    PlatformFileAnalysis
} from '@/domain/entities/profileEntities';
import type { AvatarGalleryFile } from '@/repositories/avatarProfileRepository';
import { getPlatformInfo } from '@/shared/utils/avatarPlatform';
import { useDialogStore } from '@/state/dialogStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

export type AvatarActionStatus =
    | 'idle'
    | 'refresh'
    | 'selecting'
    | 'fallback'
    | 'release-status'
    | 'delete'
    | 'image-upload'
    | 'gallery-upload'
    | 'cache'
    | 'tags'
    | 'imposter'
    | 'avatar-block';

export type AvatarLoadStatus = 'idle' | 'running' | 'ready' | 'error';
export type AvatarOwnerEditor = 'content-tags' | 'details' | null;
export type AvatarImposterAction = 'create' | 'delete' | 'regenerate';
export type AvatarReleaseStatus = 'public' | 'private';
export type AvatarDialogTab = 'info' | 'gallery' | 'json';

export type AvatarTarget = {
    avatarId: string;
    endpoint: string;
};

export type AvatarCacheInfo = {
    inCache: boolean;
    cacheSize: string;
    cacheLocked: boolean;
    cachePath: string;
};

export type AvatarSideData = {
    galleryRows: AvatarGalleryFile[];
    galleryImages: string[];
    fileAnalysis: PlatformFileAnalysis;
    cache: AvatarCacheInfo;
};

export type AvatarImageCropRequest = {
    file: File;
    avatar: AvatarProfileRecord;
};

export type AvatarGalleryEntry =
    | string
    | (EntityRecord & {
          fileUrl?: string;
          imageUrl?: string;
          thumbnailImageUrl?: string;
      });

export type AvatarListing = EntityRecord & {
    id?: string;
    platform?: string;
    displayName?: string;
    name?: string;
    description?: string;
    createdAt?: string;
};

export type AvatarViewRecord = AvatarProfileRecord & {
    gallery: AvatarGalleryFile[];
    galleryImages: string[];
    galleries?: AvatarGalleryEntry[];
    listings?: AvatarListing[];
    publishedListings?: AvatarListing[];
    unityPackage?: EntityRecord & { url?: string };
};

export type AvatarPlatformInfo = ReturnType<typeof getPlatformInfo>;

export type AvatarTagGroups = {
    localTags: AvatarLocalTag[];
    contentTags: string[];
    authorTags: string[];
    otherTags: string[];
};

export type AvatarViewState = {
    actionStatus: AvatarActionStatus;
    avatarBlocked: boolean;
    canManageAvatar: boolean;
    canSelectAvatar: boolean;
    canSelectFallbackAvatar: boolean;
    detail: string;
    fileAnalysis: PlatformFileAnalysis;
    isCurrentAvatar: boolean;
    memo: string;
};

export type AvatarControls = {
    onRefresh(): void;
    onSelect(): void;
    onSelectFallback(): void;
    onReleaseStatus(status: AvatarReleaseStatus): void;
    onAvatarBlock(enabled: boolean): void;
    onSaveMemo(memo: string): void | Promise<void>;
    onOpenCache(): void;
    onDeleteCache(): void;
    onUploadGallery(): void;
    onEditDetails(): void;
    onChangeContentTags(): void;
    onChangeImage(): void;
    onCreateImposter(): void;
    onDeleteImposter(): void;
    onRegenerateImposter(): void;
    onDelete(): void;
};

export type AvatarDialogInput = {
    avatarId: unknown;
    seedData?: unknown;
};

export type AvatarDialogActionDependencies = {
    actionStatusRef: MutableRefObject<AvatarActionStatus>;
    activeAvatarTargetRef: MutableRefObject<AvatarTarget>;
    applyCurrentAvatarUpdate(nextAvatar: unknown): void;
    avatar: AvatarProfileRecord;
    avatarSideData: AvatarSideData;
    canManageAvatar: boolean;
    canSelectAvatar: boolean;
    canSelectFallbackAvatar: boolean;
    closeDialog: ReturnType<typeof useDialogStore.getState>['closeDialog'];
    confirm: ReturnType<typeof useModalStore.getState>['confirm'];
    currentEndpoint: string;
    galleryUploadInputRef: MutableRefObject<HTMLInputElement | null>;
    imageCropRequest: AvatarImageCropRequest | null;
    imageUploadAvatarRef: MutableRefObject<AvatarProfileRecord | null>;
    imageUploadInputRef: MutableRefObject<HTMLInputElement | null>;
    isCurrentAvatar: boolean;
    memo: string;
    memoRevisionRef: MutableRefObject<number>;
    moderationRevisionRef: MutableRefObject<number>;
    normalizedAvatarId: string;
    prompt: ReturnType<typeof useModalStore.getState>['prompt'];
    setActionStatus: Dispatch<SetStateAction<AvatarActionStatus>>;
    setAuthBootstrap: ReturnType<
        typeof useRuntimeStore.getState
    >['setAuthBootstrap'];
    setAvatar: Dispatch<SetStateAction<AvatarProfileRecord | null>>;
    setAvatarBlocked: Dispatch<SetStateAction<boolean>>;
    setAvatarSideData: Dispatch<SetStateAction<AvatarSideData>>;
    setDetail: Dispatch<SetStateAction<string>>;
    setImageCropRequest: Dispatch<
        SetStateAction<AvatarImageCropRequest | null>
    >;
    setMemo: Dispatch<SetStateAction<string>>;
    setOwnerEditor: Dispatch<SetStateAction<AvatarOwnerEditor>>;
    t: TFunction;
};

export type AvatarImageUploadActionDependencies = Pick<
    AvatarDialogActionDependencies,
    | 'actionStatusRef'
    | 'activeAvatarTargetRef'
    | 'avatar'
    | 'canManageAvatar'
    | 'currentEndpoint'
    | 'imageCropRequest'
    | 'imageUploadAvatarRef'
    | 'imageUploadInputRef'
    | 'setActionStatus'
    | 'setAvatar'
    | 'setDetail'
    | 'setImageCropRequest'
    | 't'
>;

export type AvatarCacheActionDependencies = Pick<
    AvatarDialogActionDependencies,
    | 'actionStatusRef'
    | 'avatar'
    | 'avatarSideData'
    | 'setActionStatus'
    | 'setAvatar'
    | 'setAvatarSideData'
    | 't'
>;

export type AvatarGalleryUploadActionDependencies = Pick<
    AvatarDialogActionDependencies,
    | 'actionStatusRef'
    | 'activeAvatarTargetRef'
    | 'avatar'
    | 'canManageAvatar'
    | 'currentEndpoint'
    | 'galleryUploadInputRef'
    | 'setActionStatus'
    | 'setAvatarSideData'
    | 't'
>;

export type AvatarModerationActionDependencies = Pick<
    AvatarDialogActionDependencies,
    | 'actionStatusRef'
    | 'avatar'
    | 'canManageAvatar'
    | 'confirm'
    | 'isCurrentAvatar'
    | 'moderationRevisionRef'
    | 'setActionStatus'
    | 'setAvatarBlocked'
    | 't'
> & {
    refreshAvatarSnapshot(options?: { force?: boolean }): Promise<void>;
};
