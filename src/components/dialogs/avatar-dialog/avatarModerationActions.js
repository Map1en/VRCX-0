import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { avatarProfileRepository } from '@/repositories/index.js';

export function createAvatarModerationActions({
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
}) {
    async function updateAvatarImposter(action) {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const labels = {
            create: {
                title: t('dialog.avatar.generated_modal.create_impostor_title'),
                confirmText: t('dialog.avatar.generated_modal.create'),
                success: t(
                    'dialog.avatar.generated_toast.impostor_queued_for_creation'
                ),
                error: t(
                    'dialog.avatar.generated_toast.failed_to_create_impostor'
                )
            },
            delete: {
                title: t('dialog.avatar.generated_modal.delete_impostor_title'),
                confirmText: t('common.actions.delete'),
                success: t('dialog.avatar.generated_toast.impostor_deleted'),
                error: t(
                    'dialog.avatar.generated_toast.failed_to_delete_impostor'
                ),
                destructive: true
            },
            regenerate: {
                title: t(
                    'dialog.avatar.generated_modal.regenerate_impostor_title'
                ),
                confirmText: t('dialog.avatar.generated_modal.regenerate'),
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
                    ? t(
                          'dialog.avatar.generated_toast.value_avatar_state_refresh_failed',
                          { value: label.success }
                      )
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
                : t('dialog.avatar.generated_modal.unblock_avatar_title'),
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
            toast.success(
                enabled
                    ? t('dialog.avatar.generated_toast.avatar_blocked')
                    : t('dialog.avatar.generated_toast.avatar_unblocked')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.avatar.generated_toast.failed_to_update_avatar_moderation'
                      )
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return {
        setAvatarBlock,
        updateAvatarImposter
    };
}
