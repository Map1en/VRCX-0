import { toast } from 'sonner';

import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import { useDialogStore } from '@/state/dialogStore';

import {
    createAvatarCacheActions,
    createAvatarGalleryUploadActions,
    createAvatarImageUploadActions
} from './avatarMediaActions';
import { createAvatarModerationActions } from './avatarModerationActions';

function normalizeEntityId(value: any) {
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
}: any) {
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
            toast.success(t('dialog.avatar.success.avatar_refreshed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.toast.failed_to_refresh_avatar')
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
            toast.success(t('dialog.avatar.success.avatar_selected'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.toast.failed_to_select_avatar')
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
            title: t('dialog.avatar.modal.select_fallback_avatar'),
            description: t(
                'dialog.avatar.dynamic.use_value_as_your_vrchat_fallback_avatar',
                { value: avatar.name || avatar.id }
            ),
            confirmText: t('dialog.avatar.modal.select_fallback'),
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
            toast.success(t('dialog.avatar.empty.fallback_avatar_updated'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.toast.failed_to_select_fallback_avatar')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateReleaseStatus(nextStatus: any) {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const isPublic = nextStatus === 'public';
        actionStatusRef.current = 'release-status';
        setActionStatus('release-status');
        const result = await confirm({
            title: isPublic
                ? t('view.my_avatars.modal.make_avatar_public')
                : t('view.my_avatars.modal.make_avatar_private'),
            description: avatar.name || avatar.id,
            confirmText: isPublic
                ? t('dialog.avatar.actions.make_public')
                : t('dialog.avatar.actions.make_private'),
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
                isPublic
                    ? t('dialog.avatar.toast.avatar_made_public')
                    : t('dialog.avatar.toast.avatar_made_private')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.avatar.toast.failed_to_update_avatar_release_status'
                      )
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

    async function editAvatarDetails() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }
        setOwnerEditor('details');
    }

    async function deleteAvatar() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await confirm({
            title: t('dialog.avatar.modal.delete_avatar'),
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
                    ? t(
                          'dialog.avatar.toast.avatar_deleted_but_current_user_snapshot_refresh'
                      )
                    : t('message.avatar.deleted')
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
                    : t('dialog.avatar.toast.failed_to_delete_avatar')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function refreshAvatarSnapshot({ force = false }: any = {}) {
        const nextAvatar = await avatarProfileRepository.getAvatarProfile({
            avatarId: avatar.id,
            endpoint: currentEndpoint,
            force,
            allowLocalFallback: false
        });
        applyCurrentAvatarUpdate(nextAvatar);
    }

    async function saveMemo(nextValue: any) {
        const targetAvatarId = normalizeEntityId(avatar.id);
        memoRevisionRef.current += 1;
        try {
            const nextEntry = await memoPersistenceRepository.saveAvatarMemo({
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
            setAvatar((currentAvatar: any) =>
                normalizeEntityId(currentAvatar?.id) === targetAvatarId
                    ? { ...currentAvatar, $memo: nextMemo }
                    : currentAvatar
            );
            toast.success(
                nextMemo
                    ? t('dialog.avatar.toast.memo_saved')
                    : t('dialog.avatar.toast.memo_cleared')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.toast.failed_to_save_memo')
            );
        }
    }

    const {
        beginAvatarImageUpload,
        confirmAvatarImageUpload,
        onFileChangeAvatarImage
    } = createAvatarImageUploadActions({
        actionStatusRef,
        activeAvatarTargetRef,
        avatar,
        canManageAvatar,
        currentEndpoint,
        imageCropRequest,
        imageUploadAvatarRef,
        imageUploadInputRef,
        setActionStatus,
        setAvatar,
        setDetail,
        setImageCropRequest,
        t
    });
    const { deleteAvatarCache, openAvatarCacheFolder } =
        createAvatarCacheActions({
            actionStatusRef,
            avatar,
            avatarSideData,
            currentEndpoint,
            setActionStatus,
            setAvatar,
            setAvatarSideData,
            t
        });
    const { beginAvatarGalleryUpload, onFileChangeAvatarGallery } =
        createAvatarGalleryUploadActions({
            actionStatusRef,
            activeAvatarTargetRef,
            avatar,
            canManageAvatar,
            currentEndpoint,
            galleryUploadInputRef,
            setActionStatus,
            setAvatarSideData,
            t
        });
    const { setAvatarBlock, updateAvatarImposter } =
        createAvatarModerationActions({
            actionStatusRef,
            avatar,
            canManageAvatar,
            confirm,
            currentEndpoint,
            isCurrentAvatar,
            moderationRevisionRef,
            refreshAvatarSnapshot,
            setActionStatus,
            setAvatarBlocked,
            t
        });

    async function editMemo() {
        const result = await prompt({
            title: t('dialog.avatar.modal.edit_local_memo'),
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
        confirmAvatarImageUpload,
        deleteAvatar,
        deleteAvatarCache,
        editAvatarDetails,
        editMemo,
        onFileChangeAvatarGallery,
        onFileChangeAvatarImage,
        openAvatarCacheFolder,
        refreshAvatarProfile,
        saveMemo,
        selectAvatar,
        selectFallbackAvatar,
        setAvatarBlock,
        updateAvatarImposter,
        updateReleaseStatus
    };
}
