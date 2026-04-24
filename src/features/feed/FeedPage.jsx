import { FeedPageView } from './components/FeedPageView.jsx';
import { useFeedPageController } from './useFeedPageController.js';

export function FeedPage({ embedded = false } = {}) {
    const viewProps = useFeedPageController({ embedded });

    return <FeedPageView {...viewProps} />;
}
