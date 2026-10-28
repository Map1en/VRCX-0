// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuickSearchState } from '../quickSearch';

const mocks = vi.hoisted(() => ({
    loadQuickSearchResults: vi.fn()
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (
        selector: (state: {
            groupInstances: {
                endpoint: string;
                instances: unknown[];
                userId: string;
            };
        }) => unknown
    ) =>
        selector({
            groupInstances: {
                endpoint: '',
                instances: [],
                userId: ''
            }
        })
}));

vi.mock('../quickSearch', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../quickSearch')>();
    return {
        ...actual,
        loadQuickSearchResults: mocks.loadQuickSearchResults
    };
});

import { createEmptyQuickSearchState } from '../quickSearch';
import { useQuickSearchResults } from './useQuickSearchResults';

function deferredResults() {
    let resolve!: (state: QuickSearchState) => void;
    const promise = new Promise<QuickSearchState>((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
}

describe('useQuickSearchResults', () => {
    beforeEach(() => {
        mocks.loadQuickSearchResults.mockReset();
    });

    it('does not invoke the backend while the dialog has no query', () => {
        const { result } = renderHook(() =>
            useQuickSearchResults({
                currentUserId: 'usr_current',
                currentEndpoint: 'https://example.test',
                normalizedQuery: '',
                open: true
            })
        );

        expect(result.current.status).toBe('idle');
        expect(mocks.loadQuickSearchResults).not.toHaveBeenCalled();
    });

    it('ignores a stale query after the active account changes', async () => {
        const first = deferredResults();
        const second = deferredResults();
        mocks.loadQuickSearchResults
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const { result, rerender } = renderHook(
            ({ currentUserId, currentEndpoint, normalizedQuery }) =>
                useQuickSearchResults({
                    currentUserId,
                    currentEndpoint,
                    normalizedQuery,
                    open: true
                }),
            {
                initialProps: {
                    currentUserId: 'usr_first',
                    currentEndpoint: 'https://first.example',
                    normalizedQuery: 'alpha'
                }
            }
        );

        rerender({
            currentUserId: 'usr_second',
            currentEndpoint: 'https://second.example',
            normalizedQuery: 'beta'
        });

        await act(async () => {
            first.resolve({
                ...createEmptyQuickSearchState('ready', 'stale'),
                ownAvatars: [
                    {
                        id: 'avtr_stale',
                        type: 'avatar',
                        source: 'own',
                        name: 'Stale',
                        subtitle: '',
                        imageUrl: '',
                        seedData: null,
                        memo: '',
                        note: '',
                        matchedField: 'name',
                        userColour: ''
                    }
                ]
            });
            await first.promise;
        });

        expect(result.current.status).toBe('running');
        expect(result.current.detail).toBe('');

        await act(async () => {
            second.resolve(createEmptyQuickSearchState('ready', 'current'));
            await second.promise;
        });

        expect(result.current.status).toBe('ready');
        expect(result.current.detail).toBe('current');
        expect(mocks.loadQuickSearchResults).toHaveBeenNthCalledWith(2, 'beta');
    });

    it('keeps the previous results visible while the next query is loading', async () => {
        const first = deferredResults();
        const second = deferredResults();
        mocks.loadQuickSearchResults
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const { result, rerender } = renderHook(
            ({ normalizedQuery }) =>
                useQuickSearchResults({
                    currentUserId: 'usr_current',
                    currentEndpoint: 'https://example.test',
                    normalizedQuery,
                    open: true
                }),
            { initialProps: { normalizedQuery: 'alp' } }
        );

        await act(async () => {
            first.resolve({
                ...createEmptyQuickSearchState('ready'),
                ownAvatars: [
                    {
                        id: 'avtr_alpha',
                        type: 'avatar',
                        source: 'own',
                        name: 'Alpha',
                        subtitle: '',
                        imageUrl: '',
                        seedData: null,
                        memo: '',
                        note: '',
                        matchedField: 'name',
                        userColour: ''
                    }
                ]
            });
            await first.promise;
        });

        rerender({ normalizedQuery: 'alph' });

        expect(result.current.status).toBe('running');
        expect(result.current.ownAvatars.map((item) => item.id)).toEqual([
            'avtr_alpha'
        ]);
    });
});
