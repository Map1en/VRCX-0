import { useEffect, useMemo, useRef, useState } from 'react';

import userProfileRepository from '@/repositories/userProfileRepository';
import {
    buildCurrentUserPresenceView,
    mergeCurrentUserPresenceFields,
    type CurrentUserPresenceGameState
} from '@/shared/utils/currentUserPresence';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import {
    getCurrentAvatarDetails,
    mergeCurrentAvatarProfile,
    mergeCurrentUserAvatarFields,
    normalizedAvatarName,
    shouldHydrateCurrentAvatar
} from './userDialogCurrentAvatar';
import { mergeUserDialogProfileAppearance } from './userDialogProfileAppearance';
import {
    mergeActivityTimestampsIntoProfile,
    mergeLocalSnapshotIntoProfile,
    mergeSnapshotIntoCurrentProfile,
    normalizeTargetSnapshot,
    overlayFriendPresence,
    preserveProfileIdentity,
    previousTargetProfile,
    profileMatchesTarget,
    stripSyntheticSnapshotDefaults
} from './userDialogProfileSnapshot';
import type {
    ActiveUserTarget,
    UserDialogProfileLoadStatus,
    UserDialogProfileSnapshot,
    UseUserDialogProfileResourceInput
} from './userDialogProfileTypes';
import { normalizeUserId } from './userProfileFields';

export type { UserDialogProfileRecord } from './userDialogProfileTypes';
export {
    mergeLocalSnapshotIntoProfile,
    mergeUserDialogLocalSnapshot
} from './userDialogProfileSnapshot';

export function useUserDialogProfileResource({
    activitySnapshot = null,
    currentEndpoint,
    currentUserSnapshot,
    gameLogDisabled,
    gameState,
    isFriend = false,
    isTargetCurrentUser,
    localSnapshot,
    normalizedUserId,
    updateEntityDialogMetadata
}: UseUserDialogProfileResourceInput) {
    const normalizedLocalSnapshot = useMemo(
        () => normalizeTargetSnapshot(localSnapshot, normalizedUserId),
        [localSnapshot, normalizedUserId]
    );
    const currentUserPresenceSnapshot = useMemo(
        () =>
            normalizeTargetSnapshot(currentUserSnapshot, normalizedUserId, {
                allowMissingId: false
            }),
        [currentUserSnapshot, normalizedUserId]
    );
    const normalizedActivitySnapshot = useMemo(
        () => normalizeTargetSnapshot(activitySnapshot, normalizedUserId),
        [activitySnapshot, normalizedUserId]
    );
    const normalizedGameState = useMemo<CurrentUserPresenceGameState | null>(
        () =>
            gameState
                ? {
                      ...gameState,
                      isGameRunning: gameState.isGameRunning === true
                  }
                : null,
        [gameState]
    );
    const localSnapshotRef = useRef(normalizedLocalSnapshot);
    localSnapshotRef.current = normalizedLocalSnapshot;
    const activitySnapshotRef = useRef(normalizedActivitySnapshot);
    activitySnapshotRef.current = normalizedActivitySnapshot;
    const avatarHydrationKeyRef = useRef('');
    const [baseProfile, setBaseProfile] = useState<UserDialogProfileSnapshot>(
        () => normalizedLocalSnapshot
    );
    const activeBaseProfile = useMemo(
        () =>
            profileMatchesTarget(baseProfile, normalizedUserId)
                ? baseProfile
                : normalizedLocalSnapshot,
        [baseProfile, normalizedLocalSnapshot, normalizedUserId]
    );
    const friendPresenceSource = useFriendRosterStore((state) =>
        isFriend && !isTargetCurrentUser
            ? state.friendsById[normalizedUserId] || null
            : null
    );
    const profile = useMemo(() => {
        const base = isTargetCurrentUser
            ? buildCurrentUserPresenceView(activeBaseProfile, {
                  currentUserSnapshot: currentUserPresenceSnapshot,
                  gameState: normalizedGameState,
                  gameLogDisabled
              })
            : activeBaseProfile;
        return overlayFriendPresence(base, friendPresenceSource);
    }, [
        activeBaseProfile,
        currentUserPresenceSnapshot,
        gameLogDisabled,
        isTargetCurrentUser,
        friendPresenceSource,
        normalizedGameState
    ]);
    const profileRef = useRef(profile);
    profileRef.current = profile;
    const [loadStatus, setLoadStatus] = useState<UserDialogProfileLoadStatus>(
        normalizedUserId ? 'running' : 'idle'
    );
    const [reloadToken, setReloadToken] = useState(0);
    const [detail, setDetail] = useState('');
    const activeUserTargetRef = useRef<ActiveUserTarget>({
        userId: normalizedUserId,
        endpoint: currentEndpoint
    });
    activeUserTargetRef.current.userId = normalizedUserId;
    activeUserTargetRef.current.endpoint = currentEndpoint;

    const effectiveLoadStatus =
        normalizedUserId && !profile && loadStatus !== 'error'
            ? 'running'
            : loadStatus;

    useEffect(() => {
        if (normalizedLocalSnapshot) {
            setBaseProfile((currentProfile) =>
                mergeSnapshotIntoCurrentProfile({
                    currentProfile,
                    isTargetCurrentUser,
                    snapshot: normalizedLocalSnapshot,
                    targetUserId: normalizedUserId
                })
            );
        } else if (!normalizedUserId) {
            setBaseProfile(null);
        }
    }, [isTargetCurrentUser, normalizedLocalSnapshot, normalizedUserId]);

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
        setBaseProfile((currentProfile) =>
            mergeSnapshotIntoCurrentProfile({
                currentProfile,
                isTargetCurrentUser,
                snapshot,
                targetUserId: normalizedUserId
            })
        );
        setLoadStatus('running');
        setDetail('');

        const appearanceProfileRequest = userProfileRepository
            .getUserAppearanceProfile({
                userId: normalizedUserId,
                asSelf: isTargetCurrentUser
            })
            .catch(() => null);

        userProfileRepository
            .getUserProfile({
                userId: normalizedUserId,
                force: isTargetCurrentUser || reloadToken > 0,
                dialog: true,
                isFriend
            })
            .then((nextProfile) => {
                if (!active) {
                    return;
                }
                const remoteProfile = stripSyntheticSnapshotDefaults(
                    nextProfile,
                    {}
                );

                setBaseProfile((currentProfile) =>
                    preserveProfileIdentity(
                        currentProfile,
                        mergeActivityTimestampsIntoProfile(
                            (() => {
                                const previousProfile = previousTargetProfile(
                                    currentProfile,
                                    normalizedUserId
                                );
                                return isTargetCurrentUser
                                    ? mergeCurrentUserAvatarFields(
                                          mergeCurrentUserPresenceFields(
                                              remoteProfile,
                                              previousProfile
                                          ),
                                          previousProfile
                                      )
                                    : mergeLocalSnapshotIntoProfile(
                                          localSnapshotRef.current,
                                          remoteProfile
                                      );
                            })(),
                            activitySnapshotRef.current
                        ),
                        normalizedUserId
                    )
                );
                setLoadStatus('ready');

                appearanceProfileRequest.then((appearanceProfile) => {
                    if (!active || !appearanceProfile) {
                        return;
                    }
                    setBaseProfile((currentProfile) => {
                        const targetProfile = previousTargetProfile(
                            currentProfile,
                            normalizedUserId
                        );
                        if (!targetProfile) {
                            return currentProfile;
                        }
                        return preserveProfileIdentity(
                            currentProfile,
                            mergeUserDialogProfileAppearance(
                                targetProfile,
                                appearanceProfile,
                                normalizedUserId
                            ),
                            normalizedUserId
                        );
                    });
                });
            })
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }

                const fallbackSnapshot = localSnapshotRef.current;
                if (fallbackSnapshot) {
                    setBaseProfile((currentProfile) =>
                        mergeSnapshotIntoCurrentProfile({
                            currentProfile,
                            isTargetCurrentUser,
                            snapshot: fallbackSnapshot,
                            targetUserId: normalizedUserId
                        })
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
    }, [currentEndpoint, isTargetCurrentUser, normalizedUserId, reloadToken]);

    useEffect(() => {
        if (!isTargetCurrentUser || !shouldHydrateCurrentAvatar(profile)) {
            return undefined;
        }

        const currentAvatar = normalizeUserId(profile?.currentAvatar);
        const currentAvatarImageUrl =
            normalizedAvatarName(profile?.currentAvatarImageUrl) ||
            normalizedAvatarName(profile?.currentAvatarThumbnailImageUrl);
        const hydrationKey = `${currentEndpoint || ''}\u0000${normalizedUserId || ''}\u0000${currentAvatar}\u0000${currentAvatarImageUrl}\u0000${reloadToken}`;
        if (avatarHydrationKeyRef.current === hydrationKey) {
            return undefined;
        }
        avatarHydrationKeyRef.current = hydrationKey;

        let active = true;
        getCurrentAvatarDetails({
            avatarId: currentAvatar,
            currentUserId: normalizedUserId,
            profile
        })
            .then((avatar) => {
                if (!active) {
                    return;
                }
                setBaseProfile((currentProfile) =>
                    preserveProfileIdentity(
                        currentProfile,
                        mergeCurrentAvatarProfile(
                            previousTargetProfile(
                                currentProfile,
                                normalizedUserId
                            ) ||
                                profileRef.current ||
                                profile,
                            avatar
                        ),
                        normalizedUserId
                    )
                );
            })
            .catch(() => {});

        return () => {
            active = false;
            if (avatarHydrationKeyRef.current === hydrationKey) {
                avatarHydrationKeyRef.current = '';
            }
        };
    }, [
        currentEndpoint,
        isTargetCurrentUser,
        normalizedUserId,
        profile?.avatarName,
        profile?.currentAvatar,
        profile?.currentAvatarImageUrl,
        profile?.currentAvatarName,
        profile?.currentAvatarThumbnailImageUrl,
        reloadToken
    ]);

    function refreshProfile() {
        setReloadToken((value) => value + 1);
    }

    return {
        activeUserTargetRef,
        baseProfile: activeBaseProfile,
        detail,
        loadStatus: effectiveLoadStatus,
        profile,
        refreshProfile,
        reloadToken,
        setBaseProfile
    };
}
