import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    testModeSet: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appVrOverlayTestModeSet: mocks.testModeSet
    }
}));

import { useVrOverlayTestStore } from '@/state/vrOverlayTestStore';

import { setVrOverlayTestMode } from './vrOverlayTestService';

describe('setVrOverlayTestMode', () => {
    beforeEach(() => {
        mocks.testModeSet.mockReset();
        useVrOverlayTestStore.setState({ testMode: false, pending: false });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('mirrors the test mode the backend confirms', async () => {
        mocks.testModeSet.mockResolvedValue({ testMode: true });

        const pending = setVrOverlayTestMode(true);
        expect(useVrOverlayTestStore.getState().pending).toBe(true);
        await pending;

        expect(mocks.testModeSet).toHaveBeenCalledWith(true);
        expect(useVrOverlayTestStore.getState()).toMatchObject({
            testMode: true,
            pending: false
        });
    });

    it('ignores a second request while one is pending', async () => {
        let resolveSet: (value: { testMode: boolean }) => void = () =>
            undefined;
        mocks.testModeSet.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveSet = resolve;
                })
        );

        const first = setVrOverlayTestMode(true);
        await setVrOverlayTestMode(false);
        expect(mocks.testModeSet).toHaveBeenCalledTimes(1);

        resolveSet({ testMode: true });
        await first;
        expect(useVrOverlayTestStore.getState().testMode).toBe(true);
    });

    it('keeps the previous mode and clears pending when the backend fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = new Error('IPC failed');
        mocks.testModeSet.mockRejectedValue(error);

        await setVrOverlayTestMode(true);

        expect(warn).toHaveBeenCalledWith(
            'Failed to set VR overlay test mode:',
            error
        );
        expect(useVrOverlayTestStore.getState()).toMatchObject({
            testMode: false,
            pending: false
        });
    });
});
