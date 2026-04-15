import { describe, expect, it } from 'vitest';

import {
    normalizeUserStatus,
    userStatusSortRank
} from './userStatus.js';

describe('userStatus', () => {
    it('normalizes legacy compact status strings', () => {
        expect(normalizeUserStatus('joinme')).toBe('join me');
        expect(normalizeUserStatus('askme')).toBe('ask me');
        expect(normalizeUserStatus('offline:offline')).toBe('offline');
        expect(normalizeUserStatus('private:private')).toBe('private');
        expect(normalizeUserStatus('traveling:traveling')).toBe('traveling');
    });

    it('treats pending offline and offline fields as offline', () => {
        expect(normalizeUserStatus({ pendingOffline: true, status: 'join me' })).toBe('offline');
        expect(normalizeUserStatus({ state: 'active', location: 'offline' })).toBe('offline');
        expect(normalizeUserStatus({ ref: { state: 'online', location: 'offline:offline' } })).toBe('offline');
    });

    it('prioritizes explicit social status before active location', () => {
        expect(normalizeUserStatus({ status: 'join me', location: 'wrld_123:1' })).toBe('join me');
        expect(normalizeUserStatus({ status: 'ask me', location: 'wrld_123:1' })).toBe('ask me');
        expect(normalizeUserStatus({ status: 'busy', location: 'wrld_123:1' })).toBe('busy');
        expect(normalizeUserStatus({ location: 'wrld_123:1' })).toBe('active');
    });

    it('keeps state active distinct from online active for presence ordering', () => {
        expect(normalizeUserStatus({ state: 'active' })).toBe('state-active');
    });

    it('orders statuses by joinability and availability', () => {
        expect(userStatusSortRank('joinme')).toBe(0);
        expect(userStatusSortRank('active')).toBe(1);
        expect(userStatusSortRank('askme')).toBe(2);
        expect(userStatusSortRank('busy')).toBe(3);
        expect(userStatusSortRank('private')).toBe(4);
        expect(userStatusSortRank('offline')).toBe(5);
    });
});
