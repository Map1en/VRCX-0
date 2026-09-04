// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDataTableStorageKey } from '@/components/data-table/dataTablePersistence';

import { useFeedTableState } from './useFeedTableState';

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getBool: vi.fn().mockResolvedValue(false),
        getString: vi.fn().mockResolvedValue('[]'),
        setBool: vi.fn(),
        setString: vi.fn()
    }
}));

vi.mock('@/services/preferencesService', () => ({
    getTablePageSizePreference: vi.fn().mockResolvedValue(20),
    getTablePageSizesPreference: vi.fn().mockResolvedValue([10, 20, 50])
}));

vi.mock('@/state/preferencesStore', () => {
    const state = {
        preferencesHydrated: true,
        tablePageSizes: [10, 20, 50]
    };
    return {
        usePreferencesStore: (selector: (value: typeof state) => unknown) =>
            selector(state)
    };
});

const options = {
    activeFilters: [],
    dateFrom: '',
    dateTo: '',
    deferredSearchQuery: '',
    favoritesOnly: false,
    scopedUserIds: [],
    setFavoritesOnly: vi.fn(),
    setFeedFilters: vi.fn()
};

describe('useFeedTableState', () => {
    beforeEach(() => {
        const values = new Map<string, string>();
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    values.set(key, value);
                }
            }
        });
    });

    it('restores search sorting and shared list widths after remount', () => {
        const first = renderHook(() => useFeedTableState(options));

        act(() => {
            first.result.current.setSorting([{ id: 'type', desc: false }]);
            first.result.current.setColumnSizing({
                created_at: 144,
                displayName: 208
            });
        });

        expect(
            JSON.parse(
                window.localStorage.getItem(getDataTableStorageKey('feed')) ||
                    '{}'
            ).sorting
        ).toEqual([{ id: 'type', desc: false }]);
        expect(
            JSON.parse(
                window.localStorage.getItem(getDataTableStorageKey('feed')) ||
                    '{}'
            ).columnSizing
        ).toEqual({ created_at: 144, displayName: 208 });
        first.unmount();

        const second = renderHook(() => useFeedTableState(options));

        expect(second.result.current.sorting).toEqual([
            { id: 'type', desc: false }
        ]);
        expect(second.result.current.columnSizing).toEqual({
            created_at: 144,
            displayName: 208
        });
    });
});
