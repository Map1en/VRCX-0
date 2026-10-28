// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNavigationCacheStore } from '@/state/navigationCacheStore';

import { useSettingsHighlightStore } from './settingsHighlightStore';
import { useSettingDeepLink } from './useSettingDeepLink';

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppCache: 16 },
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    readTextFile: vi.fn().mockResolvedValue('{}')
}));

const scrollIntoView = vi.fn();
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView
});

function SettingsHarness() {
    useSettingDeepLink();
    const location = useLocation();
    return (
        <>
            <output data-testid="search">{location.search}</output>
            <section data-settings-card-id="vr.hmd">
                <div data-setting-id="vr.hmd.timeout">
                    <button type="button" data-setting-reset>
                        reset
                    </button>
                    <button type="button">control</button>
                </div>
            </section>
        </>
    );
}

function renderAt(url: string) {
    render(
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                <Route path="/settings" element={<SettingsHarness />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('useSettingDeepLink', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        scrollIntoView.mockClear();
        useNavigationCacheStore.setState({ hydrated: true, settingsCards: {} });
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        useSettingsHighlightStore.getState().setHighlightedSetting(null);
    });

    it('opens the card, scrolls to and focuses the control, then clears a static highlight', () => {
        useNavigationCacheStore.setState({
            settingsCards: { 'vr.hmd': false }
        });

        renderAt('/settings?tab=system&setting=vr.hmd.timeout');

        expect(screen.getByTestId('search').textContent).toBe('?tab=vr');
        expect(useNavigationCacheStore.getState().settingsCards['vr.hmd']).toBe(
            true
        );
        expect(useSettingsHighlightStore.getState().settingId).toBe(
            'vr.hmd.timeout'
        );

        act(() => {
            vi.advanceTimersByTime(500);
        });

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
        expect(document.activeElement?.textContent).toBe('control');

        act(() => {
            vi.advanceTimersByTime(2000);
        });

        expect(useSettingsHighlightStore.getState().settingId).toBeNull();
    });

    it('drops unknown setting ids without touching the tab', () => {
        renderAt('/settings?tab=system&setting=missing.setting');

        expect(screen.getByTestId('search').textContent).toBe('?tab=system');
        expect(useSettingsHighlightStore.getState().settingId).toBeNull();
    });
});
