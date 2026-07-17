import { useMemo, useState } from 'react';

import type { GroupInstanceRecord } from '@/domain/entities/profileEntities';
import type { FriendRosterById } from '@/domain/friends/friendRosterTypes';
import type { CurrentUserSnapshotState } from '@/state/runtimeStore';

import { mergeGroupInstances } from './groupInstances';

interface GroupDialogActiveInstancesInput {
    groupId: unknown;
    friendsById: FriendRosterById;
    currentUserSnapshot: CurrentUserSnapshotState | null;
    currentLocation: unknown;
}

export function useGroupDialogActiveInstances({
    groupId,
    friendsById,
    currentUserSnapshot,
    currentLocation
}: GroupDialogActiveInstancesInput) {
    const [rawActiveInstances, setRawActiveInstances] = useState<
        GroupInstanceRecord[]
    >([]);
    const activeInstances = useMemo(
        () =>
            mergeGroupInstances(rawActiveInstances, {
                groupId,
                friendsById,
                currentUserSnapshot,
                currentLocation
            }),
        [
            currentLocation,
            currentUserSnapshot,
            friendsById,
            groupId,
            rawActiveInstances
        ]
    );

    return {
        activeInstances,
        setRawActiveInstances
    };
}
