import { useEffect, useState } from 'react';

import mutualGraphPersistenceRepository from '@/repositories/mutualGraphPersistenceRepository';

export function useMutualFriendsSnapshot({
    currentUserId,
    currentUserIdRef,
    reloadToken
}: any) {
    const [status, setStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [snapshotData, setSnapshotData] = useState<any>({
        snapshot: new Map(),
        meta: new Map()
    });

    useEffect(() => {
        let active = true;

        if (!currentUserId) {
            setStatus('idle');
            setSnapshotData({ snapshot: new Map(), meta: new Map() });
            return () => {
                active = false;
            };
        }

        setStatus('running');
        setDetail('');

        mutualGraphPersistenceRepository
            .getSnapshot(currentUserId)
            .then((result: any) => {
                if (!active) {
                    return;
                }

                setSnapshotData(result);
                setStatus('ready');
                setDetail(
                    'Reading the cached mutual-friends graph from the local database.'
                );
            })
            .catch((error: any) => {
                if (!active) {
                    return;
                }

                setStatus('error');
                setSnapshotData({ snapshot: new Map(), meta: new Map() });
                setDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load the mutual-friends graph cache.'
                );
            });

        return () => {
            active = false;
        };
    }, [currentUserId, reloadToken]);

    async function reloadSnapshot(
        nextDetail: any,
        expectedUserId: any = currentUserId
    ) {
        if (!expectedUserId || currentUserIdRef.current !== expectedUserId) {
            return;
        }

        setStatus('running');
        try {
            const result =
                await mutualGraphPersistenceRepository.getSnapshot(
                    expectedUserId
                );
            if (currentUserIdRef.current !== expectedUserId) {
                return;
            }
            setSnapshotData(result);
            setStatus('ready');
            setDetail(
                nextDetail ||
                    'Reading the cached mutual-friends graph from the local database.'
            );
        } catch (error) {
            setSnapshotData({ snapshot: new Map(), meta: new Map() });
            setStatus('error');
            setDetail(
                error instanceof Error
                    ? error.message
                    : 'Failed to load the mutual-friends graph cache.'
            );
        }
    }

    return {
        detail,
        reloadSnapshot,
        setDetail,
        setStatus,
        snapshotData,
        status
    };
}
