// @ts-nocheck
import { MyAvatarsPageView } from './components/MyAvatarsPageView';
import { useMyAvatarsPageController } from './useMyAvatarsPageController.js';

export function MyAvatarsPage({ embedded = false } = {}) {
    const viewProps = useMyAvatarsPageController({ embedded });

    return <MyAvatarsPageView {...viewProps} />;
}
