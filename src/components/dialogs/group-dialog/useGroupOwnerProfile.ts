import { useEffect, useState } from 'react';

import type {
    GroupProfileRecord,
    UserProfileRecord
} from '@/domain/entities/profileEntities';
import type { FriendRosterById } from '@/domain/friends/friendRosterTypes';
import userProfileRepository from '@/repositories/userProfileRepository';

import { normalizeEntityId } from './groupInstances';

export function useGroupOwnerProfile({
    currentEndpoint,
    friendsById,
    group
}: {
    currentEndpoint: string;
    friendsById: FriendRosterById;
    group: GroupProfileRecord | null;
}) {
    const [ownerProfile, setOwnerProfile] = useState<UserProfileRecord | null>(
        null
    );

    useEffect(() => {
        let active = true;
        const ownerId = normalizeEntityId(group?.ownerId);
        setOwnerProfile(null);

        if (!ownerId || friendsById[ownerId]?.displayName) {
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
    }, [currentEndpoint, friendsById, group?.ownerId]);

    return ownerProfile;
}
