import { useEffect, useRef, useState } from 'react';

import { backend } from '@/platform/index.js';
import {
    userSessionRepository,
    vrchatModerationRepository
} from '@/repositories/index.js';

export function useUserDialogModerationState({
    currentEndpoint,
    currentUserId,
    isTargetCurrentUser,
    normalizedCurrentUserId,
    normalizedUserId,
    reloadToken
}) {
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
    const moderationRevisionRef = useRef(0);

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
    }, [currentUserId, normalizedUserId, reloadToken]);

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

    return {
        avatarOverrideState,
        extendedModerationState,
        moderationRevisionRef,
        moderationState,
        setAvatarOverrideState,
        setExtendedModerationState,
        setModerationState
    };
}
