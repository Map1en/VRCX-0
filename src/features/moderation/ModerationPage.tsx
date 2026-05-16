// @ts-nocheck
import { ModerationPageView } from './components/ModerationPageView';
import { useModerationPageController } from './useModerationPageController.js';

export function ModerationPage({ embedded = false } = {}) {
    const viewProps = useModerationPageController({ embedded });

    return <ModerationPageView {...viewProps} />;
}
