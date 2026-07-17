// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    setRgb: vi.fn()
}));

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({ t: (key: string) => key })
    };
});

vi.mock('@/lib/useKnownUser', () => ({
    useKnownUserFacts: () => ({})
}));

vi.mock('@/services/vrcx0CssLayerService', () => ({
    setRgb: mocks.setRgb
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

function renderQuickSearch(
    onOpenChange: (open: boolean) => void,
    onKeyDown?: () => void
) {
    render(
        <MemoryRouter>
            <div onKeyDown={onKeyDown}>
                <QuickSearchDialog open onOpenChange={onOpenChange} />
            </div>
        </MemoryRouter>
    );
    return screen.getByRole('combobox') as HTMLInputElement;
}

describe('QuickSearchDialog RGB command', () => {
    beforeEach(() => {
        mocks.setRgb.mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    it.each([
        ['/rgb-mode:on', true],
        ['/rgb-mode:off', false]
    ])('consumes %s before cmdk and closes silently', (command, enabled) => {
        const onOpenChange = vi.fn();
        const onKeyDown = vi.fn();
        const input = renderQuickSearch(onOpenChange, onKeyDown);

        fireEvent.change(input, { target: { value: command } });
        const dispatched = fireEvent.keyDown(input, { key: 'Enter' });

        expect(mocks.setRgb).toHaveBeenCalledWith(enabled);
        expect(dispatched).toBe(false);
        expect(onKeyDown).not.toHaveBeenCalled();
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(input.value).toBe('');
    });

    it.each([
        '/rgb-mode:',
        '/rgb-mode:ON',
        ' /rgb-mode:on',
        '/rgb-mode:on ',
        '/rgb-mode:on/extra'
    ])('leaves unmatched input %s in the ordinary search path', (query) => {
        const onOpenChange = vi.fn();
        const input = renderQuickSearch(onOpenChange);

        fireEvent.change(input, { target: { value: query } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(mocks.setRgb).not.toHaveBeenCalled();
        expect(onOpenChange).not.toHaveBeenCalled();
        expect(input.value).toBe(query);
    });

    it('does not inspect Enter while input composition is active', () => {
        const input = renderQuickSearch(vi.fn());

        fireEvent.change(input, { target: { value: '/rgb-mode:on' } });
        fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

        expect(mocks.setRgb).not.toHaveBeenCalled();
    });
});
