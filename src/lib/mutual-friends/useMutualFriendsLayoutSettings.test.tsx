// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    STORAGE_KEYS,
    readStoredText,
    writeStoredText
} from '@/lib/browserStorage';

const SAVED: Record<string, string> = {
    [STORAGE_KEYS.mutualGraphLayoutIterations]: '1200',
    [STORAGE_KEYS.mutualGraphLayoutSpacing]: '999',
    [STORAGE_KEYS.mutualGraphEdgeCurvature]: '0.05',
    [STORAGE_KEYS.mutualGraphCommunitySeparation]: '1.5'
};

async function loadHook() {
    vi.resetModules();
    const module = await import('./useMutualFriendsLayoutSettings');
    return module.useMutualFriendsLayoutSettings;
}

beforeEach(() => {
    localStorage.clear();
    for (const [key, value] of Object.entries(SAVED)) {
        writeStoredText(key, value);
    }
});

afterEach(() => {
    cleanup();
});

describe('mutual graph layout settings', () => {
    it('loads the saved settings for every panel and keeps them within range', async () => {
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
        expect(readStoredText(STORAGE_KEYS.mutualGraphLayoutSpacing)).toBe(
            '80'
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
        expect(readStoredText(STORAGE_KEYS.mutualGraphLayoutIterations)).toBe(
            '800'
        );
        expect(
            readStoredText(STORAGE_KEYS.mutualGraphCommunitySeparation)
        ).toBe('0.5');
    });
});
