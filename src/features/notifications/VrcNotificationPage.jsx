import { VrcNotificationPageView } from './components/VrcNotificationPageView.jsx';
import { useVrcNotificationPageController } from './useVrcNotificationPageController.js';

export function VrcNotificationPage({ embedded = false } = {}) {
    const viewProps = useVrcNotificationPageController({ embedded });

    return <VrcNotificationPageView {...viewProps} />;
}
