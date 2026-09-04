// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFeedFilters } from './useFeedFilters';

describe('useFeedFilters', () => {
    it('applies search only on commit and clears both the draft and query', () => {
        const { result } = renderHook(() => useFeedFilters());
        act(() => result.current.setSearchDraft('world'));
        expect(result.current.deferredSearchQuery).toBe('');
        act(() => result.current.commitSearch());
        expect(result.current.deferredSearchQuery).toBe('world');
        act(() => result.current.clearSearch());
        expect(result.current.searchDraft).toBe('');
        expect(result.current.deferredSearchQuery).toBe('');
    });

    it('keeps date drafts unapplied until confirmation and restores the applied range on reopen', () => {
        const { result } = renderHook(() => useFeedFilters());
        act(() => result.current.setDateFilterOpen(true));
        act(() =>
            result.current.onDateRangeSelect({
                from: new Date(2026, 7, 10),
                to: new Date(2026, 7, 12)
            })
        );
        expect(result.current.dateFrom).toBe('');
        act(() => result.current.applyDateFilter());
        expect(result.current.dateFrom).toBe('2026-08-10');
        expect(result.current.dateTo).toBe('2026-08-12');
        expect(result.current.dateFilterOpen).toBe(false);

        act(() => result.current.setDateFilterOpen(true));
        act(() =>
            result.current.onDateRangeSelect({ from: new Date(2026, 7, 20) })
        );
        act(() => result.current.setDateFilterOpen(false));
        act(() => result.current.setDateFilterOpen(true));
        expect(result.current.dateDraftFrom).toBe('2026-08-10');
        expect(result.current.dateDraftTo).toBe('2026-08-12');
        act(() => result.current.clearDateFilter());
        expect(result.current.dateFrom).toBe('');
        expect(result.current.dateTo).toBe('');
        expect(result.current.dateDraftRange).toBeUndefined();
    });

    it('synchronizes the selected friends when the Feed route scope changes', async () => {
        const { result, rerender } = renderHook(
            ({ routeScopedUserIds }: { routeScopedUserIds: string[] }) =>
                useFeedFilters({ routeScopedUserIds }),
            {
                initialProps: {
                    routeScopedUserIds: ['usr_first']
                }
            }
        );

        expect(result.current.scopedUserIds).toEqual(['usr_first']);

        act(() => {
            rerender({ routeScopedUserIds: ['usr_second'] });
        });

        await waitFor(() => {
            expect(result.current.scopedUserIds).toEqual(['usr_second']);
        });
    });
});
