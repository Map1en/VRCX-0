import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VrcStatusSnapshot } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    get: vi.fn<() => Promise<VrcStatusSnapshot>>(),
    refresh: vi.fn<() => Promise<VrcStatusSnapshot>>()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appVrcStatusGet: mocks.get,
        appVrcStatusRefresh: mocks.refresh
    }
}));

import { useRuntimeStore } from '@/state/runtimeStore';

import { applyVrcStatusSnapshot, hydrateVrcStatus } from './vrcStatusService';

function snapshot(status: string, lastFetchedAt: string): VrcStatusSnapshot {
    return {
        status,
        indicator: status,
        summary: status,
        updatedAt: lastFetchedAt,
        lastFetchedAt,
        pollingIntervalMs: 900_000,
        refreshing: false,
        error: ''
    };
}

describe('vrcStatusService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
    });

    it('does not let an older hydration overwrite a newer runtime event', async () => {
        let resolveHydration: (value: VrcStatusSnapshot) => void = () => {};
        mocks.get.mockReturnValue(
            new Promise((resolve) => {
                resolveHydration = resolve;
            })
        );

        const hydration = hydrateVrcStatus();
        const newer = snapshot('newer', '2026-07-31T02:00:00.000Z');
        applyVrcStatusSnapshot(newer);
        resolveHydration(snapshot('older', '2026-07-31T01:00:00.000Z'));
        await hydration;

        expect(useRuntimeStore.getState().vrcStatus).toMatchObject(newer);
    });
});
