import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import {
    userProfileRepository,
    vrchatAuthRepository
} from '@/repositories/index.js';
import { mergeCurrentUserPresenceFields } from '@/shared/utils/currentUserPresence.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import {
    fallbackLanguageOptions,
    normalizeLanguageKey,
    normalizeLanguageOptionsFromConfig,
    normalizeProfileLanguageRows,
    normalizeSelfStatusInput,
    normalizeStatusHistoryRows,
    selfStatusBaseOptions
} from './userProfileFields.js';
import { useSelfStatusPresets } from './useSelfStatusPresets.js';

function setSelfActionStatus(actionStatusRef, setActionStatus, nextStatus) {
    actionStatusRef.current = nextStatus;
    setActionStatus(nextStatus);
}

export function useUserDialogSelfActions({
    profile,
    isCurrentUser,
    currentUserId,
    currentUserSnapshot,
    currentEndpoint,
    baseProfile,
    setBaseProfile,
    actionStatusRef,
    setActionStatus,
    prompt
}) {
    const { t } = useTranslation();

    const [socialStatusDialogOpen, setSocialStatusDialogOpen] = useState(false);
    const [socialStatusDraft, setSocialStatusDraft] = useState({
        status: 'active',
        statusDescription: ''
    });
    const [languageDialogOpen, setLanguageDialogOpen] = useState(false);
    const [languageOptions, setLanguageOptions] = useState([]);
    const [languageOptionsStatus, setLanguageOptionsStatus] = useState('idle');
    const [selectedLanguageToAdd, setSelectedLanguageToAdd] = useState('');

    const selfStatusOptions = useMemo(
        () =>
            profile?.$isModerator
                ? [
                      ...selfStatusBaseOptions,
                      { value: 'offline', label: 'Offline' }
                  ]
                : selfStatusBaseOptions,
        [profile?.$isModerator]
    );
    const languageOptionsMap = useMemo(
        () => new Map(languageOptions.map((option) => [option.key, option])),
        [languageOptions]
    );
    const currentLanguageRows = useMemo(
        () => normalizeProfileLanguageRows(profile, languageOptionsMap),
        [profile, languageOptionsMap]
    );
    const selectedLanguageKeys = useMemo(
        () => new Set(currentLanguageRows.map((language) => language.key)),
        [currentLanguageRows]
    );
    const availableLanguageOptions = useMemo(
        () =>
            languageOptions.filter(
                (option) => !selectedLanguageKeys.has(option.key)
            ),
        [languageOptions, selectedLanguageKeys]
    );
    const statusHistoryRows = useMemo(
        () => normalizeStatusHistoryRows(profile, currentUserSnapshot),
        [currentUserSnapshot, profile]
    );
    const selfStatusLabelByValue = useMemo(
        () =>
            new Map(
                selfStatusOptions.map((option) => [option.value, option.label])
            ),
        [selfStatusOptions]
    );
    const {
        onRemovePreset: removeSelfStatusPreset,
        onSavePreset: saveSelfStatusPreset,
        statusPresets
    } = useSelfStatusPresets({ socialStatusDraft, t });

    useEffect(() => {
        setLanguageOptions([]);
        setLanguageOptionsStatus('idle');
        setSelectedLanguageToAdd('');
    }, [currentEndpoint]);

    useEffect(() => {
        let active = true;

        if (!languageDialogOpen || languageOptions.length) {
            return () => {
                active = false;
            };
        }

        setLanguageOptionsStatus('running');
        vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint })
            .then((response) => {
                if (!active) {
                    return;
                }

                const nextOptions = normalizeLanguageOptionsFromConfig(
                    response.json
                );
                setLanguageOptions(
                    nextOptions.length ? nextOptions : fallbackLanguageOptions()
                );
                setLanguageOptionsStatus('ready');
            })
            .catch(() => {
                if (!active) {
                    return;
                }

                setLanguageOptions(fallbackLanguageOptions());
                setLanguageOptionsStatus('error');
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, languageDialogOpen, languageOptions.length]);

    function applyCurrentUserSnapshot(nextUser) {
        const displayBaseUser = mergeCurrentUserPresenceFields(
            nextUser,
            baseProfile
        );
        const storeUser = mergeCurrentUserPresenceFields(
            nextUser,
            useRuntimeStore.getState().auth.currentUserSnapshot
        );

        setBaseProfile(displayBaseUser);
        if (storeUser?.id) {
            useRuntimeStore.getState().setAuthBootstrap({
                currentUserId: storeUser.id,
                currentUserDisplayName:
                    storeUser.displayName || storeUser.username || storeUser.id,
                currentUserSnapshot: storeUser
            });
        }
    }

    async function saveCurrentUserPatch(
        patch,
        { successMessage, errorMessage }
    ) {
        if (!isCurrentUser || actionStatusRef.current !== 'idle') {
            return false;
        }

        setSelfActionStatus(actionStatusRef, setActionStatus, 'self-profile');
        try {
            const nextUser = await userProfileRepository.updateCurrentUser({
                userId: currentUserId,
                endpoint: currentEndpoint,
                params: patch
            });
            applyCurrentUserSnapshot(nextUser);
            toast.success(successMessage);
            return true;
        } catch (error) {
            toast.error(userFacingErrorMessage(error, errorMessage));
            return false;
        } finally {
            setSelfActionStatus(actionStatusRef, setActionStatus, 'idle');
        }
    }

    async function runSelfProfileMutation({
        task,
        successMessage,
        fallbackErrorMessage,
        onSuccess
    }) {
        if (!isCurrentUser || actionStatusRef.current !== 'idle') {
            return null;
        }

        setSelfActionStatus(actionStatusRef, setActionStatus, 'self-profile');
        try {
            const result = await task();
            onSuccess?.(result);
            if (successMessage) {
                toast.success(successMessage);
            }
            return result;
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : fallbackErrorMessage
            );
            return null;
        } finally {
            setSelfActionStatus(actionStatusRef, setActionStatus, 'idle');
        }
    }

    function openSelfSocialStatusDialog() {
        if (!isCurrentUser || actionStatusRef.current !== 'idle' || !profile) {
            return;
        }

        setSocialStatusDraft({
            status: normalizeSelfStatusInput(profile.status) || 'active',
            statusDescription: String(profile.statusDescription || '').slice(
                0,
                32
            )
        });
        setSocialStatusDialogOpen(true);
    }

    function editSelfStatus() {
        openSelfSocialStatusDialog();
    }

    async function saveSelfSocialStatus() {
        const nextStatus = normalizeSelfStatusInput(socialStatusDraft.status);
        if (
            !nextStatus ||
            (!profile?.$isModerator && nextStatus === 'offline')
        ) {
            toast.warning(
                t('dialog.user.generated.please_choose_a_valid_social_status')
            );
            return;
        }

        const saved = await saveCurrentUserPatch(
            {
                status: nextStatus,
                statusDescription: String(
                    socialStatusDraft.statusDescription || ''
                ).slice(0, 32)
            },
            {
                successMessage: 'Status updated.',
                errorMessage: 'Failed to update social status.'
            }
        );
        if (saved) {
            setSocialStatusDialogOpen(false);
        }
    }

    function editSelfLanguages() {
        if (!isCurrentUser || actionStatusRef.current !== 'idle') {
            return;
        }

        setSelectedLanguageToAdd('');
        setLanguageDialogOpen(true);
    }

    async function addSelfLanguage(languageKey) {
        const key = normalizeLanguageKey(languageKey);
        if (
            !key ||
            selectedLanguageKeys.has(key) ||
            currentLanguageRows.length >= 3
        ) {
            return;
        }

        const nextUser = await runSelfProfileMutation({
            task: () =>
                userProfileRepository.addCurrentUserTags({
                    userId: currentUserId,
                    endpoint: currentEndpoint,
                    tags: [`language_${key}`]
                }),
            successMessage: t('dialog.user.generated.language_added'),
            fallbackErrorMessage: t(
                'dialog.user.generated_toast.failed_to_add_language'
            ),
            onSuccess: (nextProfile) => {
                applyCurrentUserSnapshot(nextProfile);
                setSelectedLanguageToAdd('');
            }
        });

        return nextUser;
    }

    async function removeSelfLanguage(languageKey) {
        const key = normalizeLanguageKey(languageKey);
        if (!key) {
            return;
        }

        const nextUser = await runSelfProfileMutation({
            task: () =>
                userProfileRepository.removeCurrentUserTags({
                    userId: currentUserId,
                    endpoint: currentEndpoint,
                    tags: [`language_${key}`]
                }),
            successMessage: t('dialog.user.generated.language_removed'),
            fallbackErrorMessage: t(
                'dialog.user.generated_toast.failed_to_remove_language'
            ),
            onSuccess: (nextProfile) => {
                applyCurrentUserSnapshot(nextProfile);
                setSelectedLanguageToAdd('');
            }
        });

        return nextUser;
    }

    async function editSelfBio() {
        if (!profile) {
            return;
        }

        const result = await prompt({
            title: t('dialog.user.generated_modal.edit_bio'),
            inputValue: profile.bio || '',
            multiline: true,
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (result.ok) {
            await saveCurrentUserPatch(
                { bio: result.value },
                {
                    successMessage: 'Bio updated.',
                    errorMessage: 'Failed to update bio.'
                }
            );
        }
    }

    async function editSelfBioLinks() {
        if (!profile) {
            return;
        }

        const result = await prompt({
            title: t('dialog.user.generated_modal.edit_bio_links'),
            description: t(
                'dialog.user.generated_modal.one_link_per_line_up_to_3'
            ),
            inputValue: Array.isArray(profile.bioLinks)
                ? profile.bioLinks.join('\n')
                : '',
            multiline: true,
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (result.ok) {
            await saveCurrentUserPatch(
                {
                    bioLinks: String(result.value || '')
                        .split(/\r?\n/)
                        .map((link) => link.trim())
                        .filter(Boolean)
                        .slice(0, 3)
                },
                {
                    successMessage: 'Bio links updated.',
                    errorMessage: 'Failed to update bio links.'
                }
            );
        }
    }

    async function editSelfPronouns() {
        if (!profile) {
            return;
        }

        const result = await prompt({
            title: t('dialog.user.generated_modal.edit_pronouns'),
            inputValue: Array.isArray(profile.pronouns)
                ? profile.pronouns.join(', ')
                : profile.pronouns || '',
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (result.ok) {
            await saveCurrentUserPatch(
                { pronouns: result.value },
                {
                    successMessage: 'Pronouns updated.',
                    errorMessage: 'Failed to update pronouns.'
                }
            );
        }
    }

    async function toggleSelfAvatarCopying() {
        await saveCurrentUserPatch(
            { allowAvatarCopying: !profile?.allowAvatarCopying },
            {
                successMessage: 'Avatar cloning setting updated.',
                errorMessage: 'Failed to update avatar cloning setting.'
            }
        );
    }

    async function toggleSelfBooping() {
        await saveCurrentUserPatch(
            { isBoopingEnabled: profile?.isBoopingEnabled === false },
            {
                successMessage: 'Booping setting updated.',
                errorMessage: 'Failed to update booping setting.'
            }
        );
    }

    async function toggleSelfSharedConnections() {
        await saveCurrentUserPatch(
            {
                hasSharedConnectionsOptOut: !profile?.hasSharedConnectionsOptOut
            },
            {
                successMessage: 'Shared connections setting updated.',
                errorMessage: 'Failed to update shared connections setting.'
            }
        );
    }

    async function toggleSelfDiscordConnections() {
        await saveCurrentUserPatch(
            { hasDiscordFriendsOptOut: !profile?.hasDiscordFriendsOptOut },
            {
                successMessage: 'Discord connections setting updated.',
                errorMessage: 'Failed to update Discord connections setting.'
            }
        );
    }

    async function toggleBadgeVisibility(badge, hidden) {
        if (!badge?.badgeId) {
            return;
        }

        return runSelfProfileMutation({
            task: () =>
                userProfileRepository.updateCurrentUserBadge({
                    userId: currentUserId,
                    endpoint: currentEndpoint,
                    badgeId: badge.badgeId,
                    hidden,
                    showcased: hidden ? false : Boolean(badge.showcased)
                }),
            successMessage: t('dialog.user.generated.badge_updated'),
            fallbackErrorMessage: t(
                'dialog.user.generated_toast.failed_to_update_badge'
            ),
            onSuccess: (nextProfile) => {
                applyCurrentUserSnapshot(nextProfile);
            }
        });
    }

    async function toggleBadgeShowcased(badge, showcased) {
        if (!badge?.badgeId) {
            return;
        }

        return runSelfProfileMutation({
            task: () =>
                userProfileRepository.updateCurrentUserBadge({
                    userId: currentUserId,
                    endpoint: currentEndpoint,
                    badgeId: badge.badgeId,
                    hidden: showcased ? false : Boolean(badge.hidden),
                    showcased
                }),
            successMessage: t('dialog.user.generated.badge_updated'),
            fallbackErrorMessage: t(
                'dialog.user.generated_toast.failed_to_update_badge'
            ),
            onSuccess: (nextProfile) => {
                applyCurrentUserSnapshot(nextProfile);
            }
        });
    }

    function handleSocialStatusDialogOpenChange(nextOpen) {
        if (nextOpen || actionStatusRef.current === 'idle') {
            setSocialStatusDialogOpen(nextOpen);
        }
    }

    function handleLanguageDialogOpenChange(nextOpen) {
        if (nextOpen || actionStatusRef.current === 'idle') {
            setLanguageDialogOpen(nextOpen);
        }
    }

    function closeSocialStatusDialog() {
        setSocialStatusDialogOpen(false);
    }

    return {
        socialStatusDialog: {
            open: socialStatusDialogOpen,
            onOpenChange: handleSocialStatusDialogOpenChange,
            draft: socialStatusDraft,
            setDraft: setSocialStatusDraft,
            statusHistoryRows,
            statusOptions: selfStatusOptions,
            statusPresets,
            statusLabelByValue: selfStatusLabelByValue,
            onSavePreset: saveSelfStatusPreset,
            onRemovePreset: removeSelfStatusPreset,
            onCancel: closeSocialStatusDialog,
            onSave: saveSelfSocialStatus
        },
        languageDialog: {
            open: languageDialogOpen,
            onOpenChange: handleLanguageDialogOpenChange,
            currentLanguageRows,
            availableLanguageOptions,
            selectedLanguageToAdd,
            languageOptionsStatus,
            onSelectedLanguageChange: setSelectedLanguageToAdd,
            onAddLanguage: addSelfLanguage,
            onRemoveLanguage: removeSelfLanguage
        },
        actions: {
            editSelfStatus,
            editSelfLanguages,
            editSelfBio,
            editSelfBioLinks,
            editSelfPronouns,
            toggleSelfAvatarCopying,
            toggleSelfBooping,
            toggleSelfSharedConnections,
            toggleSelfDiscordConnections,
            toggleBadgeVisibility,
            toggleBadgeShowcased
        }
    };
}
