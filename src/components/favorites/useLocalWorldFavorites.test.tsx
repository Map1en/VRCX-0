// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    loadLocalWorldFavoritesSnapshot: vi.fn()
}));

vi.mock('@/services/localWorldFavoritesService', () => ({
    loadLocalWorldFavoritesSnapshot: mocks.loadLocalWorldFavoritesSnapshot
}));

import { useFavoriteRevisionStore } from '@/state/favoriteRevisionStore';

import { useLocalWorldFavorites } from './useLocalWorldFavorites';

function worldGroup(id: number, name: string) {
    return { id, kind: 'world' as const, name, shared: false };
}

describe('useLocalWorldFavorites', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        useFavoriteRevisionStore.getState().reset();
        mocks.loadLocalWorldFavoritesSnapshot.mockResolvedValue({
            favoritesByGroup: { 1: ['wrld_1'] },
            groups: [worldGroup(1, 'First')]
        });
    });

    it('rereads the Rust-backed snapshot after a favorites revision', async () => {
        const { result } = renderHook(() => useLocalWorldFavorites());

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        expect(result.current.groups).toEqual([worldGroup(1, 'First')]);

        mocks.loadLocalWorldFavoritesSnapshot.mockResolvedValue({
            favoritesByGroup: { 2: ['wrld_2'] },
            groups: [worldGroup(2, 'Second')]
        });
        act(() => {
            useFavoriteRevisionStore.getState().bumpRevision({
                kind: 'world',
                local: true,
                remote: false,
                requiresRefresh: true
            });
        });

        await waitFor(() => {
            expect(result.current.groups).toEqual([worldGroup(2, 'Second')]);
        });
        expect(mocks.loadLocalWorldFavoritesSnapshot).toHaveBeenCalledTimes(2);
    });

    it('does not read persistence while disabled', () => {
        const { result } = renderHook(() => useLocalWorldFavorites(false));

        expect(result.current.status).toBe('idle');
        expect(mocks.loadLocalWorldFavoritesSnapshot).not.toHaveBeenCalled();
    });

    it('reports read failures without rejecting a completed write flow', async () => {
        mocks.loadLocalWorldFavoritesSnapshot.mockRejectedValue(
            new Error('read failed')
        );
        const { result } = renderHook(() => useLocalWorldFavorites());

        await waitFor(() => {
            expect(result.current.status).toBe('error');
        });
        await expect(result.current.reload()).resolves.toBe(false);
    });
});
