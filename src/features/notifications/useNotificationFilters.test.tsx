// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getString: vi.fn(),
    setString: vi.fn()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: mocks.getString,
        setString: mocks.setString
    }
}));

import { useNotificationFilters } from './useNotificationFilters';

describe('useNotificationFilters', () => {
    beforeEach(() => {
        mocks.getString.mockReset();
        mocks.setString.mockReset();
        mocks.getString.mockResolvedValue('[]');
    });

    it('clears search, quick filters, and notification types together', async () => {
        const { result } = renderHook(() => useNotificationFilters());
        await waitFor(() => expect(result.current.filtersReady).toBe(true));

        act(() => {
            result.current.setActiveTypes(['invite']);
            result.current.setQuickFilter('unread');
            result.current.setSearchQuery('friend');
        });
        expect(result.current.activeTypes).toEqual(['invite']);
        expect(result.current.quickFilter).toBe('unread');
        expect(result.current.searchQuery).toBe('friend');

        act(() => result.current.clearFilters());
        expect(result.current.activeTypes).toEqual([]);
        expect(result.current.quickFilter).toBe('all');
        expect(result.current.searchQuery).toBe('');
    });

    it('restores and saves the selected quick tab', async () => {
        mocks.getString.mockImplementation(async (key: string) =>
            key === 'VRCX_notificationQuickFilter' ? 'action' : '[]'
        );
        const { result } = renderHook(() => useNotificationFilters());
        await waitFor(() => expect(result.current.filtersReady).toBe(true));

        expect(result.current.quickFilter).toBe('action');

        act(() => result.current.setQuickFilter('unread'));

        expect(mocks.setString).toHaveBeenCalledWith(
            'VRCX_notificationQuickFilter',
            'unread'
        );
    });
});
