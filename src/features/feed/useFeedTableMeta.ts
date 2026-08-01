import { useMemo, useRef } from 'react';

import { useKnownUserFacts } from '@/lib/useKnownUser';

import { resolveFeedUserId } from './feedRows';
import type { FeedRow, FeedTableMeta } from './feedTypes';

type UseFeedTableMetaOptions = Omit<FeedTableMeta, 'knownUsersById'> & {
    rows: FeedRow[];
};

export function useFeedTableMeta({
    actions,
    friendLogNamesById,
    loadingPreviousInstancesKey,
    onOpenPreviousInstances,
    rows
}: UseFeedTableMetaOptions): FeedTableMeta {
    const rowUserIds = useMemo(
        () => rows.map(resolveFeedUserId).filter(Boolean),
        [rows]
    );
    const knownUsersById = useKnownUserFacts(rowUserIds);
    const nextMeta: FeedTableMeta = {
        actions,
        friendLogNamesById,
        knownUsersById,
        loadingPreviousInstancesKey,
        onOpenPreviousInstances
    };
    const metaRef = useRef(nextMeta);

    return Object.assign(metaRef.current, nextMeta);
}
