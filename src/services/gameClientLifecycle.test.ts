import { describe, expect, it } from 'vitest';

import {
    recordRuntimeGameClientEvent,
    resetRuntimeCrashRelaunchDecision,
    shouldSkipFrontendCrashRelaunch
} from './gameClientLifecycle';

describe('GameClient lifecycle routing', () => {
    it('skips frontend crash relaunch only after runtime schedules it', () => {
        expect(
            shouldSkipFrontendCrashRelaunch({
                runtimeGameClientLifecycleAvailable: true,
                runtimeCrashRelaunchHandled: true
            })
        ).toBe(true);
        expect(
            shouldSkipFrontendCrashRelaunch({
                runtimeGameClientLifecycleAvailable: true,
                runtimeCrashRelaunchHandled: false
            })
        ).toBe(false);
        expect(
            shouldSkipFrontendCrashRelaunch({
                runtimeGameClientLifecycleAvailable: false,
                runtimeCrashRelaunchHandled: true
            })
        ).toBe(false);
    });

    it('keeps frontend fallback when runtime reports no crash relaunch plan', () => {
        resetRuntimeCrashRelaunchDecision();
        expect(
            shouldSkipFrontendCrashRelaunch({
                runtimeGameClientLifecycleAvailable: true
            })
        ).toBe(false);

        recordRuntimeGameClientEvent('crashRelaunchDecision', {
            handled: false
        });
        expect(
            shouldSkipFrontendCrashRelaunch({
                runtimeGameClientLifecycleAvailable: true
            })
        ).toBe(false);

        recordRuntimeGameClientEvent('crashRelaunchDecision', {
            handled: true
        });
        expect(
            shouldSkipFrontendCrashRelaunch({
                runtimeGameClientLifecycleAvailable: true
            })
        ).toBe(true);
        resetRuntimeCrashRelaunchDecision();
    });
});
