import { SettingsPageView } from './components/SettingsPageView.jsx';
import { SettingsPageProvider } from './SettingsPageContext.jsx';

export function SettingsPage() {
    return (
        <SettingsPageProvider>
            <SettingsPageView />
        </SettingsPageProvider>
    );
}
