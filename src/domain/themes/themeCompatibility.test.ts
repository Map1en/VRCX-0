import { describe, expect, it } from 'vitest';

import { isThemeTestedWithOlderRelease } from './themeCompatibility';

describe('isThemeTestedWithOlderRelease', () => {
    it('warns only when the tested minor release is older than the app', () => {
        expect(isThemeTestedWithOlderRelease('1.4.0', '1.5.2')).toBe(true);
        expect(isThemeTestedWithOlderRelease('1.5.0', '1.5.2')).toBe(false);
        expect(isThemeTestedWithOlderRelease('2.0.0', '1.5.2')).toBe(false);
    });

    it('stays quiet when either version cannot be parsed', () => {
        expect(isThemeTestedWithOlderRelease('latest', '1.5.2')).toBe(false);
        expect(isThemeTestedWithOlderRelease('1.4.0', '')).toBe(false);
    });
});
