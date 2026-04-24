import { MyAvatarsPageView } from './components/MyAvatarsPageView.jsx';
import { useMyAvatarsPageController } from './useMyAvatarsPageController.js';

export function MyAvatarsPage({ embedded = false } = {}) {
    const viewProps = useMyAvatarsPageController({ embedded });

    return <MyAvatarsPageView {...viewProps} />;
}
