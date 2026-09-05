import { useMemo } from 'react';

import type { GroupInstanceRecord } from '@/domain/entities/group';
import type { FriendRosterById } from '@/domain/friends/types';
import {
    groupInstanceGroupId,
    isOpenGroupInstance
} from '@/domain/instances/groupInstanceFacts';
import type { CurrentUserSnapshotState } from '@/state/runtimeStore';

import { mergeGroupInstances } from './groupInstances';

interface GroupDialogActiveInstancesInput {
    groupId: string;
    groupInstances: GroupInstanceRecord[];
    friendsById: FriendRosterById;
    currentUserSnapshot: CurrentUserSnapshotState | null;
    currentLocation: string;
}

export function useGroupDialogActiveInstances({
    groupId,
    groupInstances,
    friendsById,
    currentUserSnapshot,
    currentLocation
}: GroupDialogActiveInstancesInput) {
    const rawActiveInstances = useMemo(
        () =>
            groupInstances.filter(
                (instance) =>
                    isOpenGroupInstance(instance) &&
                    groupInstanceGroupId(instance) === groupId
            ),
        [groupId, groupInstances]
    );
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
        rawActiveInstances
    };
}
