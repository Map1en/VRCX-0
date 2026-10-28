// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { useState, type PropsWithChildren } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    loadNavMenuModel: vi.fn()
}));

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn()
});

vi.mock('@/shared/buildLabel', () => ({
    isUpdateCheckDisabledBuild: () => false
}));

vi.mock('@/components/layout/navMenuModel', async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import('@/components/layout/navMenuModel')
        >();
    return { ...actual, loadNavMenuModel: mocks.loadNavMenuModel };
});

vi.mock('@/lib/useKnownUser', () => ({
    useKnownUserFacts: () => ({})
}));

vi.mock('@/services/shellIntegrationService', () => ({
    getClipboardText: () => Promise.resolve('')
}));

vi.mock('./quick-search/useQuickSearchHistory', () => ({
    useQuickSearchHistory: () => ({ items: [], remember: vi.fn() })
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children }: PropsWithChildren) => children,
    DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogDescription: ({ children }: PropsWithChildren) => (
        <div>{children}</div>
    ),
    DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogTitle: ({ children }: PropsWithChildren) => <div>{children}</div>
}));

import { QuickSearchDialog } from './QuickSearchDialog';

function SearchHarness({ onOpenChange }: { onOpenChange: () => void }) {
    const [query, setQuery] = useState('');
    return (
        <QuickSearchDialog
            open
            query={query}
            onQueryChange={setQuery}
            onOpenChange={onOpenChange}
            onDirectAccess={vi.fn()}
        />
    );
}

function SettingsLocation() {
    const location = useLocation();
    return (
        <output data-testid="location">
            {location.pathname}
            {location.search}
        </output>
    );
}

function renderQuickSearch() {
    render(
        <MemoryRouter initialEntries={['/feed']}>
            <Routes>
                <Route
                    path="/feed"
                    element={<SearchHarness onOpenChange={vi.fn()} />}
                />
                <Route path="/settings" element={<SettingsLocation />} />
            </Routes>
        </MemoryRouter>
    );
    return screen.getByRole('combobox') as HTMLInputElement;
}

describe('QuickSearch settings and navigation shortcuts', () => {
    afterEach(() => {
        cleanup();
        mocks.loadNavMenuModel.mockReset();
    });

    it('lists matching settings and opens the deep link', async () => {
        mocks.loadNavMenuModel.mockResolvedValue({ menuItems: [] });
        const input = renderQuickSearch();

        fireEvent.change(input, { target: { value: 'proxy' } });
        fireEvent.click(
            await screen.findByText('view.settings.general.application.proxy')
        );

        expect(screen.getByTestId('location').textContent).toBe(
            '/settings?tab=system&setting=system.network.proxy'
        );
    });

    it('shows the Ctrl+number shortcut on navigation results', async () => {
        mocks.loadNavMenuModel.mockResolvedValue({
            menuItems: [{ index: 'friends-locations' }, { index: 'feed' }]
        });
        const input = renderQuickSearch();

        fireEvent.change(input, { target: { value: 'feed' } });
        const item = (await screen.findByText('nav_tooltip.feed')).closest(
            '[cmdk-item]'
        );

        await waitFor(() => expect(item?.textContent).toContain('Ctrl2'));
    });
});
