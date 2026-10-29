import { useEffect, useMemo, useRef, useState } from 'react';

import { userActivityViewService } from '@/services/userActivityViewService';

import {
    normalizeHeatmapBuckets,
    rangeDaysFor,
    type ActivityRange
} from './activityPageModel';

type ActivityHeatmap = {
    rawBuckets: number[];
    normalizedBuckets: number[];
};

const EMPTY_BUCKETS: number[] = [];

export function useActivityHeatmap(
    ownerUserId: string,
    range: ActivityRange
): ActivityHeatmap {
    const [rawBuckets, setRawBuckets] = useState<number[]>(EMPTY_BUCKETS);
    const requestIdRef = useRef(0);

    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        if (!ownerUserId) {
            setRawBuckets(EMPTY_BUCKETS);
            return;
        }
        void userActivityViewService
            .loadActivityView({
                userId: ownerUserId,
                ownerUserId,
                isSelf: true,
                rangeDays: rangeDaysFor(range),
                dayLabels: []
            })
            .then((view) => {
                if (requestIdRef.current === requestId) {
                    setRawBuckets(view.rawBuckets);
                }
            })
            .catch(() => {
                if (requestIdRef.current === requestId) {
                    setRawBuckets(EMPTY_BUCKETS);
                }
            });
    }, [ownerUserId, range]);

    const normalizedBuckets = useMemo(
        () => normalizeHeatmapBuckets(rawBuckets),
        [rawBuckets]
    );

    return { rawBuckets, normalizedBuckets };
}
