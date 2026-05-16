// @ts-nocheck
import { FeedPageView } from './components/FeedPageView';
import { useFeedPageController } from './useFeedPageController.js';

export function FeedPage({ embedded = false } = {}) {
    const viewProps = useFeedPageController({ embedded });

    return <FeedPageView {...viewProps} />;
}
