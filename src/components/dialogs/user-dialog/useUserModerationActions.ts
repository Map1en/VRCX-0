import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { updateModerationSync } from '@/services/moderationSyncService';
import { setVrchatUserModeration } from '@/services/shellIntegrationService';

import { normalizeUserId } from './userProfileFields';

export function useUserModerationActions({
    actionStatusRef,
    avatarOverrideState,
    confirm,
    currentEndpoint,
    currentUserId,
    isCurrentUser,
    moderationRevisionRef,
    moderationState,
    normalizedCurrentUserId,
    profile,
    setActionStatus,
    setAvatarOverrideState,
    setExtendedModerationState,
    setModerationState
}: any) {
    const { t } = useTranslation();

    async function setUserModeration(type: any, enabled: any) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            (enabled && profile?.$isModerator) ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const label =
            type === 'block'
                ? enabled
                    ? t('dialog.user.actions.moderation_block')
                    : t('dialog.user.actions.moderation_unblock')
                : enabled
                  ? t('dialog.user.actions.moderation_mute')
                  : t('dialog.user.actions.moderation_unmute');

        actionStatusRef.current = `${type}:${enabled ? 'enable' : 'disable'}`;
        setActionStatus(actionStatusRef.current);
        const result = await confirm({
            title: t('dialog.user.dynamic.value_user', {
                value: label
            }),
            description: profile?.displayName || rosterUserId,
            confirmText: label,
            cancelText: t('common.actions.cancel'),
            destructive: enabled
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            const nextModerationState: any = {
                ...moderationState,
                [type]: enabled
            };
            const result = await updateModerationSync({
                ownerUserId: normalizedCurrentUserId || currentUserId || '',
                endpoint: currentEndpoint,
                targetUserId: rosterUserId,
                targetDisplayName: profile?.displayName || rosterUserId,
                type,
                enabled
            });
            moderationRevisionRef.current += 1;
            const savedState = result?.local ?? nextModerationState;
            setModerationState({
                block: Boolean(savedState.block),
                mute: Boolean(savedState.mute)
            });
            toast.success(
                t('dialog.user.dynamic.value_request_sent', {
                    value: label
                })
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_value_user', {
                          value: label.toLowerCase()
                      })
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setExtendedUserModeration(type: any, enabled: any) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const labelMap: any = {
            interactOff: enabled
                ? t('dialog.user.actions.moderation_disable_avatar_interaction')
                : t('dialog.user.actions.moderation_enable_avatar_interaction'),
            muteChat: enabled
                ? t('dialog.user.actions.moderation_disable_chatbox')
                : t('dialog.user.actions.moderation_enable_chatbox')
        };
        const label =
            labelMap[type] ||
            t(
                enabled
                    ? 'dialog.user.dynamic.enable_value'
                    : 'dialog.user.dynamic.disable_value',
                { value: type }
            );

        actionStatusRef.current = `${type}:${enabled ? 'enable' : 'disable'}`;
        setActionStatus(actionStatusRef.current);
        const result = await confirm({
            title: t('dialog.user.dynamic.value', { value: label }),
            description: profile?.displayName || rosterUserId,
            confirmText: label,
            cancelText: t('common.actions.cancel'),
            destructive: enabled
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            await updateModerationSync({
                ownerUserId: normalizedCurrentUserId || currentUserId || '',
                endpoint: currentEndpoint,
                targetUserId: rosterUserId,
                targetDisplayName: profile?.displayName || rosterUserId,
                type,
                enabled
            });
            setExtendedModerationState((current: any) => ({
                ...current,
                [type]: enabled
            }));
            toast.success(
                t('dialog.user.dynamic.value_request_sent', {
                    value: label
                })
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_value', {
                          value: label.toLowerCase()
                      })
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setAvatarOverrideModeration(type: any) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            !normalizedCurrentUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const nextType =
            type === 'hideAvatar'
                ? avatarOverrideState.hideAvatar
                    ? 0
                    : 4
                : avatarOverrideState.showAvatar
                  ? 0
                  : 5;
        const label =
            type === 'hideAvatar'
                ? nextType === 0
                    ? t('dialog.user.actions.reset_hidden_avatar')
                    : t('dialog.user.actions.moderation_hide_avatar')
                : nextType === 0
                  ? t('dialog.user.actions.reset_shown_avatar')
                  : t('dialog.user.actions.moderation_show_avatar');

        actionStatusRef.current = `avatar-override:${nextType}`;
        setActionStatus(actionStatusRef.current);
        let knownAvatarModerationFailure = false;
        try {
            const result = await setVrchatUserModeration(
                normalizedCurrentUserId,
                rosterUserId,
                nextType
            );
            if (result === false) {
                knownAvatarModerationFailure = true;
                throw new Error();
            }
            setAvatarOverrideState({
                hideAvatar: nextType === 4,
                showAvatar: nextType === 5
            });
            toast.success(
                t('dialog.user.dynamic.value_updated', {
                    value: label
                })
            );
        } catch (error) {
            toast.error(
                error instanceof Error && !knownAvatarModerationFailure
                    ? error.message
                    : t('dialog.user.toast.failed_to_update_avatar_moderation')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return {
        setAvatarOverrideModeration,
        setExtendedUserModeration,
        setUserModeration
    };
}
