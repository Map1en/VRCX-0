// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getInt: vi.fn(),
    getFloat: vi.fn(),
    setInt: vi.fn(),
    setFloat: vi.fn()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: mocks
}));

const SAVED: Record<string, number> = {
    MutualGraphLayoutIterations: 1200,
    MutualGraphLayoutSpacing: 999,
    MutualGraphEdgeCurvature: 0.05,
    MutualGraphCommunitySeparation: 1.5
};

async function loadHook() {
    vi.resetModules();
    const module = await import('./useMutualFriendsLayoutSettings');
    return module.useMutualFriendsLayoutSettings;
}

beforeEach(() => {
    mocks.getInt.mockImplementation(async (key: string) => SAVED[key]);
    mocks.getFloat.mockImplementation(async (key: string) => SAVED[key]);
    mocks.setInt.mockResolvedValue(undefined);
    mocks.setFloat.mockResolvedValue(undefined);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('mutual graph layout settings', () => {
    it('loads the saved settings once for every panel and keeps them within range', async () => {
        const useLayoutSettings = await loadHook();
        const graphPage = renderHook(() => useLayoutSettings());
        const profileGraph = renderHook(() => useLayoutSettings());

        await waitFor(() =>
            expect(graphPage.result.current.layoutSettings).toEqual({
                layoutIterations: 1200,
                layoutSpacing: 240,
                edgeCurvature: 0.05,
                communitySeparation: 1.5
            })
        );
        expect(profileGraph.result.current.layoutSettings).toEqual(
            graphPage.result.current.layoutSettings
        );
        expect(mocks.getInt).toHaveBeenCalledTimes(2);
        expect(mocks.getFloat).toHaveBeenCalledTimes(2);
    });

    it('shows a slider change in the other open panel and saves it', async () => {
        const useLayoutSettings = await loadHook();
        const graphPage = renderHook(() => useLayoutSettings());
        const profileGraph = renderHook(() => useLayoutSettings());
        await waitFor(() =>
            expect(
                profileGraph.result.current.layoutSettings.layoutSpacing
            ).toBe(240)
        );

        act(() =>
            profileGraph.result.current.setLayoutSetting('layoutSpacing', 80)
        );

        expect(graphPage.result.current.layoutSettings.layoutSpacing).toBe(80);
        expect(mocks.setInt).toHaveBeenCalledWith(
            'MutualGraphLayoutSpacing',
            80
        );
    });

    it('resets every panel to the defaults and saves them', async () => {
        const useLayoutSettings = await loadHook();
        const graphPage = renderHook(() => useLayoutSettings());
        const profileGraph = renderHook(() => useLayoutSettings());
        await waitFor(() =>
            expect(
                graphPage.result.current.layoutSettings.layoutIterations
            ).toBe(1200)
        );

        act(() => profileGraph.result.current.resetLayoutSettings());

        expect(graphPage.result.current.layoutSettings).toEqual({
            layoutIterations: 800,
            layoutSpacing: 60,
            edgeCurvature: 0.1,
            communitySeparation: 0.5
        });
        expect(mocks.setInt).toHaveBeenCalledWith(
            'MutualGraphLayoutIterations',
            800
        );
        expect(mocks.setFloat).toHaveBeenCalledWith(
            'MutualGraphCommunitySeparation',
            0.5
        );
    });
});
