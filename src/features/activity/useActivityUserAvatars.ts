import { useEffect, useRef, useState } from 'react';

import userProfileRepository from '@/repositories/userProfileRepository';
import { userImage } from '@/services/entityMediaService';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import { resolveMissingEntities } from './resolveMissingEntities';

export function useActivityUserAvatars(
    userIds: string[]
): (userId: string) => string {
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const [fetched, setFetched] = useState<Map<string, string>>(new Map());
    const resolvedRef = useRef(new Set<string>());
    const pendingRef = useRef(new Map<string, Promise<string | null>>());
    const userIdsKey = userIds
        .filter((userId) => !userImage(friendsById[userId], 128))
        .join(',');

    useEffect(() => {
        const ids = (userIdsKey ? userIdsKey.split(',') : []).filter(
            (userId) => userId && !resolvedRef.current.has(userId)
        );
        if (ids.length === 0) {
            return;
        }
        let active = true;

        void resolveMissingEntities({
            ids,
            isActive: () => active,
            fetchOne: (userId) => {
                let pending = pendingRef.current.get(userId);
                if (!pending) {
                    pending = userProfileRepository
                        .getUserProfile({ userId })
                        .then((profile) => userImage(profile, 128) || null)
                        .finally(() => pendingRef.current.delete(userId));
                    pendingRef.current.set(userId, pending);
                }
                return pending;
            },
            onResolved: (userId, image) => {
                resolvedRef.current.add(userId);
                setFetched((previous) => new Map(previous).set(userId, image));
            }
        });

        return () => {
            active = false;
        };
    }, [userIdsKey]);

    return (userId: string) => {
        const friend = friendsById[userId];
        if (friend) {
            const image = userImage(friend, 128);
            if (image) {
                return image;
            }
        }
        return fetched.get(userId) ?? '';
    };
}
