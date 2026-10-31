import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES } from '@/state/preferencesStore';

import { ConfigKeys } from './configKeys';

describe('ConfigKeys defaults', () => {
    it('match the preference store defaults for shared scalar keys', () => {
        const preferenceDefaults: Record<string, unknown> = DEFAULT_PREFERENCES;
        const mismatches = Object.entries(ConfigKeys).flatMap(
            ([key, definition]) => {
                const preferenceDefault = preferenceDefaults[key];
                if (
                    !(key in preferenceDefaults) ||
                    (typeof preferenceDefault === 'object' &&
                        preferenceDefault !== null)
                ) {
                    return [];
                }
                return Object.is(definition.default, preferenceDefault)
                    ? []
                    : [[key, definition.default, preferenceDefault]];
            }
        );

        expect(mismatches).toEqual([]);
    });
});
