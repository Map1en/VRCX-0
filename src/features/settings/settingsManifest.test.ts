import { describe, expect, it } from 'vitest';

import en from '@/localization/en.json';
import {
    getSettingsCard,
    getSettingsManifestEntry,
    SETTINGS_CARDS,
    SETTINGS_MANIFEST
} from '@/shared/constants/settingsManifest';

import {
    getSettingPreferenceKey,
    SETTINGS_DEFAULT_VALUES
} from './settingsFieldState';

const componentSources = import.meta.glob<string>(
    ['./components/**/*.tsx', '!./components/**/*.test.tsx'],
    { query: '?raw', import: 'default', eager: true }
);

function collectPageSettingIds() {
    return Object.values(componentSources).flatMap((source) =>
        Array.from(source.matchAll(/settingId="([^"]+)"/g), (match) => match[1])
    );
}

function hasEnglishString(key: string) {
    let node: unknown = en;
    for (const part of key.split('.')) {
        if (!node || typeof node !== 'object' || !(part in node)) {
            return false;
        }
        node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string';
}

describe('settings manifest', () => {
    it('registers every settingId used on the settings page', () => {
        const pageIds = collectPageSettingIds();
        const unknownIds = pageIds.filter(
            (id) => !getSettingsManifestEntry(id)
        );

        expect(pageIds.length).toBeGreaterThan(0);
        expect(unknownIds).toEqual([]);
    });

    it('has no entries that the settings page never renders', () => {
        const pageIds = new Set(collectPageSettingIds());
        const orphaned = SETTINGS_MANIFEST.filter(
            (entry) => !pageIds.has(entry.id)
        ).map((entry) => entry.id);

        expect(orphaned).toEqual([]);
    });

    it('uses unique ids', () => {
        const ids = SETTINGS_MANIFEST.map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('only references translation keys that exist in en.json', () => {
        const keys = [
            ...SETTINGS_MANIFEST.flatMap((entry) =>
                [entry.labelKey, entry.descriptionKey].filter(
                    (key): key is string => Boolean(key)
                )
            ),
            ...SETTINGS_CARDS.map((card) => card.titleKey)
        ];

        expect(keys.filter((key) => !hasEnglishString(key))).toEqual([]);
    });

    it('maps preference keys onto the preference store defaults', () => {
        const invalid = SETTINGS_MANIFEST.filter(
            (entry) => entry.prefKey && !getSettingPreferenceKey(entry)
        ).map((entry) => entry.id);

        expect(invalid).toEqual([]);
    });

    it('only depends on boolean parents that exist in the same card', () => {
        const invalid = SETTINGS_MANIFEST.filter((entry) => {
            if (!entry.dependsOn) {
                return false;
            }
            const parent = getSettingsManifestEntry(entry.dependsOn);
            const parentKey = getSettingPreferenceKey(parent);
            return (
                !parent ||
                parent.cardId !== entry.cardId ||
                !parentKey ||
                typeof SETTINGS_DEFAULT_VALUES[parentKey] !== 'boolean'
            );
        }).map((entry) => entry.id);

        expect(invalid).toEqual([]);
    });

    it('places every entry in a declared card of its tab', () => {
        const invalid = SETTINGS_MANIFEST.filter(
            (entry) => getSettingsCard(entry.cardId)?.tab !== entry.tab
        ).map((entry) => entry.id);

        expect(invalid).toEqual([]);
    });
});
