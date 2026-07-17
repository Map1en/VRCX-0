import { describe, expect, it } from 'vitest';

import {
    normalizeEndpoint,
    normalizeStateBucket,
    normalizeUserId,
    userFactKey
} from './userFacts';

describe('userFacts', () => {
    it('normalizes user ids and endpoints at the fact boundary', () => {
        expect(normalizeUserId('  usr_test  ')).toBe('usr_test');
        expect(normalizeUserId(42)).toBe('42');
        expect(normalizeUserId(null)).toBe('');
        expect(normalizeEndpoint('  https://api.example.test  ')).toBe(
            'https://api.example.test'
        );
        expect(normalizeEndpoint('')).toBe('default');
        expect(normalizeEndpoint(undefined)).toBe('default');
    });

    it('builds endpoint-scoped keys only for non-empty user ids', () => {
        expect(userFactKey(' api ', ' usr_test ')).toBe('api::usr_test');
        expect(userFactKey('', 'usr_test')).toBe('default::usr_test');
        expect(userFactKey('api', '   ')).toBe('');
        expect(userFactKey('api', null)).toBe('');
    });

    it.each([
        [' ONLINE ', 'online'],
        ['Active', 'active'],
        ['offline', 'offline'],
        ['busy', ''],
        [null, ''],
        [undefined, '']
    ])('normalizes state bucket %j to %j', (value, expected) => {
        expect(normalizeStateBucket(value)).toBe(expected);
    });
});
