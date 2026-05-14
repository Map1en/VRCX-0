import { describe, expect, it } from 'vitest';

import {
    isBackendPersistedGameLogType,
    shouldSkipBackendPersistedGameLog
} from './backendPersistence.js';

describe('backend GameLog persistence routing', () => {
    it('routes only core GameLog rows away from frontend DB writes when backend ingest is active', () => {
        expect(isBackendPersistedGameLogType('location')).toBe(true);
        expect(isBackendPersistedGameLogType('player-left')).toBe(true);
        expect(isBackendPersistedGameLogType('resource-load-image')).toBe(true);
        expect(isBackendPersistedGameLogType('event')).toBe(true);

        expect(isBackendPersistedGameLogType('video-play')).toBe(false);
        expect(isBackendPersistedGameLogType('screenshot')).toBe(false);
        expect(isBackendPersistedGameLogType('api-request')).toBe(false);
        expect(isBackendPersistedGameLogType('openvr-init')).toBe(false);
        expect(isBackendPersistedGameLogType('desktop-mode')).toBe(false);
    });

    it('keeps frontend writes as fallback when backend ingest is unavailable', () => {
        expect(
            shouldSkipBackendPersistedGameLog(
                { type: 'location' },
                { backendGameLogIngestAvailable: true }
            )
        ).toBe(true);
        expect(
            shouldSkipBackendPersistedGameLog(
                { type: 'location' },
                { backendGameLogIngestAvailable: false }
            )
        ).toBe(false);
    });
});
