// @ts-nocheck
import { VrcNotificationPageView } from './components/VrcNotificationPageView';
import { useVrcNotificationPageController } from './useVrcNotificationPageController.js';

export function VrcNotificationPage({ embedded = false } = {}) {
    const viewProps = useVrcNotificationPageController({ embedded });

    return <VrcNotificationPageView {...viewProps} />;
}
