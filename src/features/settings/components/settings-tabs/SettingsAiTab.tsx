import { SettingsTabContent } from '../SettingsViewParts';
import { McpServerSettingsGroup } from './McpServerSettingsGroup';

export function SettingsAiTab() {
    return (
        <SettingsTabContent value="ai">
            <McpServerSettingsGroup />
        </SettingsTabContent>
    );
}
