import type { FeedLiveStoreState } from '@/state/feedLiveStore';
import { useFeedLiveStore } from '@/state/feedLiveStore';

const FEED_LIVE_MERGE_WINDOW_MS = 250;

type FeedLiveMergeScheduler = {
    schedule(): void;
    cancel(): void;
};

function createFeedLiveMergeScheduler(
    runMerge: () => void
): FeedLiveMergeScheduler {
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let pending = false;

    function openWindow() {
        timerId = setTimeout(() => {
            timerId = null;
            if (!pending) {
                return;
            }
            pending = false;
            runMerge();
            openWindow();
        }, FEED_LIVE_MERGE_WINDOW_MS);
    }

    return {
        schedule() {
            if (timerId !== null) {
                pending = true;
                return;
            }
            runMerge();
            openWindow();
        },
        cancel() {
            if (timerId !== null) {
                clearTimeout(timerId);
                timerId = null;
            }
            pending = false;
        }
    };
}

export function subscribeFeedLiveMerge(
    runMerge: () => void,
    shouldMerge?: (state: FeedLiveStoreState) => boolean
): () => void {
    const scheduler = createFeedLiveMergeScheduler(runMerge);
    const unsubscribe = useFeedLiveStore.subscribe((state, previousState) => {
        if (
            state.version === previousState?.version ||
            state.entries.length === 0 ||
            (shouldMerge && !shouldMerge(state))
        ) {
            return;
        }
        scheduler.schedule();
    });
    return () => {
        scheduler.cancel();
        unsubscribe();
    };
}
