import { useEffect, useState } from 'react';

import userProfileRepository from '@/repositories/userProfileRepository';

import { normalizeEntityId } from './groupInstances';

export function useGroupOwnerProfile({
    currentEndpoint,
    friendsById,
    group
}: any) {
    const [ownerProfile, setOwnerProfile] = useState(null);

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
                userId: ownerId,
                endpoint: currentEndpoint
            })
            .then((profile: any) => {
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
