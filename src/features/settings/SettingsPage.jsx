import { SettingsPageView } from './components/SettingsPageView.jsx';
import { useSettingsPageController } from './useSettingsPageController.js';

export function SettingsPage() {
    const controller = useSettingsPageController();

    return <SettingsPageView controller={controller} />;
}
