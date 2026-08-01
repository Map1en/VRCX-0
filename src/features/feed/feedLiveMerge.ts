import type { FeedReadModelResult } from '@/domain/feed/feedReadModelTypes';
import type { FeedLiveRowsMergeOptions } from '@/repositories/feedRepository';
import feedRepository from '@/repositories/feedRepository';
import type { FeedLiveEntry } from '@/state/feedLiveStore';
import { useFeedLiveStore } from '@/state/feedLiveStore';

import type { FeedRow } from './feedTypes';

export type FeedLiveMergeOptionsBuilder = (input: {
    liveEntries: FeedLiveEntry[];
    minLiveSequence: number;
    rows: FeedRow[];
}) => FeedLiveRowsMergeOptions;

export async function mergeFeedRowsWithLiveEntries({
    buildMergeOptions,
    minLiveSequence,
    requestIsCurrent,
    rows
}: {
    buildMergeOptions: FeedLiveMergeOptionsBuilder;
    minLiveSequence: number;
    requestIsCurrent(): boolean;
    rows: FeedRow[];
}): Promise<FeedReadModelResult<FeedRow> | null> {
    let result: FeedReadModelResult<FeedRow> = {
        rows,
        maxSequence: minLiveSequence
    };
    let previousMaxSequence = minLiveSequence;
    while (requestIsCurrent()) {
        const liveSnapshot = useFeedLiveStore.getState();
        result = await feedRepository.mergeLiveRows(
            buildMergeOptions({
                liveEntries: liveSnapshot.entries,
                minLiveSequence: result.maxSequence,
                rows: result.rows
            })
        );
        if (!requestIsCurrent()) {
            return null;
        }
        const liveVersion = useFeedLiveStore.getState().version;
        if (
            liveVersion <= result.maxSequence ||
            result.maxSequence <= previousMaxSequence
        ) {
            return result;
        }
        previousMaxSequence = result.maxSequence;
    }
    return null;
}

export async function prepareFeedRowsForCommit({
    buildMergeOptions,
    onMergeRound,
    requestIsCurrent,
    result
}: {
    buildMergeOptions: FeedLiveMergeOptionsBuilder;
    onMergeRound(): void;
    requestIsCurrent(): boolean;
    result: FeedReadModelResult<FeedRow>;
}): Promise<FeedReadModelResult<FeedRow> | null> {
    let nextResult = result;
    while (requestIsCurrent()) {
        onMergeRound();
        if (useFeedLiveStore.getState().version <= nextResult.maxSequence) {
            return nextResult;
        }
        const mergedResult = await mergeFeedRowsWithLiveEntries({
            buildMergeOptions,
            minLiveSequence: nextResult.maxSequence,
            requestIsCurrent,
            rows: nextResult.rows
        });
        if (!mergedResult) {
            return null;
        }
        nextResult = mergedResult;
    }
    return null;
}
