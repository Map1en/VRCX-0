import { ModerationPageView } from './components/ModerationPageView.jsx';
import { useModerationPageController } from './useModerationPageController.js';

export function ModerationPage({ embedded = false } = {}) {
    const viewProps = useModerationPageController({ embedded });

    return <ModerationPageView {...viewProps} />;
}
