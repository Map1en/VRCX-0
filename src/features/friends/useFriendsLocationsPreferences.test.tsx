// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    boolValues: new Map<string, boolean>(),
    stringValues: new Map<string, string>(),
    getCachedString: vi.fn(),
    getBool: vi.fn(),
    getString: vi.fn(),
    setBool: vi.fn(),
    setString: vi.fn()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getCachedString: mocks.getCachedString,
        getBool: mocks.getBool,
        getString: mocks.getString,
        setBool: mocks.setBool,
        setString: mocks.setString
    }
}));

import { STORAGE_KEYS, writeStoredText } from '@/lib/browserStorage';
import { publishPreferenceChanged } from '@/shared/events/preferenceEvents';

import { useFriendsLocationsPreferences } from './useFriendsLocationsPreferences';

describe('useFriendsLocationsPreferences', () => {
    beforeEach(() => {
        localStorage.clear();
        mocks.boolValues.clear();
        mocks.stringValues.clear();
        mocks.getBool
            .mockReset()
            .mockImplementation(
                async (key: string, fallback = false) =>
                    mocks.boolValues.get(key) ?? fallback
            );
        mocks.getCachedString
            .mockReset()
            .mockImplementation(
                (key: string, fallback = '') =>
                    mocks.stringValues.get(key) ?? String(fallback)
            );
        mocks.getString
            .mockReset()
            .mockImplementation(
                async (key: string, fallback = '') =>
                    mocks.stringValues.get(key) ?? String(fallback)
            );
        mocks.setBool.mockReset().mockResolvedValue(undefined);
        mocks.setString.mockReset().mockResolvedValue(undefined);
    });

    it('loads persisted preferences and writes changes back', async () => {
        writeStoredText(STORAGE_KEYS.friendLocationDensity, 'dense');
        mocks.stringValues.set('FriendLocationViewMode', 'worlds');
        mocks.boolValues.set('FriendLocationShowSameInstance', true);
        mocks.stringValues.set('sidebarFavoriteGroups', '["group_a"]');
        mocks.stringValues.set('sidebarSortMethod3', 'Sort by Time');
        const { result } = renderHook(() => useFriendsLocationsPreferences());

        expect(result.current.viewMode).toBe('worlds');
        await waitFor(() => expect(result.current.preferencesReady).toBe(true));
        expect(result.current.density).toBe('dense');
        expect(result.current.viewMode).toBe('worlds');
        expect(result.current.showSameInstanceInOnline).toBe(true);
        expect(result.current.sidebarFavoritePrefs.selectedGroups).toEqual([
            'group_a'
        ]);
        expect(result.current.sidebarSortMethods).toEqual([
            'Sort by Status',
            'Sort Alphabetically',
            'Sort by Time'
        ]);

        act(() => {
            result.current.changeShowSameInstanceInOnline(false);
        });

        expect(result.current.showSameInstanceInOnline).toBe(false);
        expect(mocks.setBool).toHaveBeenCalledWith(
            'FriendLocationShowSameInstance',
            false
        );

        act(() => {
            result.current.changeViewMode('people');
        });

        expect(result.current.viewMode).toBe('people');
        expect(mocks.setString).toHaveBeenCalledWith(
            'FriendLocationViewMode',
            'people'
        );
    });

    it('shows same-instance and favorite friends in online by default', async () => {
        const { result } = renderHook(() => useFriendsLocationsPreferences());

        await waitFor(() => expect(result.current.preferencesReady).toBe(true));
        expect(result.current.showSameInstanceInOnline).toBe(true);
        expect(result.current.showFavoritesInOnline).toBe(true);

        act(() => {
            result.current.changeShowFavoritesInOnline(false);
        });

        expect(result.current.showFavoritesInOnline).toBe(false);
        expect(mocks.setBool).toHaveBeenCalledWith(
            'FriendLocationShowFavoritesInOnline',
            false
        );
    });

    it('reloads sidebar preferences when they change elsewhere', async () => {
        const { result } = renderHook(() => useFriendsLocationsPreferences());
        await waitFor(() => expect(result.current.preferencesReady).toBe(true));
        expect(result.current.sidebarFavoritePrefs.isDivideByGroup).toBe(false);

        mocks.boolValues.set('isSidebarDivideByFriendGroup', true);
        act(() => {
            publishPreferenceChanged('isSidebarDivideByFriendGroup', true);
        });

        await waitFor(() =>
            expect(result.current.sidebarFavoritePrefs.isDivideByGroup).toBe(
                true
            )
        );
    });
});
