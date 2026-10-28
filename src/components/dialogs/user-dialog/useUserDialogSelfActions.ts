import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction
} from 'react';
import { useTranslation } from 'react-i18next';

import type { EntityRecord } from '@/domain/entities/shared';
import type {
    UserBadgeRecord,
    UserProfileEntity
} from '@/domain/entities/user';
import { invalidateEntityQueries, queryKeys } from '@/lib/entityQueryCache';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type { CurrentUserProfileUpdateRequest } from '@/platform/tauri/bindings';
import userProfileRepository from '@/repositories/userProfileRepository';
import currentUserProfileService from '@/services/currentUserProfileService';
import { toast } from '@/services/toastService';
import { PROFILE_LIST_LIMIT } from '@/shared/constants/profileLimits';
import {
    mergeCurrentUserMediaFields,
    profileBannerColorUpdate,
    profileMediaFileUrl,
    profileMediaUpdate,
    type ProfileMediaField,
    type ProfileMediaUpdate
} from '@/shared/utils/currentUserMedia';
import { mergeCurrentUserPresenceFields } from '@/shared/utils/currentUserPresence';
import { normalizeProfileLanguageKeys } from '@/shared/utils/userLanguage';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useSpokenLanguageSelection } from '../useSpokenLanguageSelection';
import { useCurrentUserSocialStatusDialog } from './useCurrentUserSocialStatusDialog';
import {
    mergeUserDialogProfileAppearance,
    preserveUserDialogProfileAppearance
} from './userDialogProfileAppearance';
import { normalizeProfileLanguageRows } from './userProfileFields';
import type { UserDialogProfileRecord } from './useUserDialogProfileResource';

function setSelfActionStatus(
    actionStatusRef: MutableRefObject<string>,
    setActionStatus: Dispatch<SetStateAction<string>>,
    nextStatus: string
) {
    actionStatusRef.current = nextStatus;
    setActionStatus(nextStatus);
}

export type ProfileDetailsDraft = {
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

function normalizeStringArray(values: unknown) {
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const value of Array.isArray(values) ? values : []) {
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

function normalizeBioLinks(values: unknown) {
    return (Array.isArray(values) ? values : [])
        .map((value) =>
            typeof value === 'string'
                ? value.trim().slice(0, 1000)
                : String(value ?? '')
                      .trim()
                      .slice(0, 1000)
        )
        .filter(Boolean)
        .slice(0, PROFILE_LIST_LIMIT);
}

function normalizeProfileBioLinks(profile: Record<string, unknown>) {
    return normalizeBioLinks(
        Array.isArray(profile?.bioLinks) ? profile.bioLinks : []
    );
}

function normalizeProfilePronouns(profile: Record<string, unknown>) {
    return Array.isArray(profile?.pronouns)
        ? normalizeStringArray(profile.pronouns).join(', ')
        : String(profile?.pronouns || '');
}

function areStringArraysEqual(left: string[], right: string[]) {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((value, index) => value === right[index]);
}

type UseUserDialogSelfActionsProps = {
    profile: UserDialogProfileRecord | null;
    isCurrentUser: boolean;
    currentUserId: string | null;
    currentUserSnapshot: UserDialogProfileRecord | null;
    currentEndpoint: string;
    baseProfile: UserDialogProfileRecord | null;
    setBaseProfile: Dispatch<SetStateAction<UserDialogProfileRecord | null>>;
    actionStatusRef: MutableRefObject<string>;
    setActionStatus: Dispatch<SetStateAction<string>>;
};

type CurrentUserPatch = EntityRecord & {
    pronouns?: string;
};

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
}: UseUserDialogSelfActionsProps) {
    const { t } = useTranslation();
    const targetGeneration = useRef(0);
    useEffect(
        () => () => {
            targetGeneration.current += 1;
        },
        [currentUserId, currentEndpoint, isCurrentUser, profile?.id]
    );
    const [profileDetailsDraft, setProfileDetailsDraft] = useState(
        createProfileDetailsDraft
    );
    const profileDetailsLanguageKeys = useMemo(
        () => normalizeProfileLanguageKeys(profileDetailsDraft.languageKeys),
        [profileDetailsDraft.languageKeys]
    );
    const {
        languageOptionsMap,
        languageRows: profileDetailsLanguageRows,
        availableLanguageOptions,
        languageOptionsStatus
    } = useSpokenLanguageSelection(profileDetailsLanguageKeys);
    const currentLanguageRows = useMemo(
        () =>
            normalizeProfileLanguageRows(
                {
                    $languages: Array.isArray(profile?.$languages)
                        ? profile.$languages
                        : undefined,
                    tags: Array.isArray(profile?.tags)
                        ? profile.tags
                        : undefined
                },
                languageOptionsMap
            ),
        [profile, languageOptionsMap]
    );
    const currentLanguageKeys = useMemo(
        () => currentLanguageRows.map((language) => language.key),
        [currentLanguageRows]
    );
    const { dialog: socialStatusDialog, openDialog: editSelfStatus } =
        useCurrentUserSocialStatusDialog({
            profile: isCurrentUser ? profile : null,
            currentUserSnapshot,
            busy: actionStatusRef.current !== 'idle',
            onSave: (patch) =>
                saveCurrentUserPatch(patch, {
                    successMessage: t('dialog.user.success.status_updated'),
                    errorMessage: t(
                        'dialog.user.toast.failed_to_update_social_status'
                    )
                })
        });

    function applyCurrentUserSnapshot(
        nextUser: UserDialogProfileRecord,
        appearance?: UserProfileEntity
    ) {
        const resolvedUser = appearance
            ? mergeCurrentUserMediaFields(nextUser, appearance)
            : nextUser;
        const displayBaseUser = mergeUserDialogProfileAppearance(
            preserveUserDialogProfileAppearance(
                mergeCurrentUserPresenceFields(resolvedUser, baseProfile),
                baseProfile
            ),
            appearance,
            currentUserId || ''
        );
        const storeUser = mergeCurrentUserPresenceFields(
            resolvedUser,
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
        patch: CurrentUserPatch,
        options: { successMessage: string; errorMessage: string }
    ) {
        return runCurrentUserMutation(
            () =>
                currentUserProfileService.updateCurrentUser({
                    userId: currentUserId || '',
                    params: patch
                }),
            options
        );
    }

    async function runCurrentUserMutation(
        mutate: () => Promise<UserDialogProfileRecord>,
        {
            successMessage,
            errorMessage,
            refreshMedia = false
        }: {
            successMessage: string;
            errorMessage: string;
            refreshMedia?: boolean;
        }
    ) {
        if (!isCurrentUser || actionStatusRef.current !== 'idle') {
            return false;
        }

        const generation = targetGeneration.current;
        const isCurrentTarget = () => {
            const auth = useRuntimeStore.getState().auth;
            return (
                targetGeneration.current === generation &&
                auth.currentUserId === currentUserId &&
                auth.currentUserEndpoint === currentEndpoint
            );
        };
        if (!isCurrentTarget()) {
            return false;
        }
        setSelfActionStatus(actionStatusRef, setActionStatus, 'self-profile');
        try {
            const nextUser = await mutate();
            if (!isCurrentTarget()) {
                return false;
            }
            let appearance: UserProfileEntity | undefined;
            if (refreshMedia) {
                const refreshed =
                    await userProfileRepository.getUserAppearanceProfile({
                        userId: currentUserId || '',
                        asSelf: true
                    });
                if (!isCurrentTarget()) {
                    return false;
                }
                appearance = {
                    ...refreshed,
                    userIcon: refreshed.userIcon || '',
                    bannerCustomUrl: refreshed.bannerCustomUrl || ''
                };
                void invalidateEntityQueries(
                    queryKeys.userAppearanceProfile(
                        currentUserId || '',
                        currentEndpoint
                    )
                );
            }
            applyCurrentUserSnapshot(nextUser, appearance);
            toast.add({ type: 'success', title: successMessage });
            return true;
        } catch (error) {
            if (!isCurrentTarget()) {
                return false;
            }
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(error, errorMessage)
            });
            return false;
        } finally {
            setSelfActionStatus(actionStatusRef, setActionStatus, 'idle');
        }
    }

    async function runSelfProfileMutation<TResult>({
        task,
        successMessage,
        fallbackErrorMessage,
        onSuccess
    }: {
        task: () => Promise<TResult>;
        successMessage?: string;
        fallbackErrorMessage: string;
        onSuccess?: (result: TResult) => void;
    }) {
        if (!isCurrentUser || actionStatusRef.current !== 'idle') {
            return null;
        }

        setSelfActionStatus(actionStatusRef, setActionStatus, 'self-profile');
        try {
            const result = await task();
            onSuccess?.(result);
            if (successMessage) {
                toast.add({ type: 'success', title: successMessage });
            }
            return result;
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : fallbackErrorMessage
            });
            return null;
        } finally {
            setSelfActionStatus(actionStatusRef, setActionStatus, 'idle');
        }
    }

    function resetSelfProfileDetailsDraft() {
        if (!isCurrentUser || !profile) {
            return;
        }

        const bioLinks = normalizeProfileBioLinks(profile);
        setProfileDetailsDraft({
            languageKeys: currentLanguageRows
                .map((language) => language.key)
                .slice(0, PROFILE_LIST_LIMIT),
            bio: String(profile.bio || ''),
            bioLinks: bioLinks.length ? bioLinks : [''],
            pronouns: normalizeProfilePronouns(profile)
        });
    }

    async function saveSelfProfileDetails() {
        if (!isCurrentUser || actionStatusRef.current !== 'idle' || !profile) {
            return false;
        }

        const nextLanguageKeys = normalizeProfileLanguageKeys(
            profileDetailsDraft.languageKeys
        );
        const addLanguageKeys = nextLanguageKeys.filter(
            (key) => !currentLanguageKeys.includes(key)
        );
        const removeLanguageKeys = currentLanguageKeys.filter(
            (key) => !nextLanguageKeys.includes(key)
        );
        const nextBio = String(profileDetailsDraft.bio || '').slice(0, 512);
        const nextBioLinks = normalizeProfileBioLinks({
            bioLinks: profileDetailsDraft.bioLinks
        });
        const nextPronouns = String(profileDetailsDraft.pronouns || '').slice(
            0,
            32
        );
        const patch: CurrentUserPatch = {};
        const profilePatch: CurrentUserProfileUpdateRequest = {};

        if (nextBio !== String(profile.bio || '')) {
            profilePatch.bio = nextBio;
        }
        if (
            !areStringArraysEqual(
                nextBioLinks,
                normalizeProfileBioLinks(profile)
            )
        ) {
            profilePatch.bioLinks = nextBioLinks;
        }
        if (nextPronouns !== normalizeProfilePronouns(profile)) {
            patch.pronouns = nextPronouns;
        }

        if (
            !Object.keys(patch).length &&
            !Object.keys(profilePatch).length &&
            !addLanguageKeys.length &&
            !removeLanguageKeys.length
        ) {
            return true;
        }

        setSelfActionStatus(actionStatusRef, setActionStatus, 'self-profile');

        try {
            let nextUser: UserDialogProfileRecord = profile;
            if (Object.keys(profilePatch).length) {
                await userProfileRepository.updateCurrentUserProfile({
                    expectedUserId: currentUserId || '',
                    params: profilePatch
                });
            }
            if (Object.keys(patch).length) {
                nextUser = await currentUserProfileService.updateCurrentUser({
                    userId: currentUserId || '',
                    params: patch
                });
            }
            if (removeLanguageKeys.length) {
                nextUser =
                    await currentUserProfileService.removeCurrentUserTags({
                        userId: currentUserId || '',
                        tags: removeLanguageKeys.map((key) => `language_${key}`)
                    });
            }
            if (addLanguageKeys.length) {
                nextUser = await currentUserProfileService.addCurrentUserTags({
                    userId: currentUserId || '',
                    tags: addLanguageKeys.map((key) => `language_${key}`)
                });
            }
            applyCurrentUserSnapshot({ ...nextUser, ...profilePatch });

            toast.add({
                type: 'success',
                title: t('dialog.user.success.profile_details_updated')
            });
            return true;
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('dialog.user.toast.failed_to_update_profile_details')
                )
            });
            return false;
        } finally {
            setSelfActionStatus(actionStatusRef, setActionStatus, 'idle');
        }
    }

    async function updateSelfProfileMedia(
        params: ProfileMediaUpdate,
        successMessage: string
    ) {
        if (!profile) {
            return;
        }
        const currentProfile = profile;
        await runCurrentUserMutation(
            async () => {
                await userProfileRepository.updateCurrentUserProfile({
                    expectedUserId: currentUserId || '',
                    params
                });
                return currentProfile;
            },
            {
                refreshMedia: true,
                successMessage,
                errorMessage: t(
                    'view.tools.toast.failed_to_update_profile_media'
                )
            }
        );
    }

    async function setSelfProfileMediaField(
        fieldName: ProfileMediaField,
        fileId: string
    ) {
        await updateSelfProfileMedia(
            profileMediaUpdate(
                fieldName,
                profileMediaFileUrl(currentEndpoint, fileId.trim())
            ),
            fieldName === 'userIcon'
                ? t('message.gallery.profile_icon_changed')
                : t('message.gallery.profile_pic_changed')
        );
    }

    async function setSelfBannerColor(hexColor: string) {
        await updateSelfProfileMedia(
            profileBannerColorUpdate(hexColor),
            t('message.gallery.profile_pic_changed')
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

    async function toggleBadgeVisibility(
        badge: UserBadgeRecord,
        hidden: boolean
    ) {
        if (!badge?.badgeId) {
            return;
        }

        return runSelfProfileMutation({
            task: () =>
                userProfileRepository.updateCurrentUserBadge({
                    userId: currentUserId || '',
                    badgeId: badge.badgeId,
                    hidden,
                    showcased: hidden ? false : Boolean(badge.showcased)
                }),
            successMessage: t('message.badge.updated'),
            fallbackErrorMessage: t('dialog.user.toast.failed_to_update_badge'),
            onSuccess: (nextProfile) => {
                applyCurrentUserSnapshot(nextProfile);
            }
        });
    }

    async function toggleBadgeShowcased(
        badge: UserBadgeRecord,
        showcased: boolean
    ) {
        if (!badge?.badgeId) {
            return;
        }

        return runSelfProfileMutation({
            task: () =>
                userProfileRepository.updateCurrentUserBadge({
                    userId: currentUserId || '',
                    badgeId: badge.badgeId,
                    hidden: showcased ? false : Boolean(badge.hidden),
                    showcased
                }),
            successMessage: t('message.badge.updated'),
            fallbackErrorMessage: t('dialog.user.toast.failed_to_update_badge'),
            onSuccess: (nextProfile) => {
                applyCurrentUserSnapshot(nextProfile);
            }
        });
    }

    return {
        socialStatusDialog,
        profileDetails: {
            draft: profileDetailsDraft,
            setDraft: setProfileDetailsDraft,
            languageRows: profileDetailsLanguageRows,
            availableLanguageOptions,
            languageOptionsStatus,
            onReset: resetSelfProfileDetailsDraft,
            onSave: saveSelfProfileDetails
        },
        actions: {
            editSelfStatus,
            resetSelfProfileDetailsDraft,
            setSelfProfileMediaField,
            setSelfBannerColor,
            toggleSelfAvatarCopying,
            toggleSelfBooping,
            toggleSelfSharedConnections,
            toggleSelfDiscordConnections,
            toggleBadgeVisibility,
            toggleBadgeShowcased
        }
    };
}
