// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostCapabilities } from '@/platform/tauri/bindings';
import { createUnavailableHostCapabilities } from '@/state/runtimeStore';

const mocks = vi.hoisted(() => ({
    appGetHostCapabilities: vi.fn<() => Promise<HostCapabilities>>()
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: mocks }));

beforeEach(() => {
    vi.resetAllMocks();
    delete document.documentElement.dataset.platform;
});

describe('hostCapabilityService', () => {
    it('marks the document with the host platform on startup', async () => {
        const { initializeHostCapabilities } =
            await import('./hostCapabilityService');

        await initializeHostCapabilities({
            ...createUnavailableHostCapabilities(),
            platform: 'linux'
        });

        expect(document.documentElement.dataset.platform).toBe('linux');
    });

    it('updates the platform marker on refresh', async () => {
        mocks.appGetHostCapabilities.mockResolvedValue({
            ...createUnavailableHostCapabilities(),
            platform: 'windows'
        });
        const { refreshHostCapabilities } =
            await import('./hostCapabilityService');

        await refreshHostCapabilities();

        expect(document.documentElement.dataset.platform).toBe('windows');
    });
});
