import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { backend } from '@/platform/index.js';
import { vrchatModerationRepository } from '@/repositories/index.js';

import { normalizeUserId } from './userProfileFields.js';

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
    setModerationState,
    userSessionRepository
}) {
    const { t } = useTranslation();

    async function setUserModeration(type, enabled) {
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
                    ? 'Block'
                    : 'Unblock'
                : enabled
                  ? 'Mute'
                  : 'Unmute';

        actionStatusRef.current = `${type}:${enabled ? 'enable' : 'disable'}`;
        setActionStatus(actionStatusRef.current);
        const result = await confirm({
            title: t('dialog.user.generated_dynamic.value_user', {
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
            if (enabled) {
                await vrchatModerationRepository.sendPlayerModeration({
                    endpoint: currentEndpoint,
                    moderated: rosterUserId,
                    type
                });
            } else {
                await vrchatModerationRepository.deletePlayerModeration({
                    endpoint: currentEndpoint,
                    moderated: rosterUserId,
                    type
                });
            }

            moderationRevisionRef.current += 1;
            const nextModerationState = {
                ...moderationState,
                [type]: enabled
            };
            if (currentUserId) {
                await userSessionRepository.ensureUserTables(currentUserId);
            }
            const savedState =
                await vrchatModerationRepository.saveLocalModeration({
                    ownerUserId: currentUserId,
                    userId: rosterUserId,
                    displayName: profile?.displayName || rosterUserId,
                    ...nextModerationState
                });
            setModerationState({
                block: Boolean(savedState.block),
                mute: Boolean(savedState.mute)
            });
            toast.success(
                t('dialog.user.generated_dynamic.value_request_sent', {
                    value: label
                })
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.generated_toast.failed_to_value_user', {
                          value: label.toLowerCase()
                      })
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setExtendedUserModeration(type, enabled) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const labelMap = {
            interactOff: enabled
                ? 'Disable Avatar Interaction'
                : 'Enable Avatar Interaction',
            muteChat: enabled ? 'Disable Chatbox' : 'Enable Chatbox'
        };
        const label =
            labelMap[type] || (enabled ? `Enable ${type}` : `Disable ${type}`);

        actionStatusRef.current = `${type}:${enabled ? 'enable' : 'disable'}`;
        setActionStatus(actionStatusRef.current);
        const result = await confirm({
            title: t('dialog.user.generated_dynamic.value', { value: label }),
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
            if (enabled) {
                await vrchatModerationRepository.sendPlayerModeration({
                    endpoint: currentEndpoint,
                    moderated: rosterUserId,
                    type
                });
            } else {
                await vrchatModerationRepository.deletePlayerModeration({
                    endpoint: currentEndpoint,
                    moderated: rosterUserId,
                    type
                });
            }
            setExtendedModerationState((current) => ({
                ...current,
                [type]: enabled
            }));
            toast.success(
                t('dialog.user.generated_dynamic.value_request_sent', {
                    value: label
                })
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.generated_toast.failed_to_value', {
                          value: label.toLowerCase()
                      })
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setAvatarOverrideModeration(type) {
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
                    ? 'Reset Hidden Avatar'
                    : 'Hide Avatar'
                : nextType === 0
                  ? 'Reset Shown Avatar'
                  : 'Show Avatar';

        actionStatusRef.current = `avatar-override:${nextType}`;
        setActionStatus(actionStatusRef.current);
        try {
            const result = await backend.app.SetVRChatUserModeration(
                normalizedCurrentUserId,
                rosterUserId,
                nextType
            );
            if (result === false) {
                throw new Error('Avatar moderation update failed.');
            }
            setAvatarOverrideState({
                hideAvatar: nextType === 4,
                showAvatar: nextType === 5
            });
            toast.success(
                t('dialog.user.generated_dynamic.value_updated', {
                    value: label
                })
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.user.generated_toast.failed_to_update_avatar_moderation'
                      )
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
