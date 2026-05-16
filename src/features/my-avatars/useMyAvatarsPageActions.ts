// @ts-nocheck
import { useDialogStore } from '@/state/dialogStore.js';

function avatarIdFromValue(avatar) {
    return typeof avatar?.id === 'string'
        ? avatar.id.trim()
        : String(avatar?.id ?? '').trim();
}

export function useMyAvatarsPageActions({
    avatarProfileRepository,
    avatars,
    configRepository,
    confirm,
    currentAvatarId,
    currentEndpoint,
    currentUserId,
    imageCropRequest,
    imageUploadAuthTargetRef,
    imageUploadAvatarRef,
    imageUploadInputRef,
    isRuntimeAuthTarget,
    mediaRepository,
    myAvatarRepository,
    openAvatarDetails,
    readFileAsBase64,
    setAvatars,
    setContentTagsAvatar,
    setDetail,
    setEditDetailsAvatar,
    setImageCropRequest,
    setManageTagsAvatar,
    setSavingTagsAvatarId,
    setUpdatingAvatarId,
    setUploadingImageAvatarId,
    setViewMode,
    t,
    toast,
    validateImageUploadFile,
    withUploadTimeout
}) {
    function closeActiveAvatarDialog(avatar) {
        const avatarId = avatarIdFromValue(avatar);
        if (!avatarId) {
            return;
        }
        const { activeDialog, closeDialog } = useDialogStore.getState();
        if (
            activeDialog?.kind === 'avatar' &&
            String(activeDialog.entityId ?? '').trim() === avatarId
        ) {
            closeDialog();
        }
    }

    async function handleSaveAvatarTags({ avatarId, tags }) {
        const avatar = avatars.find((entry) => entry.id === avatarId);
        const previousTags = avatar?.$tags || [];
        setSavingTagsAvatarId(avatarId);
        try {
            const nextTags = await myAvatarRepository.updateAvatarTags({
                avatarId,
                previousTags,
                nextTags: tags
            });
            setAvatars((currentAvatars) =>
                currentAvatars.map((entry) =>
                    entry.id === avatarId
                        ? {
                              ...entry,
                              $tags: nextTags
                          }
                        : entry
                )
            );
            setManageTagsAvatar(null);
            setDetail(
                t(
                    'view.my_avatars.dynamic.updated_local_tags_for_value',
                    {
                        value: avatar?.name || avatarId
                    }
                )
            );
        } catch (error) {
            setDetail(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.my_avatars.toast.failed_to_update_avatar_tags'
                      )
            );
        } finally {
            setSavingTagsAvatarId('');
        }
    }
    function applyAvatarUpdate(nextAvatar) {
        if (!nextAvatar?.id) {
            return;
        }
        setAvatars((currentAvatars) =>
            currentAvatars.map((entry) =>
                entry.id === nextAvatar.id
                    ? {
                          ...entry,
                          ...nextAvatar,
                          $tags: entry.$tags || [],
                          $timeSpent: entry.$timeSpent || 0
                      }
                    : entry
            )
        );
    }
    async function saveAvatarPatch(avatar, params, successMessage) {
        const avatarId = avatarIdFromValue(avatar);
        if (!avatarId || !currentUserId) {
            return;
        }
        const authTarget = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        setUpdatingAvatarId(avatarId);
        try {
            const nextAvatar = await myAvatarRepository.saveAvatar({
                avatarId,
                endpoint: currentEndpoint,
                params
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            applyAvatarUpdate(nextAvatar);
            setDetail(successMessage);
            toast.success(successMessage);
        } catch (error) {
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            const message =
                error instanceof Error
                    ? error.message
                    : t(
                          'view.my_avatars.toast.failed_to_update_avatar'
                      );
            setDetail(message);
            toast.error(message);
        } finally {
            setUpdatingAvatarId((current) =>
                current === avatarId ? '' : current
            );
        }
    }
    async function wearAvatar(avatar) {
        const avatarId = avatarIdFromValue(avatar);
        if (!avatarId || !currentUserId || avatarId === currentAvatarId) {
            return;
        }
        const shouldConfirm = await configRepository.getBool(
            'showConfirmationOnSwitchAvatar',
            true
        );
        if (shouldConfirm) {
            const result = await confirm({
                title: t('common.actions.confirm'),
                description: t(
                    'view.my_avatars.modal.select_avatar_value',
                    {
                        value: avatar?.name || avatarId
                    }
                ),
                confirmText: t('common.actions.select'),
                cancelText: t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }
        }
        const authTarget = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        setUpdatingAvatarId(avatarId);
        try {
            await avatarProfileRepository.selectAvatar({
                avatarId,
                endpoint: currentEndpoint
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            setDetail(
                t('view.my_avatars.dynamic.selected_avatar_value', {
                    value: avatar?.name || avatarId
                })
            );
            toast.success(t('view.my_avatars.success.avatar_selected'));
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                const message =
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.my_avatars.toast.failed_to_select_avatar'
                          );
                setDetail(message);
                toast.error(message);
            }
        } finally {
            setUpdatingAvatarId((current) =>
                current === avatarId ? '' : current
            );
        }
    }
    async function toggleAvatarReleaseStatus(avatar) {
        const nextReleaseStatus =
            avatar?.releaseStatus === 'public' ? 'private' : 'public';
        const result = await confirm({
            title:
                nextReleaseStatus === 'public'
                    ? t('view.my_avatars.modal.make_avatar_public')
                    : t('view.my_avatars.modal.make_avatar_private'),
            description: avatar?.name || avatar?.id || '',
            confirmText:
                nextReleaseStatus === 'public'
                    ? t('view.my_avatars.label.make_public')
                    : t('view.my_avatars.label.make_private'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        await saveAvatarPatch(
            avatar,
            {
                releaseStatus: nextReleaseStatus
            },
            nextReleaseStatus === 'public'
                ? t('view.my_avatars.label.avatar_made_public')
                : t('view.my_avatars.label.avatar_made_private')
        );
    }
    function openAvatarEditDetails(avatar) {
        if (!avatar?.id) {
            return;
        }
        closeActiveAvatarDialog(avatar);
        setEditDetailsAvatar(avatar);
    }
    function openAvatarContentTags(avatar) {
        if (!avatar?.id) {
            return;
        }
        closeActiveAvatarDialog(avatar);
        setContentTagsAvatar(avatar);
    }
    async function createAvatarImpostor(avatar) {
        const avatarId = avatarIdFromValue(avatar);
        if (!avatarId || !currentUserId) {
            return;
        }
        const result = await confirm({
            title: t('view.my_avatars.modal.create_impostor'),
            description: avatar?.name || avatarId,
            confirmText: t('view.my_avatars.modal.create'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        const authTarget = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        setUpdatingAvatarId(avatarId);
        try {
            await myAvatarRepository.createImpostor({
                avatarId,
                endpoint: currentEndpoint
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            setDetail(
                t('view.my_avatars.label.impostor_queued_for_creation')
            );
            toast.success(
                t('view.my_avatars.label.impostor_queued_for_creation')
            );
        } catch (error) {
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            const message =
                error instanceof Error
                    ? error.message
                    : t(
                          'view.my_avatars.toast.failed_to_create_impostor'
                      );
            setDetail(message);
            toast.error(message);
        } finally {
            setUpdatingAvatarId((current) =>
                current === avatarId ? '' : current
            );
        }
    }
    function beginAvatarImageUpload(avatar) {
        const avatarId = avatarIdFromValue(avatar);
        if (!avatarId || !currentUserId) {
            return;
        }
        closeActiveAvatarDialog(avatar);
        imageUploadAvatarRef.current = avatar;
        imageUploadAuthTargetRef.current = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };
        imageUploadInputRef.current?.click();
    }
    async function handleAvatarAction(action, avatar) {
        switch (action) {
            case 'details':
                openAvatarDetails(avatar);
                break;
            case 'wear':
                await wearAvatar(avatar);
                break;
            case 'manageTags':
                setManageTagsAvatar(avatar);
                break;
            case 'editDetails':
                openAvatarEditDetails(avatar);
                break;
            case 'makePrivate':
            case 'makePublic':
                await toggleAvatarReleaseStatus(avatar);
                break;
            case 'changeContentTags':
                openAvatarContentTags(avatar);
                break;
            case 'changeImage':
                beginAvatarImageUpload(avatar);
                break;
            case 'createImpostor':
                await createAvatarImpostor(avatar);
                break;
        }
    }
    function showImageValidationError(validation) {
        if (validation.reason === 'too_large') {
            toast.error(
                t('view.my_avatars.error.selected_image_is_too_large')
            );
        } else if (validation.reason === 'not_image') {
            toast.error(
                t('view.my_avatars.error.selected_file_is_not_an_image')
            );
        }
    }
    async function onAvatarImageFileChange(event) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file) {
            return;
        }
        const avatar = imageUploadAvatarRef.current;
        const avatarId = avatarIdFromValue(avatar);
        const authTarget = imageUploadAuthTargetRef.current;
        if (!avatarId || !authTarget || !isRuntimeAuthTarget(authTarget)) {
            return;
        }
        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            showImageValidationError(validation);
            return;
        }
        setImageCropRequest({
            file,
            avatar,
            authTarget
        });
    }
    async function confirmAvatarImageUpload(blob) {
        const request = imageCropRequest;
        const avatar = request?.avatar;
        const avatarId = avatarIdFromValue(avatar);
        const authTarget = request?.authTarget;
        if (
            !blob ||
            !avatarId ||
            !authTarget ||
            !isRuntimeAuthTarget(authTarget)
        ) {
            return;
        }
        setUploadingImageAvatarId(avatarId);
        try {
            const base64Body = await readFileAsBase64(blob);
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            const base64File =
                await mediaRepository.resizeImageToFitLimits(base64Body);
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            const result = await withUploadTimeout(
                mediaRepository.uploadAvatarImageLegacy({
                    avatarId,
                    imageUrl: avatar.imageUrl || avatar.thumbnailImageUrl || '',
                    base64File,
                    blob,
                    endpoint: currentEndpoint
                })
            );
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            applyAvatarUpdate(result.avatar);
            setDetail(
                t(
                    'view.my_avatars.dynamic.avatar_image_updated_for_value',
                    {
                        value: avatar?.name || avatarId
                    }
                )
            );
            toast.success(t('view.my_avatars.success.avatar_image_updated'));
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                const message =
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.my_avatars.toast.failed_to_upload_avatar_image'
                          );
                setDetail(message);
                toast.error(message);
            }
        } finally {
            imageUploadAvatarRef.current = null;
            imageUploadAuthTargetRef.current = null;
            setImageCropRequest(null);
            setUploadingImageAvatarId((current) =>
                current === avatarId ? '' : current
            );
        }
    }
    function handleViewModeChange(nextViewMode) {
        setViewMode(nextViewMode);
        void configRepository.setString('MyAvatarsViewMode', nextViewMode);
    }
    return {
        handleSaveAvatarTags,
        applyAvatarUpdate,
        handleAvatarAction,
        onAvatarImageFileChange,
        confirmAvatarImageUpload,
        handleViewModeChange
    };
}
