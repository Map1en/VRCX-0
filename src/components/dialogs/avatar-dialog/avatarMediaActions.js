import { toast } from 'sonner';

import { backend } from '@/platform/tauri/index.js';
import {
    avatarProfileRepository,
    mediaRepository,
    vrchatAuthRepository
} from '@/repositories/index.js';
import {
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';

import {
    avatarGalleryImageUrl,
    resolveAssetBundleArgs
} from './avatarAssets.js';
import { readAvatarCacheInfo } from './avatarCacheAdapter.js';

function normalizeEntityId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function createAvatarImageUploadActions({
    actionStatusRef,
    activeAvatarTargetRef,
    avatar,
    currentEndpoint,
    imageCropRequest,
    imageUploadAvatarRef,
    imageUploadInputRef,
    canManageAvatar,
    setActionStatus,
    setAvatar,
    setDetail,
    setImageCropRequest,
    t
}) {
    function beginAvatarImageUpload() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        imageUploadAvatarRef.current = avatar;
        imageUploadInputRef.current?.click();
    }

    function onFileChangeAvatarImage(event) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file) {
            return;
        }

        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            const message =
                validation.reason === 'too_large'
                    ? 'Selected image is too large.'
                    : 'Selected file is not an image.';
            setDetail(message);
            toast.error(message);
            return;
        }

        const selectedAvatar = imageUploadAvatarRef.current || avatar;
        if (!selectedAvatar?.id) {
            return;
        }

        imageUploadAvatarRef.current = selectedAvatar;
        setImageCropRequest({
            file,
            avatar: selectedAvatar
        });
    }

    async function confirmAvatarImageUpload(blob) {
        const request = imageCropRequest;
        const selectedAvatar =
            request?.avatar || imageUploadAvatarRef.current || avatar;
        const avatarId = normalizeEntityId(selectedAvatar?.id);
        const requestEndpoint = currentEndpoint;
        if (!blob || !avatarId) {
            return;
        }

        actionStatusRef.current = 'image-upload';
        setActionStatus('image-upload');

        try {
            const base64Body = await readFileAsBase64(blob);
            const base64File =
                await mediaRepository.resizeImageToFitLimits(base64Body);
            const result = await withUploadTimeout(
                mediaRepository.uploadAvatarImageLegacy({
                    avatarId,
                    imageUrl:
                        selectedAvatar.imageUrl ||
                        selectedAvatar.thumbnailImageUrl ||
                        '',
                    base64File,
                    blob,
                    endpoint: requestEndpoint
                })
            );
            const activeTarget = activeAvatarTargetRef.current;
            if (
                activeTarget.avatarId !== avatarId ||
                activeTarget.endpoint !== requestEndpoint
            ) {
                return;
            }
            const currentAvatar = avatarProfileRepository.normalize(
                result.avatar,
                {
                    localTags: selectedAvatar.$tags,
                    timeSpent: selectedAvatar.$timeSpent,
                    memo: selectedAvatar.$memo,
                    cachedAvatar: selectedAvatar.$isCached
                }
            );
            setAvatar(currentAvatar);
            setDetail(
                t(
                    'dialog.avatar.generated_dynamic.avatar_image_updated_for_value',
                    { value: selectedAvatar.name || avatarId }
                )
            );
            toast.success(t('dialog.avatar.generated.avatar_image_updated'));
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Failed to upload avatar image.';
            setDetail(message);
            toast.error(message);
        } finally {
            imageUploadAvatarRef.current = null;
            setImageCropRequest(null);
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return {
        beginAvatarImageUpload,
        confirmAvatarImageUpload,
        onFileChangeAvatarImage
    };
}

export function createAvatarCacheActions({
    actionStatusRef,
    avatar,
    avatarSideData,
    currentEndpoint,
    setActionStatus,
    setAvatar,
    setAvatarSideData,
    t
}) {
    async function openAvatarCacheFolder() {
        const cachePath = avatarSideData.cache.cachePath;
        if (!cachePath) {
            return;
        }
        try {
            await backend.app.OpenFolderAndSelectItem(cachePath, true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.avatar.generated_toast.failed_to_open_avatar_cache_folder'
                      )
            );
        }
    }

    async function deleteAvatarCache() {
        if (actionStatusRef.current !== 'idle') {
            return;
        }
        const configResponse = await vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint })
            .catch(() => null);
        const args = resolveAssetBundleArgs(
            avatar,
            String(configResponse?.json?.sdkUnityVersion || '')
        );
        if (!args) {
            toast.error(
                t('dialog.avatar.generated.avatar_cache_location_unavailable')
            );
            return;
        }
        actionStatusRef.current = 'cache';
        setActionStatus('cache');
        try {
            await backend.assetBundle.DeleteCache(
                args.fileId,
                args.fileVersion,
                args.variant,
                args.variantVersion
            );
            const cache = await readAvatarCacheInfo(avatar, currentEndpoint);
            setAvatarSideData((current) => ({ ...current, cache }));
            setAvatar((current) =>
                current ? { ...current, $isCached: cache.inCache } : current
            );
            toast.success(t('dialog.avatar.generated.avatar_cache_deleted'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.avatar.generated_toast.failed_to_delete_avatar_cache'
                      )
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return {
        deleteAvatarCache,
        openAvatarCacheFolder
    };
}

export function createAvatarGalleryUploadActions({
    actionStatusRef,
    activeAvatarTargetRef,
    avatar,
    canManageAvatar,
    currentEndpoint,
    galleryUploadInputRef,
    setActionStatus,
    setAvatarSideData,
    t
}) {
    function beginAvatarGalleryUpload() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }
        galleryUploadInputRef.current?.click();
    }

    async function onFileChangeAvatarGallery(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        const targetAvatarId = normalizeEntityId(avatar?.id);
        const requestEndpoint = currentEndpoint;
        if (!file || !targetAvatarId || actionStatusRef.current !== 'idle') {
            return;
        }
        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            toast.error(
                validation.reason === 'too_large'
                    ? t(
                          'dialog.avatar.generated_toast.selected_file_is_too_large'
                      )
                    : t(
                          'dialog.avatar.generated_toast.selected_file_is_not_an_image'
                      )
            );
            return;
        }
        actionStatusRef.current = 'gallery-upload';
        setActionStatus('gallery-upload');
        try {
            const base64Body = await readFileAsBase64(file);
            await mediaRepository.uploadAvatarGalleryImage(
                base64Body,
                targetAvatarId,
                {
                    endpoint: requestEndpoint
                }
            );
            const galleryRows = await avatarProfileRepository.getAvatarGallery({
                avatarId: targetAvatarId,
                endpoint: requestEndpoint
            });
            if (
                activeAvatarTargetRef.current.avatarId === targetAvatarId &&
                activeAvatarTargetRef.current.endpoint === requestEndpoint
            ) {
                setAvatarSideData((current) => ({
                    ...current,
                    galleryRows,
                    galleryImages: galleryRows
                        .map(avatarGalleryImageUrl)
                        .filter(Boolean)
                }));
                toast.success(
                    t('dialog.avatar.generated.avatar_gallery_image_uploaded')
                );
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.avatar.generated_toast.failed_to_upload_avatar_gallery_image'
                      )
            );
        } finally {
            if (actionStatusRef.current === 'gallery-upload') {
                actionStatusRef.current = 'idle';
                setActionStatus('idle');
            }
        }
    }

    return {
        beginAvatarGalleryUpload,
        onFileChangeAvatarGallery
    };
}
