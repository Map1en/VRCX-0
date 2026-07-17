// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuickSearchCatalog } from '../quickSearchCatalog';

const mocks = vi.hoisted(() => ({
    loadQuickSearchCatalog: vi.fn()
}));

vi.mock('../quickSearchCatalog', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../quickSearchCatalog')>();
    return {
        ...actual,
        loadQuickSearchCatalog: mocks.loadQuickSearchCatalog
    };
});

import { createEmptyCatalog } from '../quickSearchCatalog';
import { useQuickSearchCatalogState } from './useQuickSearchCatalogState';

function deferredCatalog() {
    let resolve!: (catalog: QuickSearchCatalog) => void;
    const promise = new Promise<QuickSearchCatalog>((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
}

describe('useQuickSearchCatalogState', () => {
    beforeEach(() => {
        mocks.loadQuickSearchCatalog.mockReset();
    });

    it('ignores a stale catalog load after the active account changes', async () => {
        const first = deferredCatalog();
        const second = deferredCatalog();
        mocks.loadQuickSearchCatalog
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const { result, rerender } = renderHook(
            ({ currentUserId, currentEndpoint }) =>
                useQuickSearchCatalogState({
                    currentUserId,
                    currentEndpoint,
                    open: true
                }),
            {
                initialProps: {
                    currentUserId: 'usr_first',
                    currentEndpoint: 'https://first.example'
                }
            }
        );

        rerender({
            currentUserId: 'usr_second',
            currentEndpoint: 'https://second.example'
        });

        await act(async () => {
            first.resolve({
                ...createEmptyCatalog('ready', 'stale'),
                ownAvatars: [{ id: 'avtr_stale' }]
            });
            await first.promise;
        });

        expect(result.current.status).toBe('running');
        expect(result.current.detail).toBe('');

        await act(async () => {
            second.resolve({
                ...createEmptyCatalog('ready', 'current'),
                ownAvatars: [{ id: 'avtr_current' }]
            });
            await second.promise;
        });

        expect(result.current.status).toBe('ready');
        expect(result.current.detail).toBe('current');
        expect(result.current.ownAvatars).toEqual([{ id: 'avtr_current' }]);
        expect(mocks.loadQuickSearchCatalog).toHaveBeenNthCalledWith(2, {
            currentUserId: 'usr_second',
            endpoint: 'https://second.example'
        });
    });
});
