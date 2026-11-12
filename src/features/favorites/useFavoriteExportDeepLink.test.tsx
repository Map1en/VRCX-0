// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { useFavoriteExportDeepLink } from './useFavoriteExportDeepLink';

function wrapperAt(entry: string) {
    return ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
    );
}

describe('useFavoriteExportDeepLink', () => {
    it('opens the export dialog once and drops the request from the URL', () => {
        const setExportDialogOpen = vi.fn();
        const { result } = renderHook(
            () => {
                useFavoriteExportDeepLink({
                    embedded: false,
                    kind: 'world',
                    setExportDialogOpen
                });
                return useLocation();
            },
            { wrapper: wrapperAt('/favorites/worlds?export=1&group=a') }
        );

        expect(setExportDialogOpen).toHaveBeenCalledTimes(1);
        expect(setExportDialogOpen).toHaveBeenCalledWith(true);
        expect(result.current.search).toBe('?group=a');
    });

    it('leaves an embedded page alone', () => {
        const setExportDialogOpen = vi.fn();
        renderHook(
            () =>
                useFavoriteExportDeepLink({
                    embedded: true,
                    kind: 'world',
                    setExportDialogOpen
                }),
            { wrapper: wrapperAt('/?export=1') }
        );

        expect(setExportDialogOpen).not.toHaveBeenCalled();
    });
});
