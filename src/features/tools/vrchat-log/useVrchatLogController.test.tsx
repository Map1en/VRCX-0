// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    commands,
    type VrchatLogEntriesReadOutput,
    type VrchatLogFileOutput
} from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useVrchatLogController } from './useVrchatLogController';
import { logViewerStorage } from './vrchatLogHelpers';

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);
vi.mock('@/services/toastService', () => ({ toast: { add: vi.fn() } }));

const file: VrchatLogFileOutput = {
    fileName: 'output_log_2026-11-10_12-00-00.txt',
    modifiedAt: '2026-11-10T12:00:00Z',
    size: 1000,
    latest: true
};
const response: VrchatLogEntriesReadOutput = {
    fileName: file.fileName,
    entries: [
        {
            fileName: file.fileName,
            timestamp: '2026-11-10T12:00:00Z',
            level: 'Debug',
            category: null,
            message: 'test entry',
            raw: 'test entry',
            lineNumber: 1,
            endLineNumber: 1,
            continuationLines: []
        }
    ],
    levelCounts: [],
    offset: 0,
    nextOffset: null,
    totalEntries: 1,
    totalLines: 1,
    lastLineNumber: 1,
    fileSize: file.size,
    fileModifiedAt: file.modifiedAt,
    resetRequired: false
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(logViewerStorage, 'getJson').mockResolvedValue({
        followLatest: false
    });
    vi.spyOn(logViewerStorage, 'setJson').mockResolvedValue(null);
    vi.mocked(commands.appVrchatLogFilesList).mockResolvedValue([file]);
    vi.mocked(commands.appVrchatLogEntriesRead).mockResolvedValue(response);
    vi.mocked(commands.appVrchatLogTailRead).mockResolvedValue({
        ...response,
        entries: [],
        totalEntries: 0,
        fileSize: 1001
    });
    useRuntimeStore.setState((state) => ({
        hostCapabilities: {
            ...state.hostCapabilities,
            vrchatPathDiscovery: {
                available: true,
                enabled: true,
                supported: true
            }
        }
    }));
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('VRChat log search', () => {
    it('updates the draft immediately but only reads after typing settles', async () => {
        const { result, unmount } = renderHook(() => useVrchatLogController());
        await act(async () => {});
        expect(commands.appVrchatLogEntriesRead).toHaveBeenCalledTimes(2);
        vi.mocked(commands.appVrchatLogEntriesRead).mockClear();

        act(() => result.current.setSearchQuery('a'));
        await act(() => vi.advanceTimersByTimeAsync(100));
        act(() => result.current.setSearchQuery('ab'));
        await act(() => vi.advanceTimersByTimeAsync(100));
        act(() => result.current.setSearchQuery('abc'));
        expect(result.current.searchQuery).toBe('abc');
        await act(() => vi.advanceTimersByTimeAsync(249));
        expect(commands.appVrchatLogEntriesRead).not.toHaveBeenCalled();

        await act(() => vi.advanceTimersByTimeAsync(1));
        expect(commands.appVrchatLogEntriesRead).toHaveBeenCalledTimes(2);
        for (const [input] of vi.mocked(commands.appVrchatLogEntriesRead).mock
            .calls) {
            expect(input.query).toBe('abc');
        }

        act(() => result.current.setSearchQuery('pending'));
        unmount();
        await act(() => vi.advanceTimersByTimeAsync(300));
        expect(commands.appVrchatLogEntriesRead).toHaveBeenCalledTimes(2);
    });

    it('restores the saved query immediately and keeps tail reads on the applied query', async () => {
        vi.mocked(logViewerStorage.getJson).mockResolvedValue({
            searchQuery: 'old',
            followLatest: true
        });
        const { result } = renderHook(() => useVrchatLogController());
        await act(async () => {});
        expect(commands.appVrchatLogEntriesRead).toHaveBeenCalledTimes(2);
        expect(commands.appVrchatLogEntriesRead).toHaveBeenLastCalledWith(
            expect.objectContaining({ query: 'old' })
        );

        await act(() => vi.advanceTimersByTimeAsync(1800));
        expect(commands.appVrchatLogEntriesRead).toHaveBeenCalledTimes(2);
        vi.mocked(commands.appVrchatLogFilesList).mockResolvedValue([
            { ...file, size: 1001 }
        ]);
        act(() => result.current.setSearchQuery('new'));
        await act(() => vi.advanceTimersByTimeAsync(200));
        expect(commands.appVrchatLogTailRead).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ query: 'old' })
        );
        expect(commands.appVrchatLogEntriesRead).toHaveBeenCalledTimes(2);

        await act(() => vi.advanceTimersByTimeAsync(50));
        expect(commands.appVrchatLogEntriesRead).toHaveBeenCalledTimes(4);
        expect(commands.appVrchatLogEntriesRead).toHaveBeenLastCalledWith(
            expect.objectContaining({ query: 'new' })
        );
    });
});
