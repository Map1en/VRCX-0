import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/ui/shadcn/sidebar';

import { AppNavFooter } from './AppNavMenuSections';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

describe('AppNavFooter', () => {
    it('highlights the settings menu while the settings page is open', () => {
        const markup = renderToStaticMarkup(
            <SidebarProvider>
                <AppNavFooter
                    sidebarOpen
                    settingsActive
                    shortcutHintsVisible={false}
                    onNavigateSettings={() => undefined}
                    onToggleSidebar={() => undefined}
                />
            </SidebarProvider>
        );

        expect(markup).toContain('data-active=""');
        expect(markup).toContain('nav_tooltip.settings');
    });

    it('shows settings and sidebar shortcut keys while hints are visible', () => {
        const markup = renderToStaticMarkup(
            <SidebarProvider>
                <AppNavFooter
                    sidebarOpen
                    settingsActive={false}
                    shortcutHintsVisible
                    onNavigateSettings={() => undefined}
                    onToggleSidebar={() => undefined}
                />
            </SidebarProvider>
        );

        expect(markup).toContain('data-slot="kbd"');
        expect(markup).toContain('>,</kbd>');
        expect(markup).toContain('>B</kbd>');
    });
});
