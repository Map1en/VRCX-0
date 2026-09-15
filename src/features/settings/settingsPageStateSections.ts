import { buildDialogsSection } from './settings-page-state-sections/dialogsSection';
import { buildIntegrationsSection } from './settings-page-state-sections/integrationsSection';
import { buildInterfaceSection } from './settings-page-state-sections/interfaceSection';
import { buildMediaSection } from './settings-page-state-sections/mediaSection';
import {
    buildAdvancedSection,
    buildNotificationsSection,
    buildVrSection
} from './settings-page-state-sections/notificationsVrAdvancedSections';
import {
    buildShellSection,
    buildSystemSection
} from './settings-page-state-sections/shellSystemSections';
import { buildSocialSection } from './settings-page-state-sections/socialSection';
import type { BuildSettingsPageStateSectionsInput } from './settingsPageStateSectionTypes';

export type { BuildSettingsPageStateSectionsInput } from './settingsPageStateSectionTypes';

export function buildSettingsPageStateSections(
    input: BuildSettingsPageStateSectionsInput
) {
    return {
        shell: buildShellSection(input),
        system: buildSystemSection(input),
        interface: buildInterfaceSection(input),
        media: buildMediaSection(input),
        integrations: buildIntegrationsSection(input),
        social: buildSocialSection(input),
        notifications: buildNotificationsSection(input),
        vr: buildVrSection(input),
        advanced: buildAdvancedSection(input),
        dialogs: buildDialogsSection(input)
    };
}

export type SettingsPageStateSections = ReturnType<
    typeof buildSettingsPageStateSections
>;
