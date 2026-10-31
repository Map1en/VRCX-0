import {
    getSettingAncestors,
    type SettingsManifestEntry
} from '@/shared/constants/settingsManifest';
import type { PreferencesSnapshot } from '@/state/preferencesStore';

import { createDefaultSettingsPrefs } from './settingsDefaultPrefs';

type PreferenceKey = keyof PreferencesSnapshot;

export const SETTINGS_DEFAULT_VALUES = createDefaultSettingsPrefs();

function isPreferenceKey(key: string): key is PreferenceKey {
    return Object.hasOwn(SETTINGS_DEFAULT_VALUES, key);
}

export function getSettingPreferenceKey(
    entry: SettingsManifestEntry | undefined
): PreferenceKey | undefined {
    const key = entry?.prefKey;
    return key && isPreferenceKey(key) ? key : undefined;
}

export function isSettingModified(
    entry: SettingsManifestEntry | undefined,
    prefs: PreferencesSnapshot
): boolean {
    const key = getSettingPreferenceKey(entry);
    return key ? !Object.is(prefs[key], SETTINGS_DEFAULT_VALUES[key]) : false;
}

export function findDisabledAncestor(
    entry: SettingsManifestEntry | undefined,
    prefs: PreferencesSnapshot
): SettingsManifestEntry | undefined {
    if (!entry) {
        return undefined;
    }
    let blocking: SettingsManifestEntry | undefined;
    for (const ancestor of getSettingAncestors(entry)) {
        const key = getSettingPreferenceKey(ancestor);
        if (key && prefs[key] === false) {
            blocking = ancestor;
        }
    }
    return blocking;
}
