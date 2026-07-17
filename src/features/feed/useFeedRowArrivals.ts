import { useEffect, useRef, useState } from 'react';

import { getFeedRowId } from './feedRows';
import type { FeedLoadStatus, FeedRow } from './feedTypes';

const ARRIVAL_TTL_MS = 4000;

export function useFeedRowArrivals(
    rows: FeedRow[],
    loadStatus: FeedLoadStatus
) {
    const seenIdsRef = useRef<Set<string>>(new Set());
    const arrivedAtRef = useRef<Map<string, number>>(new Map());
    const previousLoadStatusRef = useRef<FeedLoadStatus>(loadStatus);
    const [arrivals, setArrivals] = useState<Set<string>>(new Set());

    useEffect(() => {
        const previousLoadStatus = previousLoadStatusRef.current;
        previousLoadStatusRef.current = loadStatus;

        const seenIds = seenIdsRef.current;
        const arrivedAt = arrivedAtRef.current;
        const now = Date.now();
        let changed = false;

        for (const [id, timestamp] of arrivedAt) {
            if (now - timestamp > ARRIVAL_TTL_MS) {
                arrivedAt.delete(id);
                changed = true;
            }
        }

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

        if (changed) {
            setArrivals(new Set(arrivedAt.keys()));
        }

        if (arrivedAt.size === 0) {
            return undefined;
        }
        const timeoutId = window.setTimeout(() => {
            const cutoff = Date.now();
            for (const [id, timestamp] of arrivedAt) {
                if (cutoff - timestamp > ARRIVAL_TTL_MS) {
                    arrivedAt.delete(id);
                }
            }
            setArrivals(new Set(arrivedAt.keys()));
        }, ARRIVAL_TTL_MS + 100);
        return () => window.clearTimeout(timeoutId);
    }, [loadStatus, rows]);

    return arrivals;
}
