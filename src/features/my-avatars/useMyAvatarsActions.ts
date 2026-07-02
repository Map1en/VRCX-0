import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import configRepository from '@/repositories/configRepository';
import mediaRepository from '@/repositories/mediaRepository';
import myAvatarRepository from '@/repositories/myAvatarRepository';
import {
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload';
import { useDialogStore } from '@/state/dialogStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { openAvatarDetails } from './components/MyAvatarsViewParts';
import type {
    MyAvatarAction,
    MyAvatarImageCropRequest,
    MyAvatarRow,
    MyAvatarTag,
    MyAvatarsAuthTarget
} from './myAvatarsTypes';

type MyAvatarsActionsOptions = {
    avatars: MyAvatarRow[];
    imageCropRequest: MyAvatarImageCropRequest | null;
    imageUploadAuthTargetRef: RefObject<MyAvatarsAuthTarget | null>;
    imageUploadAvatarRef: RefObject<MyAvatarRow | null>;
    imageUploadInputRef: RefObject<HTMLInputElement | null>;
    setAvatars: Dispatch<SetStateAction<MyAvatarRow[]>>;
    setContentTagsAvatar: Dispatch<SetStateAction<MyAvatarRow | null>>;
    setDetail: Dispatch<SetStateAction<string>>;
    setEditDetailsAvatar: Dispatch<SetStateAction<MyAvatarRow | null>>;
    setImageCropRequest: Dispatch<
        SetStateAction<MyAvatarImageCropRequest | null>
    >;
    setManageTagsAvatar: Dispatch<SetStateAction<MyAvatarRow | null>>;
};

function avatarIdFromValue(avatar: MyAvatarRow | null | undefined) {
    return typeof avatar?.id === 'string'
        ? avatar.id.trim()
        : String(avatar?.id ?? '').trim();
}

function isRuntimeAuthTarget(authTarget: MyAvatarsAuthTarget) {
    const runtimeAuth = useRuntimeStore.getState().auth;
    return (
        runtimeAuth.currentUserId === authTarget.currentUserId &&
        runtimeAuth.currentUserEndpoint === authTarget.currentEndpoint
    );
}

function applyOptimisticCurrentAvatar(avatar: MyAvatarRow, avatarId: string) {
    const runtimeStore = useRuntimeStore.getState();
    const previousSnapshot = runtimeStore.auth.currentUserSnapshot;
    if (!previousSnapshot || typeof previousSnapshot !== 'object') {
        return null;
    }

    const nextSnapshot = {
        ...previousSnapshot,
        currentAvatar: avatarId,
        currentAvatarName:
            typeof avatar.name === 'string' ? avatar.name.trim() : '',
        currentAvatarImageUrl:
            avatar.imageUrl ||
            avatar.thumbnailImageUrl ||
            previousSnapshot.currentAvatarImageUrl,
        currentAvatarThumbnailImageUrl:
            avatar.thumbnailImageUrl ||
            avatar.imageUrl ||
            previousSnapshot.currentAvatarThumbnailImageUrl,
        $previousAvatarSwapTime: Date.now()
    };

    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: nextSnapshot
    });

    return previousSnapshot;
}

function rollbackOptimisticCurrentAvatar(
    previousSnapshot: Record<string, unknown> | null,
    optimisticAvatarId: string
) {
    if (!previousSnapshot) {
        return;
    }
    const runtimeStore = useRuntimeStore.getState();
    const currentSnapshot = runtimeStore.auth.currentUserSnapshot;
    if (
        currentSnapshot &&
        typeof currentSnapshot === 'object' &&
        currentSnapshot.currentAvatar === optimisticAvatarId
    ) {
        runtimeStore.setAuthBootstrap({
            currentUserSnapshot: previousSnapshot
        });
    }
}

export function useMyAvatarsActions({
    avatars,
    imageCropRequest,
    imageUploadAuthTargetRef,
    imageUploadAvatarRef,
    imageUploadInputRef,
    setAvatars,
    setContentTagsAvatar,
    setDetail,
    setEditDetailsAvatar,
    setImageCropRequest,
    setManageTagsAvatar
}: MyAvatarsActionsOptions) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';
    const confirm = useModalStore((state) => state.confirm);
    const [savingTagsAvatarId, setSavingTagsAvatarId] = useState('');
    const [updatingAvatarId, setUpdatingAvatarId] = useState('');
    const [uploadingImageAvatarId, setUploadingImageAvatarId] = useState('');

    function closeActiveAvatarDialog(avatar: MyAvatarRow) {
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

    async function handleSaveAvatarTags({
        avatarId,
        tags
    }: {
        avatarId: string;
        tags: MyAvatarTag[];
    }) {
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
                t('view.my_avatars.dynamic.updated_local_tags_for_value', {
                    value: avatar?.name || avatarId
                })
            );
        } catch (error) {
            setDetail(
                error instanceof Error
                    ? error.message
                    : t('view.my_avatars.toast.failed_to_update_avatar_tags')
            );
        } finally {
            setSavingTagsAvatarId('');
        }
    }

    function applyAvatarUpdate(nextAvatar: unknown) {
        if (
            !nextAvatar ||
            typeof nextAvatar !== 'object' ||
            !('id' in nextAvatar) ||
            !nextAvatar.id
        ) {
            return;
        }
        const nextAvatarRow = nextAvatar as MyAvatarRow;
        setAvatars((currentAvatars) =>
            currentAvatars.map((entry) =>
                entry.id === nextAvatarRow.id
                    ? {
                          ...entry,
                          ...nextAvatarRow,
                          $tags: entry.$tags || [],
                          $timeSpent: entry.$timeSpent || 0
                      }
                    : entry
            )
        );
    }

    async function saveAvatarPatch(
        avatar: MyAvatarRow,
        params: Record<string, unknown>,
        successMessage: string
    ) {
        const avatarId = avatarIdFromValue(avatar);
        if (!avatarId || !currentUserId) {
            return;
        }
        const authTarget: MyAvatarsAuthTarget = {
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
                    : t('view.my_avatars.toast.failed_to_update_avatar');
            setDetail(message);
            toast.error(message);
        } finally {
            setUpdatingAvatarId((current) =>
                current === avatarId ? '' : current
            );
        }
    }

    async function wearAvatar(avatar: MyAvatarRow) {
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
                description: t('view.my_avatars.modal.select_avatar_value', {
                    value: avatar?.name || avatarId
                }),
                confirmText: t('common.actions.select'),
                cancelText: t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }
        }
        const authTarget: MyAvatarsAuthTarget = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        const previousSnapshot = applyOptimisticCurrentAvatar(avatar, avatarId);
        setUpdatingAvatarId(avatarId);
        try {
            await avatarProfileRepository.selectAvatar({
                avatarId,
                endpoint: currentEndpoint
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            setDetail('');
            toast.success(t('view.my_avatars.success.avatar_selected'));
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                rollbackOptimisticCurrentAvatar(previousSnapshot, avatarId);
                const message =
                    error instanceof Error
                        ? error.message
                        : t('view.my_avatars.toast.failed_to_select_avatar');
                setDetail(message);
                toast.error(message);
            }
        } finally {
            setUpdatingAvatarId((current) =>
                current === avatarId ? '' : current
            );
        }
    }

    async function toggleAvatarReleaseStatus(avatar: MyAvatarRow) {
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

    function openAvatarEditDetails(avatar: MyAvatarRow) {
        if (!avatar?.id) {
            return;
        }
        closeActiveAvatarDialog(avatar);
        setEditDetailsAvatar(avatar);
    }

    function openAvatarContentTags(avatar: MyAvatarRow) {
        if (!avatar?.id) {
            return;
        }
        closeActiveAvatarDialog(avatar);
        setContentTagsAvatar(avatar);
    }

    async function createAvatarImpostor(avatar: MyAvatarRow) {
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
        const authTarget: MyAvatarsAuthTarget = {
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
            setDetail(t('view.my_avatars.label.impostor_queued_for_creation'));
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
                    : t('view.my_avatars.toast.failed_to_create_impostor');
            setDetail(message);
            toast.error(message);
        } finally {
            setUpdatingAvatarId((current) =>
                current === avatarId ? '' : current
            );
        }
    }

    function beginAvatarImageUpload(avatar: MyAvatarRow) {
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

    async function handleAvatarAction(
        action: MyAvatarAction,
        avatar: MyAvatarRow
    ) {
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

    function showImageValidationError(validation: { reason?: string }) {
        if (validation.reason === 'too_large') {
            toast.error(t('view.my_avatars.error.selected_image_is_too_large'));
        } else if (validation.reason === 'not_image') {
            toast.error(
                t('view.my_avatars.error.selected_file_is_not_an_image')
            );
        }
    }

    async function onAvatarImageFileChange(
        event: ChangeEvent<HTMLInputElement>
    ) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file) {
            return;
        }
        const avatar = imageUploadAvatarRef.current;
        const avatarId = avatarIdFromValue(avatar);
        const authTarget = imageUploadAuthTargetRef.current;
        if (
            !avatar ||
            !avatarId ||
            !authTarget ||
            !isRuntimeAuthTarget(authTarget)
        ) {
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

    async function confirmAvatarImageUpload(blob: Blob) {
        const request = imageCropRequest;
        const avatar = request?.avatar;
        const avatarId = avatarIdFromValue(avatar);
        const authTarget = request?.authTarget;
        if (
            !blob ||
            !avatar ||
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
                    endpoint: currentEndpoint
                })
            );
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            applyAvatarUpdate(result.avatar);
            setDetail(
                t('view.my_avatars.dynamic.avatar_image_updated_for_value', {
                    value: avatar?.name || avatarId
                })
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

    return {
        applyAvatarUpdate,
        confirmAvatarImageUpload,
        handleAvatarAction,
        handleSaveAvatarTags,
        onAvatarImageFileChange,
        savingTagsAvatarId,
        updatingAvatarId,
        uploadingImageAvatarId
    };
}
