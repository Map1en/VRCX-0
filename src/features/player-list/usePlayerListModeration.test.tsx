// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appModerationSyncRefresh: vi.fn(),
    appModerationSyncUpdate: vi.fn(),
    getAllLocalModerations: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appModerationSyncRefresh: mocks.appModerationSyncRefresh,
        appModerationSyncUpdate: mocks.appModerationSyncUpdate
    }
}));

vi.mock('@/repositories/vrchatModerationRepository', () => ({
    default: {
        getAllLocalModerations: mocks.getAllLocalModerations
    }
}));

import { updateModerationSync } from '@/services/moderationSyncService';

import { usePlayerListModeration } from './usePlayerListModeration';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

function moderation(userId: string, block: boolean) {
    return {
        userId,
        displayName: 'Target User',
        block,
        mute: false,
        timeoutTime: 0
    };
}

describe('usePlayerListModeration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('reloads PlayerList moderation badges after a successful dialog mutation', async () => {
        mocks.getAllLocalModerations
            .mockResolvedValueOnce([moderation('usr_target', false)])
            .mockResolvedValueOnce([moderation('usr_target', true)]);
        mocks.appModerationSyncUpdate.mockResolvedValueOnce({
            targetUserId: 'usr_target',
            type: 'block',
            enabled: true,
            local: null
        });
        const { result } = renderHook(() =>
            usePlayerListModeration('usr_self')
        );

        await waitFor(() =>
            expect(result.current.usr_target?.block).toBe(false)
        );

        await act(async () => {
            await updateModerationSync({
                ownerUserId: 'usr_self',
                targetUserId: 'usr_target',
                type: 'block',
                enabled: true
            });
        });

        await waitFor(() =>
            expect(result.current.usr_target?.block).toBe(true)
        );
        expect(mocks.getAllLocalModerations).toHaveBeenCalledTimes(2);
    });

    it('ignores moderation changes from another signed-in owner', async () => {
        mocks.getAllLocalModerations.mockResolvedValueOnce([
            moderation('usr_target', false)
        ]);
        mocks.appModerationSyncUpdate.mockResolvedValueOnce({
            targetUserId: 'usr_target',
            type: 'block',
            enabled: true,
            local: null
        });
        const { result } = renderHook(() =>
            usePlayerListModeration('usr_self')
        );
        await waitFor(() =>
            expect(result.current.usr_target?.block).toBe(false)
        );

        await act(async () => {
            await updateModerationSync({
                ownerUserId: 'usr_other',
                targetUserId: 'usr_target',
                type: 'block',
                enabled: true
            });
        });

        expect(mocks.getAllLocalModerations).toHaveBeenCalledTimes(1);
    });

    it('does not let an older moderation read overwrite mutation results', async () => {
        const staleLoad = deferred<ReturnType<typeof moderation>[]>();
        mocks.getAllLocalModerations
            .mockReturnValueOnce(staleLoad.promise)
            .mockResolvedValueOnce([moderation('usr_target', true)]);
        mocks.appModerationSyncUpdate.mockResolvedValueOnce({
            targetUserId: 'usr_target',
            type: 'block',
            enabled: true,
            local: null
        });
        const { result } = renderHook(() =>
            usePlayerListModeration('usr_self')
        );

        await act(async () => {
            await updateModerationSync({
                ownerUserId: 'usr_self',
                targetUserId: 'usr_target',
                type: 'block',
                enabled: true
            });
        });
        await waitFor(() =>
            expect(result.current.usr_target?.block).toBe(true)
        );

        await act(async () => {
            staleLoad.resolve([moderation('usr_target', false)]);
            await staleLoad.promise;
        });

        expect(result.current.usr_target?.block).toBe(true);
    });
});
