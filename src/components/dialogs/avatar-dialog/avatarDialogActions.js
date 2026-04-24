import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { backend } from '@/platform/tauri/index.js';
import {
    avatarProfileRepository,
    memoRepository,
    mediaRepository,
    vrchatAuthRepository
} from '@/repositories/index.js';
import {
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';
import { useDialogStore } from '@/state/dialogStore.js';

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

export function createAvatarDialogActions({
    actionStatusRef,
    activeAvatarTargetRef,
    applyCurrentAvatarUpdate,
    avatar,
    avatarSideData,
    canManageAvatar,
    canSelectAvatar,
    canSelectFallbackAvatar,
    closeDialog,
    confirm,
    currentEndpoint,
    galleryUploadInputRef,
    imageCropRequest,
    imageUploadAvatarRef,
    imageUploadInputRef,
    isCurrentAvatar,
    memo,
    memoRevisionRef,
    moderationRevisionRef,
    normalizedAvatarId,
    prompt,
    setActionStatus,
    setAuthBootstrap,
    setAvatar,
    setAvatarBlocked,
    setAvatarSideData,
    setDetail,
    setImageCropRequest,
    setMemo,
    setOwnerEditor,
    t
}) {
    async function refreshAvatarProfile() {
        if (actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'refresh';
        setActionStatus('refresh');
        try {
            const nextAvatar = await avatarProfileRepository.getAvatarProfile({
                avatarId: normalizedAvatarId,
                endpoint: currentEndpoint,
                force: true,
                allowLocalFallback: false
            });
            applyCurrentAvatarUpdate(nextAvatar);
            toast.success(t('dialog.avatar.generated.avatar_refreshed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.generated_toast.failed_to_refresh_avatar')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function selectAvatar() {
        if (!canSelectAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'selecting';
        setActionStatus('selecting');

        try {
            await avatarProfileRepository.selectAvatar({
                avatarId: avatar.id,
                endpoint: currentEndpoint
            });
            const currentUserResponse =
                await vrchatAuthRepository.getCurrentUser({
                    endpoint: currentEndpoint
                });
            const nextUser =
                currentUserResponse.json &&
                typeof currentUserResponse.json === 'object'
                    ? currentUserResponse.json
                    : null;
            if (nextUser?.id) {
                setAuthBootstrap({
                    currentUserId: nextUser.id,
                    currentUserDisplayName:
                        nextUser.displayName ||
                        nextUser.username ||
                        nextUser.id,
                    currentUserSnapshot: nextUser
                });
            }
            toast.success(t('dialog.avatar.generated.avatar_selected'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.generated_toast.failed_to_select_avatar')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function refreshCurrentUserSnapshot() {
        const currentUserResponse = await vrchatAuthRepository.getCurrentUser({
            endpoint: currentEndpoint
        });
        const nextUser =
            currentUserResponse.json &&
            typeof currentUserResponse.json === 'object'
                ? currentUserResponse.json
                : null;
        if (nextUser?.id) {
            setAuthBootstrap({
                currentUserId: nextUser.id,
                currentUserDisplayName:
                    nextUser.displayName || nextUser.username || nextUser.id,
                currentUserSnapshot: nextUser
            });
        }
    }

    async function selectFallbackAvatar() {
        if (!canSelectFallbackAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'fallback';
        setActionStatus('fallback');
        const result = await confirm({
            title: t('dialog.avatar.generated_modal.select_fallback_avatar'),
            description: t('dialog.avatar.generated_dynamic.use_value_as_your_vrchat_fallback_avatar', { value: avatar.name || avatar.id }),
            confirmText: t('dialog.avatar.generated_modal.select_fallback'),
            cancelText: t('common.actions.cancel')
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            await avatarProfileRepository.selectFallbackAvatar({
                avatarId: avatar.id,
                endpoint: currentEndpoint
            });
            await refreshCurrentUserSnapshot();
            toast.success(t('dialog.avatar.generated.fallback_avatar_updated'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.generated_toast.failed_to_select_fallback_avatar')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateReleaseStatus(nextStatus) {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const isPublic = nextStatus === 'public';
        actionStatusRef.current = 'release-status';
        setActionStatus('release-status');
        const result = await confirm({
            title: isPublic ? 'Make avatar public?' : 'Make avatar private?',
            description: avatar.name || avatar.id,
            confirmText: isPublic ? 'Make Public' : 'Make Private',
            cancelText: t('common.actions.cancel'),
            destructive: !isPublic
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            const response = await avatarProfileRepository.saveAvatar({
                avatarId: avatar.id,
                endpoint: currentEndpoint,
                params: {
                    id: avatar.id,
                    releaseStatus: nextStatus
                }
            });
            applyCurrentAvatarUpdate(
                response.json && typeof response.json === 'object'
                    ? response.json
                    : { ...avatar, releaseStatus: nextStatus }
            );
            toast.success(
                isPublic ? t('dialog.avatar.generated_toast.avatar_made_public') : t('dialog.avatar.generated_toast.avatar_made_private')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.generated_toast.failed_to_update_avatar_release_status')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function renameAvatar() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await prompt({
            title: t('dialog.avatar.generated_modal.rename_avatar'),
            description: avatar.name || avatar.id,
            inputValue: avatar.name || '',
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'rename';
        setActionStatus('rename');
        try {
            const response = await avatarProfileRepository.saveAvatar({
                avatarId: avatar.id,
                endpoint: currentEndpoint,
                params: {
                    id: avatar.id,
                    name: result.value
                }
            });
            applyCurrentAvatarUpdate(
                response.json && typeof response.json === 'object'
                    ? response.json
                    : { ...avatar, name: result.value }
            );
            toast.success(t('dialog.avatar.generated.avatar_renamed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.generated_toast.failed_to_rename_avatar')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function changeAvatarDescription() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await prompt({
            title: t('dialog.avatar.generated_modal.change_avatar_description'),
            description: avatar.name || avatar.id,
            inputValue: avatar.description || '',
            multiline: true,
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'description';
        setActionStatus('description');
        try {
            const response = await avatarProfileRepository.saveAvatar({
                avatarId: avatar.id,
                endpoint: currentEndpoint,
                params: {
                    id: avatar.id,
                    description: result.value
                }
            });
            applyCurrentAvatarUpdate(
                response.json && typeof response.json === 'object'
                    ? response.json
                    : { ...avatar, description: result.value }
            );
            toast.success(t('dialog.avatar.generated.avatar_description_updated'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.generated_toast.failed_to_update_avatar_description')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function changeAvatarContentTags() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }
        setOwnerEditor('content-tags');
    }

    async function changeAvatarStylesAndAuthorTags() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }
        setOwnerEditor('styles');
    }

    async function deleteAvatar() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await confirm({
            title: t('dialog.avatar.generated_modal.delete_avatar'),
            description: avatar.name || avatar.id,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'delete';
        setActionStatus('delete');
        try {
            await avatarProfileRepository.deleteAvatar({
                avatarId: avatar.id,
                endpoint: currentEndpoint
            });
            let refreshFailed = false;
            try {
                await refreshCurrentUserSnapshot();
            } catch {
                refreshFailed = true;
            }
            toast.success(
                refreshFailed
                    ? t('dialog.avatar.generated_toast.avatar_deleted_but_current_user_snapshot_refresh')
                    : t('dialog.avatar.generated_toast.avatar_deleted')
            );
            const dialogState = useDialogStore.getState();
            if (dialogState.breadcrumbs.length > 1) {
                dialogState.popToBreadcrumb(dialogState.breadcrumbs.length - 2);
            } else {
                closeDialog();
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.generated_toast.failed_to_delete_avatar')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function refreshAvatarSnapshot({ force = false } = {}) {
        const nextAvatar = await avatarProfileRepository.getAvatarProfile({
            avatarId: avatar.id,
            endpoint: currentEndpoint,
            force,
            allowLocalFallback: false
        });
        applyCurrentAvatarUpdate(nextAvatar);
    }

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
                t('dialog.avatar.generated_dynamic.avatar_image_updated_for_value', { value: selectedAvatar.name || avatarId })
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

    async function updateAvatarImposter(action) {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const labels = {
            create: {
                title: t(
                    'dialog.avatar.generated_modal.create_impostor_title'
                ),
                confirmText: t(
                    'dialog.avatar.generated_modal.create'
                ),
                success: t(
                    'dialog.avatar.generated_toast.impostor_queued_for_creation'
                ),
                error: t(
                    'dialog.avatar.generated_toast.failed_to_create_impostor'
                )
            },
            delete: {
                title: t(
                    'dialog.avatar.generated_modal.delete_impostor_title'
                ),
                confirmText: t('common.actions.delete'),
                success: t(
                    'dialog.avatar.generated_toast.impostor_deleted'
                ),
                error: t(
                    'dialog.avatar.generated_toast.failed_to_delete_impostor'
                ),
                destructive: true
            },
            regenerate: {
                title: t(
                    'dialog.avatar.generated_modal.regenerate_impostor_title'
                ),
                confirmText: t(
                    'dialog.avatar.generated_modal.regenerate'
                ),
                success: t(
                    'dialog.avatar.generated_toast.impostor_queued_for_regeneration'
                ),
                error: t(
                    'dialog.avatar.generated_toast.failed_to_regenerate_impostor'
                ),
                destructive: true
            }
        };
        const label = labels[action];
        if (!label) {
            return;
        }

        const result = await confirm({
            title: label.title,
            description: avatar.name || avatar.id,
            confirmText: label.confirmText,
            cancelText: t('common.actions.cancel'),
            destructive: Boolean(label.destructive)
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'imposter';
        setActionStatus('imposter');
        try {
            if (action === 'create') {
                await avatarProfileRepository.createImposter({
                    avatarId: avatar.id,
                    endpoint: currentEndpoint
                });
            } else if (action === 'delete') {
                await avatarProfileRepository.deleteImposter({
                    avatarId: avatar.id,
                    endpoint: currentEndpoint
                });
            } else {
                await avatarProfileRepository.deleteImposter({
                    avatarId: avatar.id,
                    endpoint: currentEndpoint
                });
                await avatarProfileRepository.createImposter({
                    avatarId: avatar.id,
                    endpoint: currentEndpoint
                });
            }
            let refreshFailed = false;
            try {
                await refreshAvatarSnapshot({ force: true });
            } catch {
                refreshFailed = true;
            }
            toast.success(
                refreshFailed
                    ? t('dialog.avatar.generated_toast.value_avatar_state_refresh_failed', { value: label.success })
                    : label.success
            );
        } catch (error) {
            toast.error(userFacingErrorMessage(error, label.error));
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setAvatarBlock(enabled) {
        if (
            !avatar.id ||
            isCurrentAvatar ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        actionStatusRef.current = 'avatar-block';
        setActionStatus('avatar-block');
        const result = await confirm({
            title: enabled
                ? t('dialog.avatar.generated_modal.block_avatar_title')
                : t(
                      'dialog.avatar.generated_modal.unblock_avatar_title'
                  ),
            description: avatar.name || avatar.id,
            confirmText: enabled
                ? t('dialog.avatar.generated_modal.block')
                : t('dialog.avatar.generated_modal.unblock'),
            cancelText: t('common.actions.cancel'),
            destructive: enabled
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            if (enabled) {
                await avatarProfileRepository.sendAvatarModeration({
                    avatarId: avatar.id,
                    type: 'block',
                    endpoint: currentEndpoint
                });
            } else {
                await avatarProfileRepository.deleteAvatarModeration({
                    avatarId: avatar.id,
                    type: 'block',
                    endpoint: currentEndpoint
                });
            }
            moderationRevisionRef.current += 1;
            setAvatarBlocked(enabled);
            toast.success(enabled ? t('dialog.avatar.generated_toast.avatar_blocked') : t('dialog.avatar.generated_toast.avatar_unblocked'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.generated_toast.failed_to_update_avatar_moderation')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function saveMemo(nextValue) {
        const targetAvatarId = normalizeEntityId(avatar.id);
        memoRevisionRef.current += 1;
        try {
            const nextEntry = await memoRepository.saveAvatarMemo({
                avatarId: targetAvatarId,
                memo: nextValue
            });
            if (
                activeAvatarTargetRef.current.avatarId !== targetAvatarId ||
                activeAvatarTargetRef.current.endpoint !== currentEndpoint
            ) {
                return;
            }
            const nextMemo = nextEntry.memo || '';
            setMemo(nextMemo);
            setAvatar((currentAvatar) =>
                normalizeEntityId(currentAvatar?.id) === targetAvatarId
                    ? { ...currentAvatar, $memo: nextMemo }
                    : currentAvatar
            );
            toast.success(nextMemo ? t('dialog.avatar.generated_toast.memo_saved') : t('dialog.avatar.generated_toast.memo_cleared'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : t('dialog.avatar.generated_toast.failed_to_save_memo')
            );
        }
    }

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
                    : t('dialog.avatar.generated_toast.failed_to_open_avatar_cache_folder')
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
            toast.error(t('dialog.avatar.generated.avatar_cache_location_unavailable'));
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
                    : t('dialog.avatar.generated_toast.failed_to_delete_avatar_cache')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

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
                    ? t('dialog.avatar.generated_toast.selected_file_is_too_large')
                    : t('dialog.avatar.generated_toast.selected_file_is_not_an_image')
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
                toast.success(t('dialog.avatar.generated.avatar_gallery_image_uploaded'));
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.generated_toast.failed_to_upload_avatar_gallery_image')
            );
        } finally {
            if (actionStatusRef.current === 'gallery-upload') {
                actionStatusRef.current = 'idle';
                setActionStatus('idle');
            }
        }
    }

    async function editMemo() {
        const result = await prompt({
            title: t('dialog.avatar.generated_modal.edit_local_memo'),
            description: avatar.name || avatar.id,
            inputValue: memo,
            multiline: true,
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });

        if (!result.ok) {
            return;
        }

        await saveMemo(result.value);
    }


    return {
        beginAvatarGalleryUpload,
        beginAvatarImageUpload,
        changeAvatarContentTags,
        changeAvatarDescription,
        changeAvatarStylesAndAuthorTags,
        confirmAvatarImageUpload,
        deleteAvatar,
        deleteAvatarCache,
        editMemo,
        onFileChangeAvatarGallery,
        onFileChangeAvatarImage,
        openAvatarCacheFolder,
        refreshAvatarProfile,
        renameAvatar,
        saveMemo,
        selectAvatar,
        selectFallbackAvatar,
        setAvatarBlock,
        updateAvatarImposter,
        updateReleaseStatus
    };
}
