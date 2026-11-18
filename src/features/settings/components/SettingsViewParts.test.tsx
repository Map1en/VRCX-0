// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tabs } from '@/ui/shadcn/tabs';

import {
    SettingsTabContent,
    SettingsTabsVisibilityContext
} from './SettingsViewParts';

function renderSettingsTabs(activeTab: string, keptTabs: ReadonlySet<string>) {
    return (
        <Tabs value={activeTab}>
            <SettingsTabsVisibilityContext value={{ activeTab, keptTabs }}>
                <SettingsTabContent value="system">
                    <span>system settings</span>
                </SettingsTabContent>
                <SettingsTabContent value="vr">
                    <span>vr settings</span>
                </SettingsTabContent>
            </SettingsTabsVisibilityContext>
        </Tabs>
    );
}

function panelOf(text: string) {
    const panel = screen.getByText(text).parentElement;
    if (!panel) {
        throw new Error(`Missing panel for ${text}`);
    }
    return panel;
}

describe('SettingsTabContent', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('keeps visited settings tabs mounted after switching away', () => {
        const view = render(renderSettingsTabs('vr', new Set(['vr'])));
        expect(screen.queryByText('system settings')).toBeNull();

        view.rerender(renderSettingsTabs('vr', new Set(['system', 'vr'])));

        expect(screen.getByText('system settings')).not.toBeNull();
        expect(screen.getByText('vr settings')).not.toBeNull();
    });

    it('remembers the scroll position of a tab from its first visit', () => {
        vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(
            1000
        );
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(
            200
        );
        const view = render(renderSettingsTabs('vr', new Set(['vr'])));
        const visited = new Set(['vr', 'system']);

        view.rerender(renderSettingsTabs('system', visited));
        const systemPanel = panelOf('system settings');
        systemPanel.scrollTop = 340;
        fireEvent.scroll(systemPanel);

        view.rerender(renderSettingsTabs('vr', visited));
        systemPanel.scrollTop = 0;
        view.rerender(renderSettingsTabs('system', visited));

        expect(panelOf('system settings').scrollTop).toBe(340);
    });
});
