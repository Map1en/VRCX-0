// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetSearchPageState } from './searchPageStore';
import { useSearchFilters } from './useSearchFilters';

function wrapper({ children }: { children: ReactNode }) {
    return (
        <MemoryRouter initialEntries={['/search?tab=world']}>
            {children}
        </MemoryRouter>
    );
}

beforeEach(() => resetSearchPageState());

describe('useSearchFilters', () => {
    it('opens a linked tab and keeps the URL in sync with tab changes', () => {
        const { result, unmount } = renderHook(
            () => ({ filters: useSearchFilters(), location: useLocation() }),
            { wrapper }
        );

        expect(result.current.filters.activeTab).toBe('world');
        expect(result.current.location.search).toBe('?tab=world');

        act(() => result.current.filters.setActiveTab('avatar'));
        expect(result.current.filters.activeTab).toBe('avatar');
        expect(result.current.location.search).toBe('?tab=avatar');

        act(() => result.current.filters.setActiveTab('user'));
        expect(result.current.filters.activeTab).toBe('user');
        expect(result.current.location.search).toBe('');
        unmount();
    });
});

it('restores the selected tab, draft and filters after leaving the page', () => {
    const first = renderHook(() => useSearchFilters(), { wrapper });
    act(() => {
        first.result.current.setSearchText('ocean');
        first.result.current.setIncludeCommunityLabs(true);
        first.result.current.setSelectedWorldCategory('2');
    });
    first.unmount();
    const restored = renderHook(() => useSearchFilters(), {
        wrapper: ({ children }) => (
            <MemoryRouter initialEntries={['/search']}>{children}</MemoryRouter>
        )
    });
    expect(restored.result.current.activeTab).toBe('world');
    expect(restored.result.current.searchText).toBe('ocean');
    expect(restored.result.current.includeCommunityLabs).toBe(true);
    expect(restored.result.current.selectedWorldCategory).toBe('2');
    restored.unmount();
});
