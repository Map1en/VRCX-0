import { describe, expect, it } from 'vitest';

import {
    isRuntimePersistedGameLogMirror,
    isRuntimeHandledGameLogSideEffectType,
    isRuntimePersistedGameLogType,
    shouldSkipRuntimeHandledGameLogSideEffect,
    shouldSkipRuntimePersistedGameLog
} from './persistenceOwnership';

describe('runtime GameLog persistence routing', () => {
    it('routes only core GameLog rows away from frontend DB writes when runtime ingest is active', () => {
        expect(isRuntimePersistedGameLogType('location')).toBe(true);
        expect(isRuntimePersistedGameLogType('player-left')).toBe(true);
        expect(isRuntimePersistedGameLogType('resource-load-image')).toBe(true);
        expect(isRuntimePersistedGameLogType('event')).toBe(true);
        expect(isRuntimePersistedGameLogType('external')).toBe(true);

        expect(isRuntimePersistedGameLogType('video-play')).toBe(false);
        expect(isRuntimePersistedGameLogType('screenshot')).toBe(false);
        expect(isRuntimePersistedGameLogType('api-request')).toBe(false);
        expect(isRuntimePersistedGameLogType('openvr-init')).toBe(false);
        expect(isRuntimePersistedGameLogType('desktop-mode')).toBe(false);
    });

    it('routes LogWatcher side effects away from frontend handlers when runtime side effects are active', () => {
        expect(isRuntimeHandledGameLogSideEffectType('video-play')).toBe(true);
        expect(isRuntimeHandledGameLogSideEffectType('video-sync')).toBe(true);
        expect(isRuntimeHandledGameLogSideEffectType('vrcx')).toBe(true);
        expect(isRuntimeHandledGameLogSideEffectType('screenshot')).toBe(true);
        expect(isRuntimeHandledGameLogSideEffectType('api-request')).toBe(true);
        expect(isRuntimeHandledGameLogSideEffectType('sticker-spawn')).toBe(
            true
        );
        expect(isRuntimeHandledGameLogSideEffectType('openvr-init')).toBe(true);
        expect(isRuntimeHandledGameLogSideEffectType('desktop-mode')).toBe(
            true
        );
        expect(isRuntimeHandledGameLogSideEffectType('vrc-quit')).toBe(true);
        expect(isRuntimeHandledGameLogSideEffectType('udon-exception')).toBe(
            true
        );

        expect(isRuntimeHandledGameLogSideEffectType('location')).toBe(false);
        expect(isRuntimeHandledGameLogSideEffectType('event')).toBe(false);
    });

    it('keeps frontend writes as fallback when runtime ingest is unavailable', () => {
        expect(
            shouldSkipRuntimePersistedGameLog(
                { type: 'location' },
                { runtimeGameLogIngestAvailable: true }
            )
        ).toBe(true);
        expect(
            shouldSkipRuntimePersistedGameLog(
                { type: 'location' },
                { runtimeGameLogIngestAvailable: false }
            )
        ).toBe(false);
    });

    it('always skips frontend writes for runtime-persisted mirror rows', () => {
        expect(
            isRuntimePersistedGameLogMirror({ runtimePersisted: true })
        ).toBe(true);
        expect(
            shouldSkipRuntimePersistedGameLog(
                { type: 'external', runtimePersisted: true },
                { runtimeGameLogIngestAvailable: false }
            )
        ).toBe(true);
    });

    it('keeps frontend side effects as fallback when runtime side effects are unavailable', () => {
        expect(
            shouldSkipRuntimeHandledGameLogSideEffect(
                { type: 'screenshot' },
                { runtimeGameLogSideEffectsAvailable: true }
            )
        ).toBe(true);
        expect(
            shouldSkipRuntimeHandledGameLogSideEffect(
                { type: 'screenshot' },
                { runtimeGameLogSideEffectsAvailable: false }
            )
        ).toBe(false);
    });
});
