// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    historyGet: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appGetScreenshotShareHistory: mocks.historyGet
    }
}));

import { useScreenshotShareHistory } from './useScreenshotShareHistory';

const record = {
    id: 'r1',
    targetId: 'a',
    targetName: 'Channel a',
    messageUrl: null,
    sentAt: '2026-11-04T00:00:00Z',
    fileNames: ['a.png']
};

describe('useScreenshotShareHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('reports a failed history load and loads again on retry', async () => {
        mocks.historyGet
            .mockRejectedValueOnce(new Error('database busy'))
            .mockResolvedValueOnce([record]);

        const { result } = renderHook(() => useScreenshotShareHistory());

        await waitFor(() => expect(result.current.loadFailed).toBe(true));
        expect(result.current.records).toBeNull();

        act(() => {
            result.current.reload();
        });

        await waitFor(() => expect(result.current.records).toEqual([record]));
        expect(result.current.loadFailed).toBe(false);
    });
});
