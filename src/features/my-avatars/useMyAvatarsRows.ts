import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import myAvatarRepository from '@/repositories/myAvatarRepository';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { MyAvatarRow, MyAvatarsLoadStatus } from './myAvatarsTypes';

export function useMyAvatarsRows() {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';
    const previousAvatarSwapTime =
        Number(currentUserSnapshot?.$previousAvatarSwapTime) || 0;
    const requestIdRef = useRef(0);
    const [avatars, setAvatars] = useState<MyAvatarRow[]>([]);
    const [loadStatus, setLoadStatus] = useState<MyAvatarsLoadStatus>('idle');
    const [detail, setDetail] = useState('');
    const [refreshToken, setRefreshToken] = useState(0);

    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        if (!currentUserId) {
            setAvatars([]);
            setLoadStatus('idle');
            setDetail(
                t(
                    'view.my_avatars.empty.no_authenticated_user_is_available_for_the_avatar_inventory'
                )
            );
            return;
        }
        setLoadStatus('running');
        setDetail('');
        myAvatarRepository
            .getMyAvatars({
                currentUserId,
                currentAvatarId,
                previousAvatarSwapTime
            })
            .then((nextAvatars) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                setAvatars(Array.isArray(nextAvatars) ? nextAvatars : []);
                setLoadStatus('ready');
                setDetail('');
            })
            .catch((error: unknown) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                console.warn('Avatar inventory failed to load:', error);
                setAvatars([]);
                setLoadStatus('error');
                setDetail(
                    userFacingErrorMessage(
                        error,
                        t(
                            'view.my_avatars.error.avatar_inventory_failed_to_load'
                        )
                    )
                );
            });
    }, [
        currentAvatarId,
        currentEndpoint,
        currentUserId,
        previousAvatarSwapTime,
        refreshToken
    ]);

    function refresh() {
        setRefreshToken((value) => value + 1);
    }

    return {
        avatars,
        detail,
        loadStatus,
        refresh,
        setAvatars,
        setDetail
    };
}
