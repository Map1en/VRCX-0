import { useRef } from 'react';

import { getFeedRowId } from './feedRows';
import type { FeedLoadStatus, FeedRow } from './feedTypes';

const ARRIVAL_TTL_MS = 4000;

export function useFeedRowArrivals(
    rows: FeedRow[],
    loadStatus: FeedLoadStatus
): Set<string> {
    const seenIdsRef = useRef<Set<string>>(new Set());
    const arrivedAtRef = useRef<Map<string, number>>(new Map());
    const arrivalsRef = useRef<Set<string>>(new Set());
    const lastRowsRef = useRef<FeedRow[] | null>(null);
    const previousLoadStatusRef = useRef<FeedLoadStatus>(loadStatus);

    const arrivedAt = arrivedAtRef.current;
    const now = Date.now();
    let changed = false;

    for (const [id, timestamp] of arrivedAt) {
        if (now - timestamp > ARRIVAL_TTL_MS) {
            arrivedAt.delete(id);
            changed = true;
        }
    }

    if (
        lastRowsRef.current !== rows ||
        previousLoadStatusRef.current !== loadStatus
    ) {
        const previousLoadStatus = previousLoadStatusRef.current;
        lastRowsRef.current = rows;
        previousLoadStatusRef.current = loadStatus;

        const seenIds = seenIdsRef.current;
        const isFullQueryPath =
            loadStatus !== 'ready' || previousLoadStatus !== 'ready';
        const isFirstLoad = seenIds.size === 0;

        if (isFullQueryPath || isFirstLoad) {
            for (const row of rows) {
                seenIds.add(getFeedRowId(row));
            }
        } else {
            for (const row of rows) {
                const id = getFeedRowId(row);
                if (!seenIds.has(id)) {
                    seenIds.add(id);
                    arrivedAt.set(id, now);
                    changed = true;
                }
            }
        }
    }

    if (changed) {
        arrivalsRef.current = new Set(arrivedAt.keys());
    }

    return arrivalsRef.current;
}
