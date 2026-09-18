import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { UserProfileEntity } from '@/domain/entities/user';
import type { AppToastOptions } from '@/services/toastService';
import type { ProfileMediaField } from '@/shared/utils/currentUserMedia';
import type { CurrentUserSnapshotState } from '@/state/runtimeStore';

import type {
    FileAssetTab,
    GalleryAssets,
    GalleryTab,
    GalleryUploadTarget
} from './galleryConstants';
import type { EmojiUploadSettings } from './inventoryHelpers';

export type GalleryAuthTarget = {
    endpoint: string;
    userId: string;
};

export type GalleryCropRequest = {
    aspectRatio: number;
    authTarget: GalleryAuthTarget;
    file: File;
    settings: EmojiUploadSettings;
    tab: GalleryUploadTarget;
};

export type GalleryUploadOptions = {
    cropWhiteBorder?: boolean;
    note?: string;
};

type DialogResult<TValue = never> = {
    ok: boolean;
    value?: TValue;
};

type DialogRequest = {
    title: string;
    description: string;
    confirmText: string;
    cancelText: string;
    destructive?: boolean;
};

type Translation = (key: string, options?: Record<string, unknown>) => string;

type ToastApi = {
    add(options: AppToastOptions): void;
};

export type GalleryControllerDeps = {
    activeTab: GalleryTab;
    cropRequest: GalleryCropRequest | null;
    currentEndpoint: string;
    currentUserId: string | null;
    mediaProfile: UserProfileEntity | null;
    refreshMediaProfile(): Promise<UserProfileEntity | null>;
    emojiAnimFps: number;
    emojiAnimFrameCount: number;
    emojiAnimLoopPingPong: boolean;
    emojiAnimType: boolean;
    emojiAnimationStyle: string;
    isVrcPlusSupporter: boolean;
    setAssets: Dispatch<SetStateAction<GalleryAssets>>;
    setCropRequest: Dispatch<SetStateAction<GalleryCropRequest | null>>;
    setEmojiAnimFps: Dispatch<SetStateAction<number>>;
    setEmojiAnimFrameCount: Dispatch<SetStateAction<number>>;
    setEmojiAnimLoopPingPong: Dispatch<SetStateAction<boolean>>;
    setEmojiAnimType: Dispatch<SetStateAction<boolean>>;
    setEmojiAnimationStyle: Dispatch<SetStateAction<string>>;
    setLoadingByTab: Dispatch<SetStateAction<Record<string, boolean>>>;
    setMutatingKey: Dispatch<SetStateAction<string>>;
    setUploadingTab: Dispatch<SetStateAction<string>>;
    uploadAuthTargetRef: MutableRefObject<GalleryAuthTarget | null>;
    uploadInputRef: MutableRefObject<{ click(): void } | null>;
    uploadTargetRef: MutableRefObject<GalleryUploadTarget | null>;
};

export type GalleryActionDeps = GalleryControllerDeps & {
    FILE_TABS: Partial<typeof import('./galleryConstants').FILE_TABS>;
    UPLOAD_ASPECT_RATIOS: Partial<Record<GalleryUploadTarget, number>>;
    confirm(request: DialogRequest): Promise<DialogResult>;
    getLocalTimestampString(): string;
    isRuntimeAuthTarget(authTarget: GalleryAuthTarget): boolean;
    mediaRepository: typeof import('@/repositories/mediaRepository').default;
    parseEmojiUploadSettings(
        fileName: string,
        settings?: Partial<EmojiUploadSettings>
    ): EmojiUploadSettings;
    prompt(request: DialogRequest): Promise<DialogResult<string>>;
    readFileAsBase64(file: Blob): Promise<string>;
    t: Translation;
    toast: ToastApi;
    useRuntimeStore: typeof import('@/state/runtimeStore').useRuntimeStore;
    userProfileRepository: typeof import('@/repositories/userProfileRepository').default;
    validateImageFile(file: Blob, t: Translation): boolean;
    withUploadTimeout<T>(promise: Promise<T>): Promise<T>;
};

export type GalleryAssetActionDeps = Omit<
    GalleryActionDeps,
    | 'mediaProfile'
    | 'refreshMediaProfile'
    | 'mediaRepository'
    | 'prompt'
    | 'useRuntimeStore'
    | 'userProfileRepository'
> & {
    mediaRepository: Pick<
        GalleryActionDeps['mediaRepository'],
        | 'collectInventoryItems'
        | 'deleteFile'
        | 'getFileList'
        | 'getPrints'
        | 'uploadAssetImage'
    >;
};

export type GalleryInventoryActionDeps = Pick<
    GalleryActionDeps,
    | 'confirm'
    | 'currentEndpoint'
    | 'currentUserId'
    | 'mediaProfile'
    | 'refreshMediaProfile'
    | 'isRuntimeAuthTarget'
    | 'prompt'
    | 'setAssets'
    | 'setMutatingKey'
    | 't'
    | 'toast'
> & {
    getAuthTarget(): GalleryAuthTarget;
    mediaRepository: Pick<
        GalleryActionDeps['mediaRepository'],
        | 'consumeInventoryBundle'
        | 'deletePrint'
        | 'redeemReward'
        | 'setPrintFavorite'
    >;
    refreshInventory(): Promise<void>;
    useRuntimeStore: {
        getState(): {
            auth: {
                currentUserSnapshot: CurrentUserSnapshotState | null;
            };
            setAuthBootstrap(input: {
                currentUserSnapshot: CurrentUserSnapshotState;
                currentUserDisplayName: string;
            }): void;
        };
    };
    userProfileRepository: Pick<
        GalleryActionDeps['userProfileRepository'],
        'updateCurrentUserProfile'
    >;
};

export type GalleryProfileField = ProfileMediaField;

export type GalleryBulkCommands = {
    bulkRunning: boolean;
    onBulkDelete(input: {
        tab: GalleryTab;
        assetIds: string[];
        lockedCount: number;
    }): void;
    onBulkSetFavorite(input: { printIds: string[]; favorite: boolean }): void;
};

export type GalleryCommands = {
    onActiveTabChange(value: string): void;
    onBeginUpload(tab: GalleryUploadTarget): void;
    onClearProfileField(fieldName: GalleryProfileField, fileId: string): void;
    onDeleteFile(tab: FileAssetTab, fileId: string): void;
    onDeletePrint(printId: string): void;
    onPreview(options: { id?: string; title: string; url: string }): void;
    onRefresh(tab: GalleryTab): void;
    onSetProfileField(fieldName: GalleryProfileField, fileId: string): void;
};

export type GalleryModel = {
    activeTab: GalleryTab;
    assets: GalleryAssets;
    currentUserId: string | null;
    gridDensityConfig: ReturnType<
        typeof import('./galleryDensity').getGalleryGridDensityConfig
    >;
    isVrcPlusSupporter: boolean;
    loadingByTab: Record<string, boolean>;
    mutatingKey: string;
    bannerCustomUrl: string;
    mediaProfileLoading: boolean;
    mediaProfileError: string;
    tabCounts: Record<GalleryTab, string>;
    uploadingTab: string;
    userIcon: string;
};

export type GalleryFileTabState = Pick<
    GalleryModel,
    | 'activeTab'
    | 'assets'
    | 'currentUserId'
    | 'gridDensityConfig'
    | 'loadingByTab'
    | 'mutatingKey'
    | 'bannerCustomUrl'
    | 'mediaProfileLoading'
    | 'mediaProfileError'
    | 'uploadingTab'
    | 'userIcon'
> &
    Pick<
        GalleryCommands,
        | 'onBeginUpload'
        | 'onClearProfileField'
        | 'onDeleteFile'
        | 'onPreview'
        | 'onSetProfileField'
    > &
    GalleryBulkCommands;
