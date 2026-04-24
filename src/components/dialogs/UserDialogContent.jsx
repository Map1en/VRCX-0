import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { toast } from 'sonner';

import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { backend } from '@/platform/index.js';
import {
    gameLogRepository,
    memoRepository,
    toolsRepository,
    userProfileRepository,
    userSessionRepository,
    vrchatModerationRepository
} from '@/repositories/index.js';
import { subscribeRecentActions } from '@/services/recentActionService.js';
import {
    buildCurrentUserPresenceView,
    mergeCurrentUserPresenceFields
} from '@/shared/utils/currentUserPresence.js';
import { useDialogStore } from '@/state/dialogStore.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import {
    isSameLocationTag,
    resolveFriendRequestState,
    resolvePlatformMeta,
    resolvePresenceLocation
} from './user-dialog/userDialogContentHelpers.js';
import { UserDialogContentDialogs } from './user-dialog/components/UserDialogContentDialogs.jsx';
import { UserDialogEmptyState } from './user-dialog/components/UserDialogContentStates.jsx';
import {
    cachePreviousInstances,
    cacheUserStats,
    dialogTargetKey,
    readCachedPreviousInstances,
    readCachedUserStats
} from './user-dialog/userDialogCache.js';
import {
    buildFavoriteIdSet,
    normalizeUserId
} from './user-dialog/userProfileFields.js';
import {
    createEmptyUserDialogLocationPanel,
    useUserDialogLocationPanel
} from './user-dialog/useUserDialogLocationPanel.js';
import { useUserDialogSelfActions } from './user-dialog/useUserDialogSelfActions.js';
import { useUserDialogActions } from './user-dialog/useUserDialogActions.js';
import { UserDialogTabbedView } from './UserDialogTabbedView.jsx';
import { appI18n } from '@/services/i18nService.js';

export function UserDialogContent({ userId, seedData = null, openNonce = 0 }) {
    const normalizedUserId = normalizeUserId(userId);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const gameState = useRuntimeStore((state) => state.gameState);
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const isTargetCurrentUser = Boolean(
        normalizedUserId && normalizedUserId === normalizedCurrentUserId
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const applyFriendPatch = useFriendRosterStore(
        (state) => state.applyFriendPatch
    );
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const updateEntityDialogMetadata = useDialogStore(
        (state) => state.updateEntityDialogMetadata
    );

    const localSnapshot = isTargetCurrentUser
        ? currentUserSnapshot
        : friendsById[normalizedUserId] || seedData || null;
    const gameLogDisabled = usePreferencesStore(
        (state) => state.gameLogDisabled
    );
    const localSnapshotRef = useRef(localSnapshot);
    localSnapshotRef.current = localSnapshot;
    const currentUserPresenceRef = useRef({
        isTargetCurrentUser,
        currentUserSnapshot,
        gameState,
        gameLogDisabled
    });
    currentUserPresenceRef.current = {
        isTargetCurrentUser,
        currentUserSnapshot,
        gameState,
        gameLogDisabled
    };
    const withCurrentUserPresence = useCallback((nextProfile) => {
        const context = currentUserPresenceRef.current;
        if (!context.isTargetCurrentUser) {
            return nextProfile;
        }
        return buildCurrentUserPresenceView(nextProfile, context);
    }, []);
    const targetKey = useMemo(
        () => dialogTargetKey(currentEndpoint, normalizedUserId),
        [currentEndpoint, normalizedUserId]
    );

    const [baseProfile, setBaseProfile] = useState(() =>
        localSnapshot ? userProfileRepository.normalize(localSnapshot) : null
    );
    const profile = useMemo(
        () => withCurrentUserPresence(baseProfile),
        [
            baseProfile,
            currentUserSnapshot,
            gameState?.currentDestination,
            gameState?.currentLocation,
            gameState?.currentWorldId,
            gameState?.isGameRunning,
            gameLogDisabled,
            isTargetCurrentUser,
            withCurrentUserPresence
        ]
    );
    const [memo, setMemo] = useState('');
    const [loadStatus, setLoadStatus] = useState(
        normalizedUserId ? 'running' : 'idle'
    );
    const [reloadToken, setReloadToken] = useState(0);
    const [actionStatus, setActionStatus] = useState('idle');
    const [recentActionVersion, setRecentActionVersion] = useState(0);
    const [moderationState, setModerationState] = useState(() => ({
        block: false,
        mute: false
    }));
    const [extendedModerationState, setExtendedModerationState] = useState(
        () => ({
            interactOff: false,
            muteChat: false
        })
    );
    const [avatarOverrideState, setAvatarOverrideState] = useState(() => ({
        hideAvatar: false,
        showAvatar: false
    }));
    const [detail, setDetail] = useState('');
    const [previousInstances, setPreviousInstances] = useState(() =>
        readCachedPreviousInstances(targetKey)
    );
    const [userStats, setUserStats] = useState(() =>
        readCachedUserStats(targetKey)
    );
    const [representedGroup, setRepresentedGroup] = useState(null);
    const [representedGroupStatus, setRepresentedGroupStatus] =
        useState('idle');
    const actionStatusRef = useRef('idle');
    const memoRevisionRef = useRef(0);
    const moderationRevisionRef = useRef(0);
    const activeUserTargetRef = useRef({
        userId: normalizedUserId,
        endpoint: currentEndpoint
    });
    const currentGameLocation = normalizeUserId(gameState?.currentLocation);
    const currentGameDestination = normalizeUserId(
        gameState?.currentDestination
    );
    const currentSnapshotLocation = normalizeUserId(
        currentUserSnapshot?.$locationTag || currentUserSnapshot?.location
    );
    const hideUserNotes = usePreferencesStore((state) => state.hideUserNotes);
    const hideUserMemos = usePreferencesStore((state) => state.hideUserMemos);
    const appearanceSettings = useMemo(
        () => ({ hideUserNotes, hideUserMemos }),
        [hideUserMemos, hideUserNotes]
    );
    const {
        locationPanel,
        currentInviteLocation,
        canInviteFromCurrentLocation,
        refreshLocationPanel
    } = useUserDialogLocationPanel({
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        gameState,
        groupInstancesState,
        friendsById,
        profile,
        reloadToken
    });

    useEffect(() => {
        activeUserTargetRef.current = {
            userId: normalizedUserId,
            endpoint: currentEndpoint
        };
    }, [currentEndpoint, normalizedUserId]);

    useEffect(
        () =>
            subscribeRecentActions(() => {
                setRecentActionVersion((version) => version + 1);
            }),
        []
    );

    useEffect(() => {
        if (localSnapshot) {
            const nextSnapshot = userProfileRepository.normalize(localSnapshot);
            setBaseProfile((currentProfile) =>
                isTargetCurrentUser
                    ? mergeCurrentUserPresenceFields(
                          nextSnapshot,
                          currentProfile
                      )
                    : nextSnapshot
            );
        } else if (!normalizedUserId) {
            setBaseProfile(null);
        }
    }, [isTargetCurrentUser, localSnapshot, normalizedUserId]);

    useEffect(() => {
        const title = normalizeUserId(
            profile?.displayName || profile?.username
        );
        if (!profile?.id || !title) {
            return;
        }
        updateEntityDialogMetadata({
            kind: 'user',
            entityId: profile.id,
            title
        });
    }, [
        profile?.displayName,
        profile?.id,
        profile?.username,
        updateEntityDialogMetadata
    ]);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setBaseProfile(null);
            setLoadStatus('error');
            setDetail('No user id was provided for this dialog.');
            return () => {
                active = false;
            };
        }

        const snapshot = localSnapshotRef.current;
        const nextSnapshot = snapshot
            ? userProfileRepository.normalize(snapshot)
            : null;
        setBaseProfile((currentProfile) =>
            isTargetCurrentUser && nextSnapshot
                ? mergeCurrentUserPresenceFields(nextSnapshot, currentProfile)
                : nextSnapshot
        );
        setMemo('');
        setPreviousInstances(readCachedPreviousInstances(targetKey));
        setUserStats(readCachedUserStats(targetKey));
        setLoadStatus('running');
        setDetail('');

        userProfileRepository
            .getUserProfile({
                userId: normalizedUserId,
                endpoint: currentEndpoint,
                force: reloadToken > 0
            })
            .then((nextProfile) => {
                if (!active) {
                    return;
                }

                setBaseProfile((currentProfile) =>
                    isTargetCurrentUser
                        ? mergeCurrentUserPresenceFields(
                              nextProfile,
                              currentProfile
                          )
                        : nextProfile
                );
                setLoadStatus('ready');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                const fallbackSnapshot = localSnapshotRef.current;
                if (fallbackSnapshot) {
                    const nextFallback =
                        userProfileRepository.normalize(fallbackSnapshot);
                    setBaseProfile((currentProfile) =>
                        isTargetCurrentUser
                            ? mergeCurrentUserPresenceFields(
                                  nextFallback,
                                  currentProfile
                              )
                            : nextFallback
                    );
                    setLoadStatus('ready');
                    setDetail(
                        error instanceof Error
                            ? error.message
                            : 'Failed to refresh the remote user snapshot.'
                    );
                    return;
                }

                setBaseProfile(null);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load the user profile.'
                );
            });

        return () => {
            active = false;
        };
    }, [
        currentEndpoint,
        isTargetCurrentUser,
        normalizedUserId,
        reloadToken,
        targetKey
    ]);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setRepresentedGroup(null);
            setRepresentedGroupStatus('idle');
            return () => {
                active = false;
            };
        }

        const targetUserId = normalizedUserId;
        const targetEndpoint = currentEndpoint;
        setRepresentedGroup(null);
        setRepresentedGroupStatus('running');

        userProfileRepository
            .getRepresentedGroup({
                userId: targetUserId,
                endpoint: targetEndpoint,
                force: reloadToken > 0
            })
            .then((group) => {
                if (
                    !active ||
                    activeUserTargetRef.current.userId !== targetUserId ||
                    activeUserTargetRef.current.endpoint !== targetEndpoint
                ) {
                    return;
                }
                setRepresentedGroup(group);
                setRepresentedGroupStatus('ready');
            })
            .catch(() => {
                if (
                    !active ||
                    activeUserTargetRef.current.userId !== targetUserId ||
                    activeUserTargetRef.current.endpoint !== targetEndpoint
                ) {
                    return;
                }
                setRepresentedGroup(null);
                setRepresentedGroupStatus('error');
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, normalizedUserId, reloadToken]);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setMemo('');
            return () => {
                active = false;
            };
        }

        setMemo('');
        const revision = memoRevisionRef.current;
        memoRepository
            .getUserMemo(normalizedUserId)
            .then((entry) => {
                if (active && memoRevisionRef.current === revision) {
                    setMemo(entry?.memo || '');
                }
            })
            .catch(() => {
                if (active && memoRevisionRef.current === revision) {
                    setMemo('');
                }
            });

        return () => {
            active = false;
        };
    }, [normalizedUserId]);

    useEffect(() => {
        let active = true;

        if (!profile?.id) {
            setPreviousInstances(readCachedPreviousInstances(targetKey));
            return () => {
                active = false;
            };
        }

        gameLogRepository
            .getPreviousInstancesByUserId({
                id: profile.id
            })
            .then((rows) => {
                if (!active) {
                    return;
                }
                const values =
                    rows instanceof Set ? Array.from(rows.values()) : [];
                const nextInstances = values.reverse();
                cachePreviousInstances(targetKey, nextInstances);
                setPreviousInstances(nextInstances);
            })
            .catch(() => {
                // Keep the last visible rows while a refresh fails.
            });

        return () => {
            active = false;
        };
    }, [
        openNonce,
        profile?.displayName,
        profile?.id,
        profile?.username,
        reloadToken,
        targetKey
    ]);

    useEffect(() => {
        let active = true;

        if (!profile?.id) {
            setUserStats(readCachedUserStats(targetKey));
            return () => {
                active = false;
            };
        }

        const activeLocation = resolvePresenceLocation(profile);
        const currentLocation =
            currentGameLocation === 'traveling'
                ? currentGameDestination
                : currentGameLocation ||
                  currentGameDestination ||
                  currentSnapshotLocation;
        const inCurrentWorld = Boolean(
            activeLocation &&
            currentLocation &&
            isSameLocationTag(activeLocation, currentLocation)
        );

        gameLogRepository
            .getUserStats(
                {
                    id: profile.id,
                    displayName: profile.displayName || profile.username || ''
                },
                inCurrentWorld
            )
            .then((stats) => {
                if (!active) {
                    return;
                }
                const previousDisplayNames =
                    stats?.previousDisplayNames instanceof Map
                        ? Array.from(
                              stats.previousDisplayNames,
                              ([displayName, updated_at]) => ({
                                  displayName,
                                  updated_at
                              })
                          )
                        : Array.isArray(stats?.previousDisplayNames)
                          ? stats.previousDisplayNames
                          : [];
                const nextStats = {
                    timeSpent: Number(stats?.timeSpent) || 0,
                    lastSeen: stats?.lastSeen || '',
                    joinCount: Number(stats?.joinCount) || 0,
                    previousDisplayNames
                };
                cacheUserStats(targetKey, nextStats);
                setUserStats(nextStats);
            })
            .catch(() => {
                // Keep the last visible stats while a refresh fails.
            });

        return () => {
            active = false;
        };
    }, [
        currentGameDestination,
        currentGameLocation,
        currentSnapshotLocation,
        profile?.displayName,
        profile?.id,
        profile?.location,
        profile?.travelingToLocation,
        profile?.username,
        openNonce,
        reloadToken,
        targetKey
    ]);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setModerationState({ block: false, mute: false });
            return () => {
                active = false;
            };
        }

        const revision = moderationRevisionRef.current;
        const localModerationPromise = currentUserId
            ? userSessionRepository.ensureUserTables(currentUserId).then(() =>
                  vrchatModerationRepository.getLocalModeration({
                      ownerUserId: currentUserId,
                      userId: normalizedUserId
                  })
              )
            : vrchatModerationRepository.getLocalModeration({
                  ownerUserId: '',
                  userId: normalizedUserId
              });
        localModerationPromise
            .then((entry) => {
                if (active && moderationRevisionRef.current === revision) {
                    setModerationState({
                        block: Boolean(entry?.block),
                        mute: Boolean(entry?.mute)
                    });
                }
            })
            .catch(() => {
                if (active && moderationRevisionRef.current === revision) {
                    setModerationState({ block: false, mute: false });
                }
            });

        return () => {
            active = false;
        };
    }, [normalizedUserId, reloadToken]);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId || isTargetCurrentUser) {
            setExtendedModerationState({ interactOff: false, muteChat: false });
            return () => {
                active = false;
            };
        }

        vrchatModerationRepository
            .getPlayerModerations({ endpoint: currentEndpoint })
            .then((response) => {
                if (!active) {
                    return;
                }
                const rows = Array.isArray(response.json) ? response.json : [];
                setExtendedModerationState({
                    interactOff: rows.some(
                        (row) =>
                            row.targetUserId === normalizedUserId &&
                            row.type === 'interactOff'
                    ),
                    muteChat: rows.some(
                        (row) =>
                            row.targetUserId === normalizedUserId &&
                            row.type === 'muteChat'
                    )
                });
            })
            .catch(() => {
                if (active) {
                    setExtendedModerationState({
                        interactOff: false,
                        muteChat: false
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, isTargetCurrentUser, normalizedUserId, reloadToken]);

    useEffect(() => {
        let active = true;

        if (
            !normalizedUserId ||
            !normalizedCurrentUserId ||
            isTargetCurrentUser
        ) {
            setAvatarOverrideState({ hideAvatar: false, showAvatar: false });
            return () => {
                active = false;
            };
        }

        backend.app
            .GetVRChatUserModeration(normalizedCurrentUserId, normalizedUserId)
            .then((value) => {
                if (!active) {
                    return;
                }
                const moderationType = Number(
                    value?.moderationType ??
                        value?.type ??
                        value?.value ??
                        value
                );
                setAvatarOverrideState({
                    hideAvatar: moderationType === 4,
                    showAvatar: moderationType === 5
                });
            })
            .catch(() => {
                if (active) {
                    setAvatarOverrideState({
                        hideAvatar: false,
                        showAvatar: false
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [
        isTargetCurrentUser,
        normalizedCurrentUserId,
        normalizedUserId,
        reloadToken
    ]);

    const favoriteFriendIds = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );

    const isFavorite = profile?.id
        ? favoriteFriendIds.has(normalizeUserId(profile.id))
        : false;
    const isCurrentUser =
        profile?.id &&
        normalizeUserId(profile.id) === normalizeUserId(currentUserId);
    const profileUserId = normalizeUserId(profile?.id);
    const isFriend = Boolean(
        profileUserId && (friendsById[profileUserId] || profile?.isFriend)
    );
    const friendRequestState = resolveFriendRequestState(profile);
    const platform = resolvePlatformMeta(
        profile?.$platform || profile?.platform || profile?.last_platform
    );
    const PlatformIcon = platform.icon;
    const imageUrl = profile
        ? convertFileUrlToImageUrl(
              profile.profilePicOverrideThumbnail ||
                  profile.profilePicOverride ||
                  profile.currentAvatarThumbnailImageUrl ||
                  profile.currentAvatarImageUrl ||
                  '',
              256
          )
        : '';
    const presenceLocation = resolvePresenceLocation(profile);
    const { socialStatusDialog, languageDialog, actions: selfActions } =
        useUserDialogSelfActions({
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
        });

    const {
        inviteMessageRequest,
        handleInviteMessageDialogOpenChange,
        selectInviteMessage,
        actions: userActions
    } = useUserDialogActions({
        actionStatusRef,
        activeUserTargetRef,
        applyFriendPatch,
        avatarOverrideState,
        canInviteFromCurrentLocation,
        confirm,
        currentEndpoint,
        currentInviteLocation,
        currentUserId,
        friendsById,
        isCurrentUser,
        isFriend,
        normalizedCurrentUserId,
        normalizedUserId,
        moderationRevisionRef,
        moderationState,
        openNonce,
        profile,
        prompt,
        setActionStatus,
        setAvatarOverrideState,
        setBaseProfile,
        setExtendedModerationState,
        setModerationState,
        userSessionRepository
    });



    async function editMemo() {
        const targetProfile = profile;
        const targetUserId = normalizeUserId(targetProfile?.id);
        const targetEndpoint = currentEndpoint;
        const editingCurrentUser = isCurrentUser;
        if (!targetUserId) {
            return;
        }

        let nextNote = targetProfile.note || '';
        if (!editingCurrentUser) {
            const noteResult = await prompt({
                title: appI18n.t('dialog.user.generated_modal.edit_vrchat_note'),
                description: targetProfile.displayName || targetProfile.id,
                inputValue: nextNote,
                multiline: true,
                confirmText: appI18n.t('dialog.user.generated_modal.next'),
                cancelText: appI18n.t('common.actions.cancel')
            });
            if (!noteResult.ok) {
                return;
            }
            nextNote = String(noteResult.value || '').slice(0, 256);
        }

        const result = await prompt({
            title: appI18n.t('dialog.user.generated_modal.edit_local_memo'),
            description: targetProfile.displayName || targetProfile.id,
            inputValue: memo,
            multiline: true,
            confirmText: appI18n.t('common.actions.save'),
            cancelText: appI18n.t('common.actions.cancel')
        });

        if (!result.ok) {
            return;
        }

        memoRevisionRef.current += 1;
        try {
            if (
                !editingCurrentUser &&
                nextNote !== (targetProfile.note || '')
            ) {
                await toolsRepository.saveUserNote(
                    {
                        targetUserId,
                        note: nextNote
                    },
                    { endpoint: targetEndpoint }
                );
            }
            const nextEntry = await memoRepository.saveUserMemo({
                userId: targetUserId,
                memo: result.value
            });
            if (
                activeUserTargetRef.current.userId !== targetUserId ||
                activeUserTargetRef.current.endpoint !== targetEndpoint
            ) {
                return;
            }
            const nextMemo = nextEntry.memo || '';
            const rosterUserId = targetUserId;
            setMemo(nextMemo);
            setBaseProfile((currentProfile) =>
                normalizeUserId(currentProfile?.id) === targetUserId
                    ? {
                          ...currentProfile,
                          note: nextNote,
                          memo: nextMemo,
                          $nickName: nextMemo
                      }
                    : currentProfile
            );
            if (rosterUserId && friendsById[rosterUserId]) {
                applyFriendPatch({
                    userId: rosterUserId,
                    patch: {
                        note: nextNote,
                        memo: nextMemo,
                        $nickName: nextMemo
                    },
                    stateBucket:
                        friendsById[rosterUserId]?.stateBucket ||
                        friendsById[rosterUserId]?.state
                });
            }
            toast.success(nextMemo ? appI18n.t('dialog.user.generated_toast.memo_saved') : appI18n.t('dialog.user.generated_toast.memo_cleared'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : appI18n.t('dialog.user.generated_toast.failed_to_save_memo')
            );
        }
    }

    async function refreshProfile() {
        setReloadToken((value) => value + 1);
    }



    if (loadStatus === 'running' && !profile) {
        return (
            <UserDialogEmptyState
                loading
                title={appI18n.t('dialog.user.generated.loading_user_profile')}
                description={appI18n.t('dialog.user.generated.fetching_the_current_vrchat_user_snapshot_for_this_dialog')}
            />
        );
    }

    if (!profile) {
        return (
            <UserDialogEmptyState
                title={appI18n.t('dialog.user.generated.user_profile_unavailable')}
                description={
                    detail ||
                    'VRCX-0 could not resolve a user snapshot for this dialog.'
                }
            />
        );
    }

    const currentAvatarTarget = normalizeUserId(profile.currentAvatar);
    const homeLocationTarget = normalizeUserId(profile.homeLocation);
    const hasResolvedLocationPanel = Boolean(locationPanel.location);
    const activeLocationPanel =
        hasResolvedLocationPanel &&
        (!presenceLocation ||
            isSameLocationTag(locationPanel.location, presenceLocation))
            ? locationPanel
            : createEmptyUserDialogLocationPanel();
    return (
        <>
            <UserDialogTabbedView
                profile={profile}
                memo={memo}
                detail={detail}
                imageUrl={imageUrl}
                loadStatus={loadStatus}
                actionStatus={actionStatus}
                recentActionVersion={recentActionVersion}
                reloadToken={reloadToken}
                moderationState={moderationState}
                extendedModerationState={extendedModerationState}
                avatarOverrideState={avatarOverrideState}
                isCurrentUser={isCurrentUser}
                isFriend={isFriend}
                isFavorite={isFavorite}
                friendRequestState={friendRequestState}
                platform={platform}
                platformIcon={PlatformIcon}
                presenceLocation={presenceLocation}
                currentAvatarTarget={currentAvatarTarget}
                homeLocationTarget={homeLocationTarget}
                canInviteFromCurrentLocation={canInviteFromCurrentLocation}
                currentUserHasSharedConnectionsOptOut={Boolean(
                    currentUserSnapshot?.hasSharedConnectionsOptOut
                )}
                currentUserBoopingEnabled={
                    currentUserSnapshot?.isBoopingEnabled !== false
                }
                userStats={userStats}
                previousInstances={previousInstances}
                representedGroup={representedGroup}
                representedGroupStatus={representedGroupStatus}
                hideUserNotes={appearanceSettings.hideUserNotes}
                hideUserMemos={appearanceSettings.hideUserMemos}
                onPreviousInstancesChange={setPreviousInstances}
                sameInstanceUsers={activeLocationPanel.users}
                locationOwnerUser={activeLocationPanel.ownerUser}
                locationOwnerGroup={activeLocationPanel.ownerGroup}
                locationInstance={activeLocationPanel.instance}
                locationFriendCount={activeLocationPanel.friendCount}
                locationPlayerCount={activeLocationPanel.playerCount}
                onRefreshLocation={refreshLocationPanel}
                onRefresh={refreshProfile}
                onEditMemo={editMemo}
                onFriendRequest={(action) => void userActions.updateFriendRequest(action)}
                onInvite={() => void userActions.sendUserInvite()}
                onInviteMessage={() =>
                    void userActions.sendUserInvite({ withMessage: true })
                }
                onInviteRequest={() => void userActions.sendUserInviteRequest()}
                onInviteRequestMessage={() =>
                    void userActions.sendUserInviteRequest({ withMessage: true })
                }
                onBoop={() => void userActions.sendUserBoop()}
                onUnfriend={() => void userActions.unfriendUser()}
                onModeration={(type, enabled) =>
                    void userActions.setUserModeration(type, enabled)
                }
                onExtendedModeration={(type, enabled) =>
                    void userActions.setExtendedUserModeration(type, enabled)
                }
                onAvatarOverride={(type) =>
                    void userActions.setAvatarOverrideModeration(type)
                }
                onReportHacking={() => void userActions.reportHacking()}
                onGroupModeration={() => void userActions.openGroupModerationForUser()}
                onEditSelfStatus={selfActions.editSelfStatus}
                onEditSelfLanguages={selfActions.editSelfLanguages}
                onEditSelfBio={selfActions.editSelfBio}
                onEditSelfBioLinks={selfActions.editSelfBioLinks}
                onEditSelfPronouns={selfActions.editSelfPronouns}
                onToggleSelfAvatarCopying={selfActions.toggleSelfAvatarCopying}
                onToggleSelfBooping={selfActions.toggleSelfBooping}
                onToggleSelfSharedConnections={
                    selfActions.toggleSelfSharedConnections
                }
                onToggleSelfDiscordConnections={
                    selfActions.toggleSelfDiscordConnections
                }
                onToggleBadgeVisibility={selfActions.toggleBadgeVisibility}
                onToggleBadgeShowcased={selfActions.toggleBadgeShowcased}
            />
            <UserDialogContentDialogs
                actionStatus={actionStatus}
                socialStatusDialog={socialStatusDialog}
                languageDialog={languageDialog}
                inviteMessageDialog={{
                    request: inviteMessageRequest,
                    onOpenChange: handleInviteMessageDialogOpenChange,
                    normalizedCurrentUserId,
                    currentEndpoint,
                    targetLabel: profile?.displayName || profile?.id,
                    onUse: selectInviteMessage
                }}
            />
        </>
    );
}
