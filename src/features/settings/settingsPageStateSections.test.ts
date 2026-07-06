import { describe, expect, it, vi } from 'vitest';

import {
    buildSettingsPageStateSections,
    type BuildSettingsPageStateSectionsInput
} from './settingsPageStateSections';

function buildSections(input: Record<string, unknown>) {
    return buildSettingsPageStateSections(
        input as BuildSettingsPageStateSectionsInput
    );
}

describe('settingsPageStateSections', () => {
    it('routes the hide-unfriend-event preference through the social section', () => {
        const saveBoolPreference = vi.fn();

        const sections = buildSections({
            activeSettingsTab: 'social',
            prefs: {
                feedHiddenUsers: [],
                hideUnfriends: false
            },
            saveBoolPreference
        });

        expect('onHideUnfriendsChange' in sections.interface).toBe(false);

        sections.social.onHideUnfriendsChange(true);

        expect(saveBoolPreference).toHaveBeenCalledWith(
            'hideUnfriends',
            'hideUnfriends',
            true
        );
    });
});
