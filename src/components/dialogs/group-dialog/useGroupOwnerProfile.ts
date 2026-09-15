import { useEffect, useState } from 'react';

import type { GroupProfileRecord } from '@/domain/entities/group';
import type { UserProfileRecord } from '@/domain/entities/user';
import type { FriendRosterById } from '@/domain/friends/types';
import userProfileRepository from '@/repositories/userProfileRepository';
import { normalizeString } from '@/shared/utils/string';

export function useGroupOwnerProfile({
    currentEndpoint,
    friendsById,
    group
}: {
    currentEndpoint: string;
    friendsById: FriendRosterById;
    group: Pick<GroupProfileRecord, 'ownerDisplayName' | 'ownerId'> | null;
}) {
    const [ownerProfile, setOwnerProfile] = useState<UserProfileRecord | null>(
        null
    );

    useEffect(() => {
        let active = true;
        const ownerId = normalizeString(group?.ownerId);
        setOwnerProfile(null);

        if (
            !ownerId ||
            group?.ownerDisplayName ||
            friendsById[ownerId]?.displayName
        ) {
            return () => {
                active = false;
            };
        }

        userProfileRepository
            .getUserProfile({
                userId: ownerId
            })
            .then((profile) => {
                if (active) {
                    setOwnerProfile(profile);
                }
            })
            .catch(() => {
                if (active) {
                    setOwnerProfile(null);
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, friendsById, group?.ownerDisplayName, group?.ownerId]);

    return ownerProfile;
}
