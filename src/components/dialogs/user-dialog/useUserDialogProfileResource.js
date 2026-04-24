import { useEffect, useMemo, useRef, useState } from 'react';

import {
    buildCurrentUserPresenceView,
    mergeCurrentUserPresenceFields
} from '@/shared/utils/currentUserPresence.js';
import { userProfileRepository } from '@/repositories/index.js';

import { normalizeUserId } from './userProfileFields.js';

export function useUserDialogProfileResource({
    currentEndpoint,
    currentUserSnapshot,
    gameLogDisabled,
    gameState,
    isTargetCurrentUser,
    localSnapshot,
    normalizedUserId,
    updateEntityDialogMetadata
}) {
    const localSnapshotRef = useRef(localSnapshot);
    localSnapshotRef.current = localSnapshot;
    const [baseProfile, setBaseProfile] = useState(() =>
        localSnapshot ? userProfileRepository.normalize(localSnapshot) : null
    );
    const profile = useMemo(
        () =>
            isTargetCurrentUser
                ? buildCurrentUserPresenceView(baseProfile, {
                      currentUserSnapshot,
                      gameState,
                      gameLogDisabled
                  })
                : baseProfile,
        [
            baseProfile,
            currentUserSnapshot,
            gameState?.currentDestination,
            gameState?.currentLocation,
            gameState?.currentWorldId,
            gameState?.isGameRunning,
            gameLogDisabled,
            isTargetCurrentUser
        ]
    );
    const [loadStatus, setLoadStatus] = useState(
        normalizedUserId ? 'running' : 'idle'
    );
    const [reloadToken, setReloadToken] = useState(0);
    const [detail, setDetail] = useState('');
    const activeUserTargetRef = useRef({
        userId: normalizedUserId,
        endpoint: currentEndpoint
    });

    useEffect(() => {
        activeUserTargetRef.current = {
            userId: normalizedUserId,
            endpoint: currentEndpoint
        };
    }, [currentEndpoint, normalizedUserId]);

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
        setLoadStatus('running');
        setDetail('');

        userProfileRepository
            .getUserProfile({
                userId: normalizedUserId,
                endpoint: currentEndpoint,
                force: reloadToken > 0,
                dialog: true
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
        reloadToken
    ]);

    function refreshProfile() {
        setReloadToken((value) => value + 1);
    }

    return {
        activeUserTargetRef,
        baseProfile,
        detail,
        loadStatus,
        profile,
        refreshProfile,
        reloadToken,
        setBaseProfile
    };
}
