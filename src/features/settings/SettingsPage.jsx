import { SettingsPageView } from './components/SettingsPageView.jsx';
import { useSettingsPageController } from './useSettingsPageController.js';

export function SettingsPage() {
    const viewProps = useSettingsPageController();

    return <SettingsPageView {...viewProps} />;
}
