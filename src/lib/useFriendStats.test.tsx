// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadFriendStats } from '@/services/friendStatsService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useFriendStatsStore } from '@/state/friendStatsStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useFriendStatsHydration } from './useFriendStats';

vi.mock('@/services/friendStatsService', () => ({
    loadFriendStats: vi.fn()
}));

beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(loadFriendStats).mockReset().mockResolvedValue({});
    useFriendRosterStore.getState().resetRoster();
    useFriendStatsStore.getState().reset();
    useRuntimeStore.setState((state) => ({
        auth: { ...state.auth, currentUserId: 'usr_self' }
    }));
    useFriendRosterStore.getState().applyFriendPatches([
        { userId: 'usr_a', patch: { displayName: 'Alpha' } },
        { userId: 'usr_b', patch: { displayName: 'Bravo' } }
    ]);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('useFriendStatsHydration', () => {
    it('does not reload statistics when presence only changes display order', async () => {
        renderHook(() => useFriendStatsHydration(true));
        await act(() => vi.advanceTimersByTimeAsync(400));
        expect(loadFriendStats).toHaveBeenCalledTimes(1);
        expect(useFriendRosterStore.getState().orderedFriendIds).toEqual([
            'usr_a',
            'usr_b'
        ]);

        act(() => {
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_b',
                presence: { rev: 1, view: { kind: 'active', platform: 'web' } }
            });
        });
        expect(useFriendRosterStore.getState().orderedFriendIds).toEqual([
            'usr_b',
            'usr_a'
        ]);
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(loadFriendStats).toHaveBeenCalledTimes(1);
    });

    it('still reloads statistics for renamed and newly added friends', async () => {
        renderHook(() => useFriendStatsHydration(true));
        await act(() => vi.advanceTimersByTimeAsync(400));

        act(() => {
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_a',
                patch: { displayName: 'Renamed' }
            });
        });
        await act(() => vi.advanceTimersByTimeAsync(400));
        expect(loadFriendStats).toHaveBeenCalledTimes(2);
        expect(loadFriendStats).toHaveBeenLastCalledWith(
            'usr_self',
            expect.arrayContaining([{ id: 'usr_a', displayName: 'Renamed' }])
        );

        act(() => {
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_c',
                patch: { displayName: 'Charlie' }
            });
        });
        await act(() => vi.advanceTimersByTimeAsync(400));
        expect(loadFriendStats).toHaveBeenCalledTimes(3);
        expect(loadFriendStats).toHaveBeenLastCalledWith(
            'usr_self',
            expect.arrayContaining([{ id: 'usr_c', displayName: 'Charlie' }])
        );
    });
});
