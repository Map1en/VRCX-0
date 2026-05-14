import { describe, expect, it } from 'vitest';

import {
    isBackendPersistedGameLogMirror,
    isBackendHandledGameLogSideEffectType,
    isBackendPersistedGameLogType,
    shouldSkipBackendHandledGameLogSideEffect,
    shouldSkipBackendPersistedGameLog
} from './backendPersistence.js';

describe('backend GameLog persistence routing', () => {
    it('routes only core GameLog rows away from frontend DB writes when backend ingest is active', () => {
        expect(isBackendPersistedGameLogType('location')).toBe(true);
        expect(isBackendPersistedGameLogType('player-left')).toBe(true);
        expect(isBackendPersistedGameLogType('resource-load-image')).toBe(true);
        expect(isBackendPersistedGameLogType('event')).toBe(true);
        expect(isBackendPersistedGameLogType('external')).toBe(true);

        expect(isBackendPersistedGameLogType('video-play')).toBe(false);
        expect(isBackendPersistedGameLogType('screenshot')).toBe(false);
        expect(isBackendPersistedGameLogType('api-request')).toBe(false);
        expect(isBackendPersistedGameLogType('openvr-init')).toBe(false);
        expect(isBackendPersistedGameLogType('desktop-mode')).toBe(false);
    });

    it('routes LogWatcher side effects away from frontend handlers when backend side effects are active', () => {
        expect(isBackendHandledGameLogSideEffectType('video-play')).toBe(true);
        expect(isBackendHandledGameLogSideEffectType('video-sync')).toBe(true);
        expect(isBackendHandledGameLogSideEffectType('vrcx')).toBe(true);
        expect(isBackendHandledGameLogSideEffectType('screenshot')).toBe(true);
        expect(isBackendHandledGameLogSideEffectType('api-request')).toBe(true);
        expect(isBackendHandledGameLogSideEffectType('sticker-spawn')).toBe(
            true
        );
        expect(isBackendHandledGameLogSideEffectType('openvr-init')).toBe(true);
        expect(isBackendHandledGameLogSideEffectType('desktop-mode')).toBe(
            true
        );
        expect(isBackendHandledGameLogSideEffectType('vrc-quit')).toBe(true);
        expect(isBackendHandledGameLogSideEffectType('udon-exception')).toBe(
            true
        );

        expect(isBackendHandledGameLogSideEffectType('location')).toBe(false);
        expect(isBackendHandledGameLogSideEffectType('event')).toBe(false);
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

    it('always skips frontend writes for backend-persisted mirror rows', () => {
        expect(isBackendPersistedGameLogMirror({ backendPersisted: true })).toBe(
            true
        );
        expect(
            shouldSkipBackendPersistedGameLog(
                { type: 'external', backendPersisted: true },
                { backendGameLogIngestAvailable: false }
            )
        ).toBe(true);
    });

    it('keeps frontend side effects as fallback when backend side effects are unavailable', () => {
        expect(
            shouldSkipBackendHandledGameLogSideEffect(
                { type: 'screenshot' },
                { backendGameLogSideEffectsAvailable: true }
            )
        ).toBe(true);
        expect(
            shouldSkipBackendHandledGameLogSideEffect(
                { type: 'screenshot' },
                { backendGameLogSideEffectsAvailable: false }
            )
        ).toBe(false);
    });
});
