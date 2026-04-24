import { useMemo, useState } from 'react';

import { mergeGroupInstances } from './groupInstances.js';

export function useGroupDialogActiveInstances({
    groupId,
    friendsById,
    currentUserSnapshot,
    currentLocation
}) {
    const [rawActiveInstances, setRawActiveInstances] = useState([]);
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
