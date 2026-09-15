// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { resetSearchPageState } from './searchPageStore';
import { useSearchResults } from './useSearchResults';

const { getGroups, toastAdd } = vi.hoisted(() => ({
    getGroups: vi.fn(),
    toastAdd: vi.fn()
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));
vi.mock('@/repositories/vrchatSearchRepository', () => ({
    default: { getGroups }
}));
vi.mock('@/repositories/avatarSearchProviderRepository', () => ({
    default: {}
}));
vi.mock('@/repositories/userProfileRepository', () => ({ default: {} }));
vi.mock('@/repositories/worldProfileRepository', () => ({ default: {} }));
vi.mock('@/services/toastService', () => ({ toast: { add: toastAdd } }));

const options = {
    activeTab: 'group' as const,
    avatarProviderEnabled: false,
    includeCommunityLabs: false,
    searchText: 'ocean',
    searchUserByBio: false,
    searchUserSortByLastLoggedIn: false,
    selectedAvatarProvider: '',
    selectedWorldCategory: '',
    setSearchText: vi.fn(),
    setSelectedWorldCategory: vi.fn(),
    worldCategories: []
};

beforeEach(() => {
    resetSearchPageState();
    vi.clearAllMocks();
});

describe('search page session', () => {
    it('keeps results and pagination on remount without searching again', async () => {
        getGroups.mockResolvedValue({
            json: [{ id: 'grp_ocean', name: 'Ocean' }]
        });
        const first = renderHook(() => useSearchResults(options));
        await act(async () => first.result.current.handleSearch());
        await act(async () => first.result.current.pagination.onNext());
        first.unmount();
        const restored = renderHook(() => useSearchResults(options));
        expect(restored.result.current.groupResults).toEqual([
            { id: 'grp_ocean', name: 'Ocean' }
        ]);
        expect(restored.result.current.pagination.page).toBe(2);
        expect(restored.result.current.hasGroupSearched).toBe(true);
        expect(getGroups).toHaveBeenCalledTimes(2);
        restored.unmount();
    });

    it('finishes an in-flight search while the page is unmounted', async () => {
        const response = Promise.withResolvers<{ json: { id: string }[] }>();
        getGroups.mockReturnValue(response.promise);
        const first = renderHook(() => useSearchResults(options));
        act(() => first.result.current.handleSearch());
        first.unmount();
        await act(async () => response.resolve({ json: [{ id: 'grp_late' }] }));
        const restored = renderHook(() => useSearchResults(options));
        expect(restored.result.current.groupResults).toEqual([
            { id: 'grp_late' }
        ]);
        expect(restored.result.current.isGroupLoading).toBe(false);
        restored.unmount();
    });

    it.each(['logout', 'owner change'] as const)(
        'clears state and ignores late responses on %s',
        async (change) => {
            useSessionStore.getState().setLoggedIn(true);
            const response = Promise.withResolvers<{
                json: { id: string }[];
            }>();
            getGroups.mockReturnValue(response.promise);
            const first = renderHook(() => useSearchResults(options));
            act(() => first.result.current.handleSearch());
            first.unmount();
            if (change === 'logout') {
                useSessionStore.getState().setLoggedIn(false);
            } else {
                useRuntimeStore
                    .getState()
                    .setAuthBootstrap({ currentUserId: 'usr_next' });
            }
            await act(async () =>
                response.resolve({ json: [{ id: 'grp_old' }] })
            );
            const restored = renderHook(() => useSearchResults(options));
            expect(restored.result.current.groupResults).toEqual([]);
            expect(restored.result.current.hasGroupSearched).toBe(false);
            expect(restored.result.current.isGroupLoading).toBe(false);
            restored.unmount();
        }
    );
});
