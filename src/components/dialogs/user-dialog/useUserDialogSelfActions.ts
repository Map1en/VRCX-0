import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import { mergeCurrentUserPresenceFields } from '@/shared/utils/currentUserPresence';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    fallbackLanguageOptions,
    normalizeLanguageKey,
    normalizeLanguageOptionsFromConfig,
    normalizeProfileLanguageRows,
    normalizeSelfStatusInput,
    normalizeStatusHistoryRows,
    selfStatusBaseOptions
} from './userProfileFields';
import { useSelfStatusPresets } from './useSelfStatusPresets';

function setSelfActionStatus(
    actionStatusRef: any,
    setActionStatus: any,
    nextStatus: any
) {
    actionStatusRef.current = nextStatus;
    setActionStatus(nextStatus);
}

type ProfileDetailsDraft = {
    languageKeys: string[];
    bio: string;
    bioLinks: string[];
    pronouns: string;
};

function createProfileDetailsDraft(): ProfileDetailsDraft {
    return {
        languageKeys: [],
        bio: '',
        bioLinks: [''],
        pronouns: ''
    };
}

function normalizeStringArray(values: any) {
    const seen = new Set();
    const rows = [];
    for (const value of values ?? []) {
        const normalized =
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        rows.push(normalized);
        seen.add(normalized);
    }
    return rows;
}

function normalizeLanguageKeys(values: any) {
    const keys = [];
    const seen = new Set();
    for (const value of values ?? []) {
        const key = normalizeLanguageKey(value);
        if (!key || seen.has(key)) {
            continue;
        }
        keys.push(key);
        seen.add(key);
    }
    return keys.slice(0, 3);
}

function normalizeBioLinks(values: any) {
    return (values ?? [])
        .map((value: any) =>
            typeof value === 'string'
                ? value.trim().slice(0, 1000)
                : String(value ?? '')
                      .trim()
                      .slice(0, 1000)
        )
        .filter(Boolean)
        .slice(0, 3);
}

function normalizeProfileBioLinks(profile: any) {
    return normalizeBioLinks(
        Array.isArray(profile?.bioLinks) ? profile.bioLinks : []
    );
}

function normalizeProfilePronouns(profile: any) {
    return Array.isArray(profile?.pronouns)
        ? normalizeStringArray(profile.pronouns).join(', ')
        : String(profile?.pronouns || '');
}

function buildProfileMediaFileUrl(endpoint: any, fileId: any) {
    if (!fileId) {
        return '';
    }
    const base = normalizeVrchatEndpointDomain(endpoint);
    return `${base}/file/${fileId}/1`;
}

function areStringArraysEqual(left: any, right: any) {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((value: any, index: any) => value === right[index]);
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
    setActionStatus
}: any) {
    const { t } = useTranslation();

    const [socialStatusDialogOpen, setSocialStatusDialogOpen] = useState(false);
    const [socialStatusDraft, setSocialStatusDraft] = useState<any>({
        status: 'active',
        statusDescription: ''
    });
    const [profileDetailsDialogOpen, setProfileDetailsDialogOpen] =
        useState(false);
    const [profileDetailsDraft, setProfileDetailsDraft] = useState(
        createProfileDetailsDraft
    );
    const [languageOptions, setLanguageOptions] = useState<any[]>([]);
    const [languageOptionsStatus, setLanguageOptionsStatus] = useState('idle');

    const selfStatusOptions = useMemo(() => {
        const baseOptions = selfStatusBaseOptions.map((option: any) => ({
            ...option,
            label: t(option.labelKey)
        }));
        return profile?.$isModerator
            ? [
                  ...baseOptions,
                  {
                      value: 'offline',
                      label: t('dialog.user.status.offline')
                  }
              ]
            : baseOptions;
    }, [profile?.$isModerator, t]);
    const languageOptionsMap = useMemo(
        () =>
            new Map(languageOptions.map((option: any) => [option.key, option])),
        [languageOptions]
    );
    const currentLanguageRows = useMemo(
        () => normalizeProfileLanguageRows(profile, languageOptionsMap),
        [profile, languageOptionsMap]
    );
    const currentLanguageKeys = useMemo(
        () => currentLanguageRows.map((language: any) => language.key),
        [currentLanguageRows]
    );
    const profileDetailsLanguageKeys = useMemo(
        () => normalizeLanguageKeys(profileDetailsDraft.languageKeys),
        [profileDetailsDraft.languageKeys]
    );
    const profileDetailsLanguageRows = useMemo(
        () =>
            profileDetailsLanguageKeys.map((key: any) => ({
                key,
                value: languageOptionsMap.get(key)?.value || key.toUpperCase()
            })),
        [languageOptionsMap, profileDetailsLanguageKeys]
    );
    const profileDetailsLanguageKeySet = useMemo(
        () => new Set(profileDetailsLanguageKeys),
        [profileDetailsLanguageKeys]
    );
    const availableLanguageOptions = useMemo(
        () =>
            languageOptions.filter(
                (option: any) => !profileDetailsLanguageKeySet.has(option.key)
            ),
        [languageOptions, profileDetailsLanguageKeySet]
    );
    const statusHistoryRows = useMemo(
        () => normalizeStatusHistoryRows(profile, currentUserSnapshot),
        [currentUserSnapshot, profile]
    );
    const selfStatusLabelByValue = useMemo(
        () =>
            new Map(
                selfStatusOptions.map((option: any) => [
                    option.value,
                    option.label
                ])
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
    }, [currentEndpoint]);

    useEffect(() => {
        let active = true;

        if (!profileDetailsDialogOpen || languageOptions.length) {
            return () => {
                active = false;
            };
        }

        setLanguageOptionsStatus('running');
        vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint })
            .then((response: any) => {
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
    }, [currentEndpoint, languageOptions.length, profileDetailsDialogOpen]);

    function applyCurrentUserSnapshot(nextUser: any) {
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
                currentUserId: String(storeUser.id),
                currentUserDisplayName: String(
                    storeUser.displayName || storeUser.username || storeUser.id
                ),
                currentUserSnapshot: storeUser
            });
        }
    }

    async function saveCurrentUserPatch(
        patch: any,
        { successMessage, errorMessage }: any
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
    }: any) {
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
                t('dialog.user.label.please_choose_a_valid_social_status')
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
                successMessage: t('dialog.user.success.status_updated'),
                errorMessage: t(
                    'dialog.user.toast.failed_to_update_social_status'
                )
            }
        );
        if (saved) {
            setSocialStatusDialogOpen(false);
        }
    }

    function editSelfProfileDetails() {
        if (!isCurrentUser || actionStatusRef.current !== 'idle' || !profile) {
            return;
        }

        const bioLinks = normalizeProfileBioLinks(profile);
        setProfileDetailsDraft({
            languageKeys: currentLanguageRows
                .map((language: any) => language.key)
                .slice(0, 3),
            bio: String(profile.bio || ''),
            bioLinks: bioLinks.length ? bioLinks : [''],
            pronouns: normalizeProfilePronouns(profile)
        });
        setProfileDetailsDialogOpen(true);
    }

    async function saveSelfProfileDetails() {
        if (!isCurrentUser || actionStatusRef.current !== 'idle' || !profile) {
            return;
        }

        const nextLanguageKeys = normalizeLanguageKeys(
            profileDetailsDraft.languageKeys
        );
        const addLanguageKeys = nextLanguageKeys.filter(
            (key: any) => !currentLanguageKeys.includes(key)
        );
        const removeLanguageKeys = currentLanguageKeys.filter(
            (key: any) => !nextLanguageKeys.includes(key)
        );
        const nextBio = String(profileDetailsDraft.bio || '').slice(0, 512);
        const nextBioLinks = normalizeProfileBioLinks({
            bioLinks: profileDetailsDraft.bioLinks
        });
        const nextPronouns = String(profileDetailsDraft.pronouns || '').slice(
            0,
            32
        );
        const patch: any = {};

        if (nextBio !== String(profile.bio || '')) {
            patch.bio = nextBio;
        }
        if (
            !areStringArraysEqual(
                nextBioLinks,
                normalizeProfileBioLinks(profile)
            )
        ) {
            patch.bioLinks = nextBioLinks;
        }
        if (nextPronouns !== normalizeProfilePronouns(profile)) {
            patch.pronouns = nextPronouns;
        }

        if (
            !Object.keys(patch).length &&
            !addLanguageKeys.length &&
            !removeLanguageKeys.length
        ) {
            setProfileDetailsDialogOpen(false);
            return;
        }

        setSelfActionStatus(actionStatusRef, setActionStatus, 'self-profile');

        try {
            if (Object.keys(patch).length) {
                const nextProfile =
                    await userProfileRepository.updateCurrentUser({
                        userId: currentUserId,
                        endpoint: currentEndpoint,
                        params: patch
                    });
                applyCurrentUserSnapshot(nextProfile);
            }
            if (removeLanguageKeys.length) {
                const nextProfile =
                    await userProfileRepository.removeCurrentUserTags({
                        userId: currentUserId,
                        endpoint: currentEndpoint,
                        tags: removeLanguageKeys.map(
                            (key: any) => `language_${key}`
                        )
                    });
                applyCurrentUserSnapshot(nextProfile);
            }
            if (addLanguageKeys.length) {
                const nextProfile =
                    await userProfileRepository.addCurrentUserTags({
                        userId: currentUserId,
                        endpoint: currentEndpoint,
                        tags: addLanguageKeys.map(
                            (key: any) => `language_${key}`
                        )
                    });
                applyCurrentUserSnapshot(nextProfile);
            }

            toast.success(t('dialog.user.success.profile_details_updated'));
            setProfileDetailsDialogOpen(false);
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('dialog.user.toast.failed_to_update_profile_details')
                )
            );
        } finally {
            setSelfActionStatus(actionStatusRef, setActionStatus, 'idle');
        }
    }

    async function setSelfProfileMediaField(fieldName: any, fileId: any) {
        if (!isCurrentUser || actionStatusRef.current !== 'idle' || !profile) {
            return false;
        }
        const isVrcPlusSupporter = Boolean(
            currentUserSnapshot?.$isVRCPlus ||
            currentUserSnapshot?.tags?.includes?.('system_supporter') ||
            (globalThis as typeof globalThis & { $debug?: AppDebug })?.$debug
                ?.debugVrcPlus
        );
        if (!isVrcPlusSupporter) {
            toast.error(t('message.vrcplus.required'));
            return false;
        }
        const normalizedFileId =
            typeof fileId === 'string'
                ? fileId.trim()
                : String(fileId ?? '').trim();
        const nextValue = buildProfileMediaFileUrl(
            currentEndpoint,
            normalizedFileId
        );
        if (nextValue === profile?.[fieldName]) {
            return true;
        }
        return saveCurrentUserPatch(
            {
                [fieldName]: nextValue
            },
            {
                successMessage:
                    fieldName === 'userIcon'
                        ? t('message.gallery.profile_icon_changed')
                        : t('message.gallery.profile_pic_changed'),
                errorMessage: t(
                    'view.tools.toast.failed_to_update_profile_media'
                )
            }
        );
    }

    async function toggleSelfAvatarCopying() {
        await saveCurrentUserPatch(
            { allowAvatarCopying: !profile?.allowAvatarCopying },
            {
                successMessage: t(
                    'dialog.user.success.avatar_cloning_setting_updated'
                ),
                errorMessage: t(
                    'dialog.user.toast.failed_to_update_avatar_cloning_setting'
                )
            }
        );
    }

    async function toggleSelfBooping() {
        await saveCurrentUserPatch(
            { isBoopingEnabled: profile?.isBoopingEnabled === false },
            {
                successMessage: t(
                    'dialog.user.success.booping_setting_updated'
                ),
                errorMessage: t(
                    'dialog.user.toast.failed_to_update_booping_setting'
                )
            }
        );
    }

    async function toggleSelfSharedConnections() {
        await saveCurrentUserPatch(
            {
                hasSharedConnectionsOptOut: !profile?.hasSharedConnectionsOptOut
            },
            {
                successMessage: t(
                    'dialog.user.success.shared_connections_setting_updated'
                ),
                errorMessage: t(
                    'dialog.user.toast.failed_to_update_shared_connections_setting'
                )
            }
        );
    }

    async function toggleSelfDiscordConnections() {
        await saveCurrentUserPatch(
            { hasDiscordFriendsOptOut: !profile?.hasDiscordFriendsOptOut },
            {
                successMessage: t(
                    'dialog.user.success.discord_connections_setting_updated'
                ),
                errorMessage: t(
                    'dialog.user.toast.failed_to_update_discord_connections_setting'
                )
            }
        );
    }

    async function toggleBadgeVisibility(badge: any, hidden: any) {
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
            successMessage: t('message.badge.updated'),
            fallbackErrorMessage: t('dialog.user.toast.failed_to_update_badge'),
            onSuccess: (nextProfile: any) => {
                applyCurrentUserSnapshot(nextProfile);
            }
        });
    }

    async function toggleBadgeShowcased(badge: any, showcased: any) {
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
            successMessage: t('message.badge.updated'),
            fallbackErrorMessage: t('dialog.user.toast.failed_to_update_badge'),
            onSuccess: (nextProfile: any) => {
                applyCurrentUserSnapshot(nextProfile);
            }
        });
    }

    function handleSocialStatusDialogOpenChange(nextOpen: any) {
        if (nextOpen || actionStatusRef.current === 'idle') {
            setSocialStatusDialogOpen(nextOpen);
        }
    }

    function handleProfileDetailsDialogOpenChange(nextOpen: any) {
        if (nextOpen || actionStatusRef.current === 'idle') {
            setProfileDetailsDialogOpen(nextOpen);
        }
    }

    function closeSocialStatusDialog() {
        setSocialStatusDialogOpen(false);
    }

    function closeProfileDetailsDialog() {
        setProfileDetailsDialogOpen(false);
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
        profileDetailsDialog: {
            open: profileDetailsDialogOpen,
            onOpenChange: handleProfileDetailsDialogOpenChange,
            draft: profileDetailsDraft,
            setDraft: setProfileDetailsDraft,
            languageRows: profileDetailsLanguageRows,
            availableLanguageOptions,
            languageOptionsStatus,
            onCancel: closeProfileDetailsDialog,
            onSave: saveSelfProfileDetails
        },
        actions: {
            editSelfStatus,
            editSelfProfileDetails,
            setSelfProfileMediaField,
            toggleSelfAvatarCopying,
            toggleSelfBooping,
            toggleSelfSharedConnections,
            toggleSelfDiscordConnections,
            toggleBadgeVisibility,
            toggleBadgeShowcased
        }
    };
}
