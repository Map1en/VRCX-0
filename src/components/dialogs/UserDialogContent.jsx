import {
    useCallback,
    useEffect,
    useLayoutEffect,
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
    notificationRepository,
    toolsRepository,
    userProfileRepository,
    userSessionRepository,
    vrchatFriendRepository,
    vrchatModerationRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import { openGroupDialog } from '@/services/dialogService.js';
import friendRelationshipService from '@/services/friendRelationshipService.js';
import {
    recordRecentAction,
    subscribeRecentActions
} from '@/services/recentActionService.js';
import {
    buildCurrentUserPresenceView,
    mergeCurrentUserPresenceFields
} from '@/shared/utils/currentUserPresence.js';
import { parseLocation } from '@/shared/utils/location.js';
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
    const [inviteMessageRequest, setInviteMessageRequest] = useState(null);
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

    useLayoutEffect(() => {
        setInviteMessageRequest(null);
    }, [
        currentEndpoint,
        normalizedCurrentUserId,
        normalizedUserId,
        openNonce,
        profile?.id
    ]);

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

    async function findIncomingFriendRequestNotification(rosterUserId) {
        const normalizedCurrentUserId = normalizeUserId(currentUserId);
        if (!normalizedCurrentUserId || !rosterUserId) {
            return null;
        }

        const rows = await notificationRepository.queryNotifications({
            userId: normalizedCurrentUserId,
            filters: ['friendRequest']
        });
        return (
            rows.find(
                (row) =>
                    row?.type === 'friendRequest' &&
                    !row.expired &&
                    normalizeUserId(row.senderUserId) === rosterUserId
            ) || null
        );
    }

    async function dismissBoopNotifications(rosterUserId) {
        const normalizedCurrentUserId = normalizeUserId(currentUserId);
        if (!normalizedCurrentUserId || !rosterUserId) {
            return;
        }

        const rows = await notificationRepository.queryNotifications({
            userId: normalizedCurrentUserId,
            filters: ['boop']
        });
        const matchingRows = rows.filter(
            (row) =>
                row?.type === 'boop' &&
                !row.expired &&
                row.link === `user:${rosterUserId}`
        );
        await Promise.allSettled(
            matchingRows.map(async (row) => {
                try {
                    await notificationRepository.hideRemoteNotification({
                        id: row.id,
                        version: row.version,
                        type: row.type,
                        senderUserId: row.senderUserId,
                        endpoint: currentEndpoint
                    });
                } finally {
                    await notificationRepository.expireNotification({
                        userId: normalizedCurrentUserId,
                        id: row.id
                    });
                }
            })
        );
    }

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

    async function unfriendUser() {
        const rosterUserId = normalizeUserId(profile?.id);
        const friend = friendsById[rosterUserId] || profile;
        if (
            !rosterUserId ||
            !isFriend ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        actionStatusRef.current = 'unfriend';
        setActionStatus('unfriend');
        const result = await confirm({
            title: appI18n.t('dialog.user.generated_modal.unfriend_user'),
            description: friend?.displayName || rosterUserId,
            confirmText: appI18n.t('dialog.user.generated_modal.unfriend'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            const deleteResult = await friendRelationshipService.deleteFriend({
                friend,
                userId: rosterUserId,
                endpoint: currentEndpoint,
                currentUserId
            });
            if (deleteResult.stale) {
                toast.info(
                    appI18n.t('dialog.user.generated.unfriend_request_sent_but_the_active_session_changed_before_')
                );
            } else {
                setBaseProfile((currentProfile) =>
                    currentProfile
                        ? {
                              ...currentProfile,
                              isFriend: false,
                              friendRequestStatus: ''
                          }
                        : currentProfile
                );
                toast.success(
                    appI18n.t('dialog.user.generated_dynamic.unfriended_value', { value: friend?.displayName || rosterUserId })
                );
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_unfriend_user')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateFriendRequest(action) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }
        const requestEndpoint = currentEndpoint;
        const requestProfile = profile;
        function commitFriendRequestPatch(patch) {
            if (
                activeUserTargetRef.current.userId !== rosterUserId ||
                activeUserTargetRef.current.endpoint !== requestEndpoint
            ) {
                return false;
            }
            setBaseProfile((currentProfile) =>
                normalizeUserId(currentProfile?.id) === rosterUserId
                    ? { ...currentProfile, ...patch }
                    : currentProfile
            );
            return true;
        }

        const isSendAction = action === 'send' || action === 'accept';
        const label =
            action === 'accept'
                ? 'Accept friend request'
                : action === 'decline'
                  ? 'Decline friend request'
                  : action === 'cancel'
                    ? 'Cancel friend request'
                    : 'Send friend request';

        actionStatusRef.current = `friend-request:${action}`;
        setActionStatus(actionStatusRef.current);
        const result = await confirm({
            title: appI18n.t('dialog.user.generated_dynamic.value', { value: label }),
            description: profile?.displayName || rosterUserId,
            confirmText:
                action === 'accept'
                    ? 'Accept'
                    : action === 'decline'
                      ? 'Decline'
                      : action === 'cancel'
                        ? 'Cancel Request'
                        : 'Send Request',
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: action === 'decline' || action === 'cancel'
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        let incomingNotification = null;
        try {
            if (isSendAction) {
                incomingNotification =
                    action === 'accept'
                        ? await findIncomingFriendRequestNotification(
                              rosterUserId
                          )
                        : null;
                if (action === 'accept' && !incomingNotification) {
                    if (
                        !commitFriendRequestPatch({
                            friendRequestStatus: '',
                            incomingRequest: false,
                            outgoingRequest: false
                        })
                    ) {
                        return;
                    }
                    toast.info(appI18n.t('dialog.user.generated.friend_request_is_no_longer_active'));
                    return;
                }
                const response =
                    action === 'accept'
                        ? await notificationRepository.acceptFriendRequest({
                              id: incomingNotification.id,
                              endpoint: requestEndpoint
                          })
                        : await vrchatFriendRepository.sendFriendRequest({
                              userId: rosterUserId,
                              endpoint: requestEndpoint
                          });
                if (incomingNotification) {
                    await notificationRepository.expireNotification({
                        userId: currentUserId,
                        id: incomingNotification.id
                    });
                }
                const isNowFriend = incomingNotification
                    ? true
                    : Boolean(response?.json?.success);
                if (
                    !commitFriendRequestPatch({
                        isFriend: isNowFriend,
                        friendRequestStatus: isNowFriend ? '' : 'outgoing',
                        incomingRequest: false,
                        outgoingRequest: !isNowFriend
                    })
                ) {
                    return;
                }
                if (isNowFriend) {
                    applyFriendPatch({
                        userId: rosterUserId,
                        patch: {
                            ...requestProfile,
                            id: rosterUserId,
                            isFriend: true,
                            friendRequestStatus: '',
                            incomingRequest: false,
                            outgoingRequest: false
                        },
                        stateBucket:
                            requestProfile?.stateBucket ||
                            requestProfile?.state ||
                            'offline'
                    });
                }
                if (action === 'send') {
                    recordDialogRecentAction(
                        rosterUserId,
                        'Send Friend Request'
                    );
                }
                toast.success(
                    isNowFriend
                        ? appI18n.t('dialog.user.generated_toast.friend_request_accepted')
                        : appI18n.t('dialog.user.generated_toast.friend_request_sent')
                );
            } else {
                incomingNotification =
                    action === 'decline'
                        ? await findIncomingFriendRequestNotification(
                              rosterUserId
                          )
                        : null;
                if (action === 'decline' && !incomingNotification) {
                    if (
                        !commitFriendRequestPatch({
                            friendRequestStatus: '',
                            incomingRequest: false,
                            outgoingRequest: false
                        })
                    ) {
                        return;
                    }
                    toast.info(appI18n.t('dialog.user.generated.friend_request_is_no_longer_active'));
                    return;
                }
                if (incomingNotification) {
                    await notificationRepository.hideRemoteNotification({
                        id: incomingNotification.id,
                        version: incomingNotification.version,
                        type: incomingNotification.type,
                        senderUserId: incomingNotification.senderUserId,
                        endpoint: requestEndpoint
                    });
                    await notificationRepository.expireNotification({
                        userId: currentUserId,
                        id: incomingNotification.id
                    });
                } else {
                    await vrchatFriendRepository.cancelFriendRequest({
                        userId: rosterUserId,
                        endpoint: requestEndpoint
                    });
                }
                if (
                    !commitFriendRequestPatch({
                        friendRequestStatus: '',
                        incomingRequest: false,
                        outgoingRequest: false
                    })
                ) {
                    return;
                }
                toast.success(
                    action === 'decline'
                        ? appI18n.t('dialog.user.generated_toast.friend_request_declined')
                        : appI18n.t('dialog.user.generated_toast.friend_request_cancelled')
                );
            }
        } catch (error) {
            if (
                (action === 'accept' || action === 'decline') &&
                incomingNotification &&
                error?.status === 404
            ) {
                await notificationRepository
                    .expireNotification({
                        userId: currentUserId,
                        id: incomingNotification.id
                    })
                    .catch(() => {});
                if (
                    !commitFriendRequestPatch({
                        friendRequestStatus: '',
                        incomingRequest: false,
                        outgoingRequest: false
                    })
                ) {
                    return;
                }
                toast.info(appI18n.t('dialog.user.generated.friend_request_is_no_longer_active'));
                return;
            }
            toast.error(
                error instanceof Error ? error.message : appI18n.t('dialog.user.generated_toast.value_failed', { value: label })
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

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
            title: appI18n.t('dialog.user.generated_dynamic.value_user', { value: label }),
            description: profile?.displayName || rosterUserId,
            confirmText: label,
            cancelText: appI18n.t('common.actions.cancel'),
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
            toast.success(appI18n.t('dialog.user.generated_dynamic.value_request_sent', { value: label }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_value_user', { value: label.toLowerCase() })
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
            title: appI18n.t('dialog.user.generated_dynamic.value', { value: label }),
            description: profile?.displayName || rosterUserId,
            confirmText: label,
            cancelText: appI18n.t('common.actions.cancel'),
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
            toast.success(appI18n.t('dialog.user.generated_dynamic.value_request_sent', { value: label }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_value', { value: label.toLowerCase() })
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
            toast.success(appI18n.t('dialog.user.generated_dynamic.value_updated', { value: label }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_update_avatar_moderation')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function reportHacking() {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const result = await confirm({
            title: appI18n.t('dialog.user.generated_modal.report_hacking'),
            description: profile?.displayName || rosterUserId,
            confirmText: appI18n.t('dialog.user.generated_modal.report'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'report-hacking';
        setActionStatus('report-hacking');
        try {
            await toolsRepository.reportUser(
                {
                    userId: rosterUserId,
                    contentType: 'user',
                    reason: 'behavior-hacking',
                    type: 'report'
                },
                { endpoint: currentEndpoint }
            );
            toast.success(appI18n.t('dialog.user.generated.report_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_report_user')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    function inviteMessageSlot(row) {
        const value =
            row?.slot ?? row?.messageSlot ?? row?.requestSlot ?? row?.id;
        return Number.parseInt(value, 10);
    }

    function buildInviteContext({ requireCurrentUser = false } = {}) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            !isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return null;
        }

        if (requireCurrentUser && !normalizedCurrentUserId) {
            toast.error(
                appI18n.t('dialog.user.generated.cannot_load_message_templates_no_current_user_session_is_ava')
            );
            return null;
        }

        if (!currentInviteLocation) {
            toast.error(
                appI18n.t('dialog.user.generated.cannot_invite_no_current_vrchat_location_is_available')
            );
            return null;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(appI18n.t('dialog.user.generated.cannot_invite_from_the_current_instance_type'));
            return null;
        }

        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                appI18n.t('dialog.user.generated.cannot_invite_current_location_is_not_a_concrete_instance')
            );
            return null;
        }

        return {
            rosterUserId,
            endpoint: currentEndpoint,
            messageOwnerUserId: normalizedCurrentUserId,
            parsedLocation,
            inviteLocation: parsedLocation.tag || currentInviteLocation,
            targetLabel: profile?.displayName || rosterUserId
        };
    }

    function buildInviteRequestContext({ requireCurrentUser = false } = {}) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            !isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return null;
        }

        if (requireCurrentUser && !normalizedCurrentUserId) {
            toast.error(
                appI18n.t('dialog.user.generated.cannot_load_message_templates_no_current_user_session_is_ava')
            );
            return null;
        }

        return {
            rosterUserId,
            endpoint: currentEndpoint,
            messageOwnerUserId: normalizedCurrentUserId,
            targetLabel: profile?.displayName || rosterUserId
        };
    }

    function recordDialogRecentAction(userId, actionType) {
        recordRecentAction(userId, actionType);
    }

    async function performSendUserInvite({
        messageSlot = null,
        context: contextSnapshot = null
    } = {}) {
        const context = contextSnapshot || buildInviteContext();
        if (!context) {
            return false;
        }
        if (actionStatusRef.current !== 'idle') {
            return false;
        }

        actionStatusRef.current = 'invite';
        setActionStatus('invite');
        try {
            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                context.parsedLocation.worldId,
                { endpoint: context.endpoint }
            );
            const params = {
                instanceId: context.inviteLocation,
                worldId: context.parsedLocation.worldId,
                worldName:
                    worldResponse.json?.name || context.parsedLocation.worldId,
                rsvp: true
            };
            if (messageSlot !== null) {
                params.messageSlot = messageSlot;
            }
            await notificationRepository.sendInvite({
                receiverUserId: context.rosterUserId,
                endpoint: context.endpoint,
                params
            });
            recordDialogRecentAction(
                context.rosterUserId,
                messageSlot !== null ? 'Invite Message' : 'Invite'
            );
            toast.success(
                messageSlot !== null ? appI18n.t('dialog.user.generated_toast.invite_message_sent') : appI18n.t('dialog.user.generated_toast.invite_sent')
            );
            return true;
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_send_invite')
            );
            return false;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function sendUserInvite({ withMessage = false } = {}) {
        if (withMessage) {
            const context = buildInviteContext({ requireCurrentUser: true });
            if (context) {
                setInviteMessageRequest({
                    kind: 'invite',
                    messageType: 'message',
                    context
                });
            }
            return;
        }

        const context = buildInviteContext();
        if (!context) {
            return;
        }

        const result = await confirm({
            title: appI18n.t('dialog.user.generated_modal.send_invite'),
            description: profile?.displayName || context.rosterUserId,
            confirmText: appI18n.t('dialog.user.generated_modal.invite'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        await performSendUserInvite({ context });
    }

    async function performSendUserInviteRequest({
        requestSlot = null,
        context: contextSnapshot = null
    } = {}) {
        const context = contextSnapshot || buildInviteRequestContext();
        if (!context) {
            return false;
        }
        if (actionStatusRef.current !== 'idle') {
            return false;
        }

        actionStatusRef.current = 'request-invite';
        setActionStatus('request-invite');
        try {
            const params = {
                platform: 'standalonewindows'
            };
            if (requestSlot !== null) {
                params.requestSlot = requestSlot;
            }
            await notificationRepository.sendRequestInvite({
                receiverUserId: context.rosterUserId,
                endpoint: context.endpoint,
                params
            });
            recordDialogRecentAction(
                context.rosterUserId,
                requestSlot !== null
                    ? 'Request Invite Message'
                    : 'Request Invite'
            );
            toast.success(
                requestSlot !== null
                    ? appI18n.t('dialog.user.generated_toast.invite_request_message_sent')
                    : appI18n.t('dialog.user.generated_toast.invite_request_sent')
            );
            return true;
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_request_invite')
            );
            return false;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function sendUserInviteRequest({ withMessage = false } = {}) {
        if (withMessage) {
            const context = buildInviteRequestContext({
                requireCurrentUser: true
            });
            if (context) {
                setInviteMessageRequest({
                    kind: 'request',
                    messageType: 'request',
                    context
                });
            }
            return;
        }

        const context = buildInviteRequestContext();
        if (!context) {
            return;
        }

        const result = await confirm({
            title: appI18n.t('dialog.user.generated_modal.request_invite'),
            description: profile?.displayName || context.rosterUserId,
            confirmText: appI18n.t('dialog.user.generated_modal.request_invite_2'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        await performSendUserInviteRequest({ context });
    }

    async function selectInviteMessage({ row }) {
        const slot = inviteMessageSlot(row);
        if (!Number.isFinite(slot)) {
            toast.error(appI18n.t('dialog.user.generated.invite_message_slot_must_be_a_number'));
            return false;
        }

        const request = inviteMessageRequest;
        const sent =
            request?.kind === 'request'
                ? await performSendUserInviteRequest({
                      requestSlot: slot,
                      context: request.context
                  })
                : await performSendUserInvite({
                      messageSlot: slot,
                      context: request?.context
                  });

        if (sent) {
            setInviteMessageRequest(null);
        }
        return sent;
    }

    async function sendUserBoop() {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            !isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        actionStatusRef.current = 'boop';
        setActionStatus('boop');
        try {
            const result = await prompt({
                title: appI18n.t('dialog.user.generated_modal.send_boop'),
                description:
                    appI18n.t('dialog.user.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'),
                inputValue: '',
                confirmText: appI18n.t('dialog.user.generated_modal.send'),
                cancelText: appI18n.t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }

            await dismissBoopNotifications(rosterUserId);
            await notificationRepository.sendBoop({
                userId: rosterUserId,
                emojiId: result.value,
                endpoint: currentEndpoint
            });
            toast.success(appI18n.t('dialog.user.generated.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : appI18n.t('dialog.user.generated_toast.failed_to_send_boop')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function openGroupModerationForUser() {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const result = await prompt({
            title: appI18n.t('dialog.user.generated_modal.group_moderation'),
            description: appI18n.t('dialog.user.generated_dynamic.enter_a_group_id_to_open_moderation_for_value', { value: profile?.displayName || rosterUserId }),
            inputValue: '',
            confirmText: appI18n.t('common.actions.open'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        const groupId = normalizeUserId(result.value);
        if (!groupId) {
            toast.error(appI18n.t('dialog.user.generated.group_id_is_required'));
            return;
        }
        openGroupDialog({ groupId });
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
    const handleInviteMessageDialogOpenChange = (nextOpen) => {
        if (!nextOpen && actionStatusRef.current === 'idle') {
            setInviteMessageRequest(null);
        }
    };

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
                onFriendRequest={(action) => void updateFriendRequest(action)}
                onInvite={() => void sendUserInvite()}
                onInviteMessage={() =>
                    void sendUserInvite({ withMessage: true })
                }
                onInviteRequest={() => void sendUserInviteRequest()}
                onInviteRequestMessage={() =>
                    void sendUserInviteRequest({ withMessage: true })
                }
                onBoop={() => void sendUserBoop()}
                onUnfriend={() => void unfriendUser()}
                onModeration={(type, enabled) =>
                    void setUserModeration(type, enabled)
                }
                onExtendedModeration={(type, enabled) =>
                    void setExtendedUserModeration(type, enabled)
                }
                onAvatarOverride={(type) =>
                    void setAvatarOverrideModeration(type)
                }
                onReportHacking={() => void reportHacking()}
                onGroupModeration={() => void openGroupModerationForUser()}
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
