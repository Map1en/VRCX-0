import { describe, expect, it } from 'vitest';

import {
    TRUST_COLOR_DEFAULTS,
    getTrustColor,
    isValidTrustColor,
    normalizeTrustColors,
    resolveTrustColorKey
} from './trustColors';

describe('trustColors', () => {
    it('normalizes configured trust colors and falls back for dirty values', () => {
        expect(
            normalizeTrustColors({
                untrusted: ' #abcdef ',
                basic: '#123',
                known: '#2bcf5c',
                trusted: null,
                veteran: '#B18FFF',
                vip: '#ff2626',
                troll: '#zzzzzz'
            })
        ).toEqual({
            untrusted: '#ABCDEF',
            basic: TRUST_COLOR_DEFAULTS.basic,
            known: '#2BCF5C',
            trusted: TRUST_COLOR_DEFAULTS.trusted,
            veteran: '#B18FFF',
            vip: '#FF2626',
            troll: TRUST_COLOR_DEFAULTS.troll
        });

        expect(normalizeTrustColors('{"basic":"#1778ff"}')).toMatchObject({
            basic: '#1778FF',
            untrusted: TRUST_COLOR_DEFAULTS.untrusted
        });
        expect(normalizeTrustColors('{bad json')).toEqual(TRUST_COLOR_DEFAULTS);
    });

    it('validates only full six-digit hex colors', () => {
        expect(isValidTrustColor('#abcdef')).toBe(true);
        expect(isValidTrustColor(' #ABCDEF ')).toBe(true);
        expect(isValidTrustColor('#abc')).toBe(false);
        expect(isValidTrustColor('red')).toBe(false);
    });

    it('resolves moderator, troll, class, and fallback trust keys', () => {
        expect(
            resolveTrustColorKey({ $isModerator: true, $isTroll: true })
        ).toBe('vip');
        expect(resolveTrustColorKey({ $isProbableTroll: true })).toBe('troll');
        expect(resolveTrustColorKey({ $trustClass: 'x-tag-known' })).toBe(
            'known'
        );
        expect(resolveTrustColorKey({ trustClass: 'trusted' })).toBe('trusted');
        expect(resolveTrustColorKey({ trustClass: 'unknown' })).toBe(
            'untrusted'
        );
        expect(resolveTrustColorKey(null)).toBe('untrusted');
    });

    it('returns the normalized configured color for the resolved trust key', () => {
        expect(
            getTrustColor(
                { $trustClass: 'x-tag-known' },
                { known: '#00aa00', untrusted: '#111111' }
            )
        ).toBe('#00AA00');
        expect(
            getTrustColor({ trustClass: 'unknown' }, { untrusted: '#111111' })
        ).toBe('#111111');
    });
});
