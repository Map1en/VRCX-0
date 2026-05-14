import { describe, expect, it } from 'vitest';

import {
    recordBackendGameClientEvent,
    resetBackendCrashRelaunchDecision,
    shouldSkipFrontendCrashRelaunch
} from './gameClientLifecycle.js';

describe('GameClient lifecycle routing', () => {
    it('skips frontend crash relaunch only after backend schedules it', () => {
        expect(
            shouldSkipFrontendCrashRelaunch({
                backendGameClientLifecycleAvailable: true,
                backendCrashRelaunchHandled: true
            })
        ).toBe(true);
        expect(
            shouldSkipFrontendCrashRelaunch({
                backendGameClientLifecycleAvailable: true,
                backendCrashRelaunchHandled: false
            })
        ).toBe(false);
        expect(
            shouldSkipFrontendCrashRelaunch({
                backendGameClientLifecycleAvailable: false,
                backendCrashRelaunchHandled: true
            })
        ).toBe(false);
    });

    it('keeps frontend fallback when backend reports no crash relaunch plan', () => {
        resetBackendCrashRelaunchDecision();
        expect(
            shouldSkipFrontendCrashRelaunch({
                backendGameClientLifecycleAvailable: true
            })
        ).toBe(false);

        recordBackendGameClientEvent('crashRelaunchDecision', {
            handled: false
        });
        expect(
            shouldSkipFrontendCrashRelaunch({
                backendGameClientLifecycleAvailable: true
            })
        ).toBe(false);

        recordBackendGameClientEvent('crashRelaunchDecision', {
            handled: true
        });
        expect(
            shouldSkipFrontendCrashRelaunch({
                backendGameClientLifecycleAvailable: true
            })
        ).toBe(true);
        resetBackendCrashRelaunchDecision();
    });
});
