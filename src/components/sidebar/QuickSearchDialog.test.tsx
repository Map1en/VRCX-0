// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { useState, type PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    setRgb: vi.fn(),
    triggerToolByKey: vi.fn(() => Promise.resolve()),
    directAccessParse: vi.fn(() => Promise.resolve(false)),
    openDirectAccess: vi.fn(() => true),
    getClipboardText: vi.fn(() => Promise.resolve('')),
    toastAdd: vi.fn<(options: AppToastOptions) => string>(
        () => 'clipboard-toast'
    ),
    toastClose: vi.fn(),
    t: (key: string) => key
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

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({ t: mocks.t })
    };
});

vi.mock('@/shared/buildLabel', () => ({
    isUpdateCheckDisabledBuild: () => false
}));

vi.mock('@/lib/useKnownUser', () => ({
    useKnownUserFacts: () => ({})
}));

vi.mock('@/services/vrcx0CssLayerService', () => ({
    setRgb: mocks.setRgb
}));

vi.mock('@/services/toolActionService', () => ({
    triggerToolByKey: mocks.triggerToolByKey
}));

vi.mock('@/services/directAccessService', () => ({
    directAccessParse: mocks.directAccessParse
}));

vi.mock('@/services/shellIntegrationService', () => ({
    getClipboardText: mocks.getClipboardText
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd, close: mocks.toastClose }
}));

vi.mock('./quick-search/useQuickSearchHistory', () => ({
    useQuickSearchHistory: () => ({
        items: [
            {
                id: 'wrld_recent',
                type: 'world',
                source: 'history',
                name: 'Recent World'
            }
        ],
        remember: vi.fn()
    })
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

function SearchHarness({
    onOpenChange = vi.fn()
}: {
    onOpenChange?: (open: boolean) => void;
}) {
    const [query, setQuery] = useState('');
    return (
        <QuickSearchDialog
            open
            query={query}
            onQueryChange={setQuery}
            onOpenChange={onOpenChange}
            onDirectAccess={mocks.openDirectAccess}
        />
    );
}

function renderQuickSearch(
    onOpenChange: (open: boolean) => void,
    onKeyDown?: () => void
) {
    render(
        <MemoryRouter>
            <div role="presentation" onKeyDown={onKeyDown}>
                <SearchHarness onOpenChange={onOpenChange} />
            </div>
        </MemoryRouter>
    );
    return screen.getByRole('combobox') as HTMLInputElement;
}

describe('QuickSearchDialog', () => {
    beforeEach(() => {
        mocks.setRgb.mockReset();
        mocks.triggerToolByKey.mockClear();
        mocks.directAccessParse.mockReset();
        mocks.directAccessParse.mockResolvedValue(false);
        mocks.openDirectAccess.mockReset();
        mocks.openDirectAccess.mockReturnValue(true);
        mocks.getClipboardText.mockReset();
        mocks.getClipboardText.mockResolvedValue('');
        mocks.toastAdd.mockClear();
        mocks.toastClose.mockClear();
        mocks.t = (key: string) => key;
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
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

    it('renders recently opened entities in the empty search slot', () => {
        renderQuickSearch(vi.fn());

        expect(screen.getByText('side_panel.search_recent')).toBeTruthy();
        expect(screen.getByText('Recent World')).toBeTruthy();
    });

    it('advertises direct access in the empty search slot', () => {
        renderQuickSearch(vi.fn());

        expect(
            screen.getByText('side_panel.search_direct_access')
        ).toBeTruthy();
        expect(
            screen.getByText('side_panel.search_scope_direct_access')
        ).toBeTruthy();
    });

    it('offers a recognised link only after input settles', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        mocks.directAccessParse.mockResolvedValue(true);
        const onOpenChange = vi.fn();
        const input = renderQuickSearch(onOpenChange);
        const link =
            'https://vrchat.com/home/world/wrld_12345678-1234-1234-1234-1234567890AB';

        fireEvent.change(input, { target: { value: `  ${link}  ` } });
        expect(screen.queryByText('side_panel.search_open_direct')).toBeNull();
        expect(mocks.directAccessParse).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
        });

        expect(mocks.directAccessParse).toHaveBeenCalledWith(link, 'detect');

        fireEvent.click(screen.getByText('side_panel.search_open_direct'));

        expect(mocks.openDirectAccess).toHaveBeenCalledWith(link);
        vi.useRealTimers();
    });

    it('announces the clipboard without displaying its URL and consumes Enter', async () => {
        const link = 'https://vrchat.com/home/world/wrld_clipboard';
        mocks.getClipboardText.mockResolvedValue(link);
        mocks.directAccessParse.mockResolvedValue(true);
        const parentKeyDown = vi.fn();
        const input = renderQuickSearch(vi.fn(), parentKeyDown);

        await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalled());

        expect(mocks.toastAdd).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'side_panel.search_clipboard_detected',
                timeout: 0
            })
        );
        expect(screen.queryByText(link)).toBeNull();
        expect(input.value).toBe('');
        expect(mocks.openDirectAccess).not.toHaveBeenCalled();
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(mocks.openDirectAccess).toHaveBeenCalledExactlyOnceWith(link);
        expect(parentKeyDown).not.toHaveBeenCalled();
        expect(mocks.toastClose).toHaveBeenCalledWith('clipboard-toast');
    });

    it.each([
        'ArrowDown',
        'ArrowUp',
        'Tab',
        'Control',
        'Shift',
        'Alt',
        'Meta',
        'Backspace',
        'a',
        'F1'
    ])(
        'dismisses the clipboard shortcut when navigating with %s',
        async (key) => {
            mocks.getClipboardText.mockResolvedValue('usr_clipboard');
            mocks.directAccessParse.mockResolvedValue(true);
            const input = renderQuickSearch(vi.fn());
            await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalled());

            fireEvent.keyDown(input, { key });
            fireEvent.keyDown(input, { key: 'Enter' });

            expect(mocks.openDirectAccess).not.toHaveBeenCalled();
            expect(mocks.toastClose).toHaveBeenCalledWith('clipboard-toast');
        }
    );

    it('does not reactivate the clipboard after typing and clearing the query', async () => {
        mocks.getClipboardText.mockResolvedValue('usr_clipboard');
        mocks.directAccessParse.mockResolvedValue(true);
        const input = renderQuickSearch(vi.fn());
        await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalled());

        fireEvent.change(input, { target: { value: 'alice' } });
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(mocks.getClipboardText).toHaveBeenCalledTimes(1);
        expect(mocks.openDirectAccess).not.toHaveBeenCalled();
    });

    it('does not offer a late clipboard result after the user starts typing', async () => {
        let resolveClipboard!: (value: string) => void;
        mocks.getClipboardText.mockReturnValue(
            new Promise((resolve) => {
                resolveClipboard = resolve;
            })
        );
        mocks.directAccessParse.mockResolvedValue(true);
        const input = renderQuickSearch(vi.fn());
        fireEvent.change(input, { target: { value: 'alice' } });

        await act(async () => resolveClipboard('usr_clipboard'));

        expect(mocks.toastAdd).not.toHaveBeenCalled();
        expect(input.value).toBe('alice');
    });

    it('revokes Enter when the toast is dismissed', async () => {
        mocks.getClipboardText.mockResolvedValue('usr_clipboard');
        mocks.directAccessParse.mockResolvedValue(true);
        const input = renderQuickSearch(vi.fn());
        await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalled());
        mocks.toastAdd.mock.calls[0]?.[0].onClose?.();

        fireEvent.keyDown(input, { key: 'Enter' });

        expect(mocks.openDirectAccess).not.toHaveBeenCalled();
    });

    it('dismisses the clipboard shortcut on the first Enter even when the owner is busy', async () => {
        mocks.getClipboardText.mockResolvedValue('usr_clipboard');
        mocks.directAccessParse.mockResolvedValue(true);
        mocks.openDirectAccess.mockReturnValueOnce(false);
        const input = renderQuickSearch(vi.fn());
        await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalled());

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(mocks.toastClose).toHaveBeenCalledWith('clipboard-toast');

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(mocks.openDirectAccess).toHaveBeenCalledExactlyOnceWith(
            'usr_clipboard'
        );
    });

    it('does not restart dismissed clipboard detection when the language changes', async () => {
        mocks.getClipboardText.mockResolvedValue('usr_clipboard');
        mocks.directAccessParse.mockResolvedValue(true);
        const dialog = (
            <MemoryRouter>
                <SearchHarness />
            </MemoryRouter>
        );
        const view = render(dialog);
        const input = screen.getByRole('combobox');
        await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalled());
        fireEvent.change(input, { target: { value: 'alice' } });

        mocks.t = (key: string) => `translated:${key}`;
        view.rerender(
            <MemoryRouter>
                <SearchHarness />
            </MemoryRouter>
        );
        await act(async () => {});
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(mocks.getClipboardText).toHaveBeenCalledTimes(1);
        expect(mocks.toastAdd).toHaveBeenCalledTimes(1);
        expect(mocks.openDirectAccess).not.toHaveBeenCalled();
    });

    it('cleans up the prompt on unmount and reads the next opening afresh', async () => {
        mocks.getClipboardText.mockResolvedValue('usr_first');
        mocks.directAccessParse.mockResolvedValue(true);
        renderQuickSearch(vi.fn());
        await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalledTimes(1));
        cleanup();
        expect(mocks.toastClose).toHaveBeenCalledWith('clipboard-toast');

        mocks.getClipboardText.mockResolvedValue('usr_second');
        const input = renderQuickSearch(vi.fn());
        await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalledTimes(2));
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(mocks.openDirectAccess).toHaveBeenCalledExactlyOnceWith(
            'usr_second'
        );
    });

    it.each(['Control', 'Meta'])(
        'restores the clipboard shortcut after %s dismisses it and search opens again',
        async (key) => {
            mocks.getClipboardText.mockResolvedValue('usr_first');
            mocks.directAccessParse.mockResolvedValue(true);
            const props = {
                open: true,
                query: '',
                onQueryChange: vi.fn(),
                onOpenChange: vi.fn(),
                onDirectAccess: mocks.openDirectAccess
            };
            const view = render(
                <MemoryRouter>
                    <QuickSearchDialog {...props} clipboardSession={1} />
                </MemoryRouter>
            );
            const input = screen.getByRole('combobox');
            await waitFor(() =>
                expect(mocks.toastAdd).toHaveBeenCalledTimes(1)
            );

            fireEvent.keyDown(input, { key });
            expect(mocks.toastClose).toHaveBeenCalledWith('clipboard-toast');
            mocks.getClipboardText.mockResolvedValue('usr_second');
            view.rerender(
                <MemoryRouter>
                    <QuickSearchDialog {...props} clipboardSession={2} />
                </MemoryRouter>
            );
            await waitFor(() =>
                expect(mocks.toastAdd).toHaveBeenCalledTimes(2)
            );

            expect(screen.getByRole('combobox')).toBe(input);
            expect(mocks.getClipboardText).toHaveBeenCalledTimes(2);
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(mocks.openDirectAccess).toHaveBeenCalledExactlyOnceWith(
                'usr_second'
            );
        }
    );

    it('does not consume Enter during input composition', async () => {
        mocks.getClipboardText.mockResolvedValue('usr_clipboard');
        mocks.directAccessParse.mockResolvedValue(true);
        const input = renderQuickSearch(vi.fn());
        await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalled());

        fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

        expect(mocks.openDirectAccess).not.toHaveBeenCalled();
        expect(mocks.toastClose).toHaveBeenCalledWith('clipboard-toast');
    });

    it.each(['', 'plain name', 'abcd1234'])(
        'keeps ordinary quick search for unrecognised clipboard content %s',
        async (value) => {
            mocks.getClipboardText.mockResolvedValue(value);
            const input = renderQuickSearch(vi.fn());
            await act(async () => {});
            expect(mocks.toastAdd).not.toHaveBeenCalled();
            expect(input.value).toBe('');
        }
    );

    it('offers failed direct input for retry without rereading the clipboard', () => {
        render(
            <MemoryRouter>
                <QuickSearchDialog
                    open
                    query="abcd1234"
                    retryInput="abcd1234"
                    onQueryChange={vi.fn()}
                    onOpenChange={vi.fn()}
                    onDirectAccess={mocks.openDirectAccess}
                />
            </MemoryRouter>
        );
        fireEvent.click(screen.getByText('side_panel.search_open_direct'));
        expect(mocks.openDirectAccess).toHaveBeenCalledExactlyOnceWith(
            'abcd1234'
        );
        expect(mocks.getClipboardText).not.toHaveBeenCalled();
    });

    it('opens the recent item with Enter when there is no clipboard prompt', async () => {
        const onOpenChange = vi.fn();
        const input = renderQuickSearch(onOpenChange);
        await waitFor(() =>
            expect(
                screen
                    .getByText('Recent World')
                    .closest('[cmdk-item]')
                    ?.getAttribute('data-selected')
            ).toBe('true')
        );
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(mocks.openDirectAccess).not.toHaveBeenCalled();
    });

    it('dismisses the toast for keys outside the search input too', async () => {
        mocks.getClipboardText.mockResolvedValue('usr_clipboard');
        mocks.directAccessParse.mockResolvedValue(true);
        const input = renderQuickSearch(vi.fn());
        await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalled());
        fireEvent.keyDown(document.body, { key: 'Control' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(mocks.toastClose).toHaveBeenCalledWith('clipboard-toast');
        expect(mocks.openDirectAccess).not.toHaveBeenCalled();
    });

    it('does not intercept Enter if displaying the toast fails', async () => {
        mocks.getClipboardText.mockResolvedValue('usr_clipboard');
        mocks.directAccessParse.mockResolvedValue(true);
        mocks.toastAdd.mockImplementationOnce(() => {
            throw new Error('toast failed');
        });
        const onOpenChange = vi.fn();
        const input = renderQuickSearch(onOpenChange);
        await act(async () => {});
        await waitFor(() =>
            expect(
                screen
                    .getByText('Recent World')
                    .closest('[cmdk-item]')
                    ?.getAttribute('data-selected')
            ).toBe('true')
        );
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(mocks.openDirectAccess).not.toHaveBeenCalled();
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('updates controlled retry input without remounting', () => {
        const onQueryChange = vi.fn();
        const props = {
            open: true,
            onQueryChange,
            onOpenChange: vi.fn(),
            onDirectAccess: mocks.openDirectAccess
        };
        const view = render(
            <MemoryRouter>
                <QuickSearchDialog
                    {...props}
                    query="abcd1234"
                    retryInput="abcd1234"
                />
            </MemoryRouter>
        );
        const input = screen.getByRole('combobox') as HTMLInputElement;
        view.rerender(
            <MemoryRouter>
                <QuickSearchDialog
                    {...props}
                    query="new input"
                    retryInput="abcd1234"
                />
            </MemoryRouter>
        );
        expect(screen.getByRole('combobox')).toBe(input);
        expect(input.value).toBe('new input');
        expect(screen.queryByText('side_panel.search_open_direct')).toBeNull();
    });

    it.each([
        [
            'presence-schedule',
            'view.tools.social_automation.status_schedule',
            'presence-schedule'
        ],
        ['inventory', 'view.tools.pictures.inventory', 'inventory']
    ])(
        'finds and opens the %s tool through the tool owner',
        async (query, label, toolKey) => {
            const onOpenChange = vi.fn();
            const input = renderQuickSearch(onOpenChange);

            fireEvent.change(input, { target: { value: query } });
            fireEvent.click(screen.getByText(label));

            await waitFor(() => {
                expect(mocks.triggerToolByKey).toHaveBeenCalledWith(
                    toolKey,
                    expect.objectContaining({ t: expect.any(Function) })
                );
            });
            expect(onOpenChange).toHaveBeenCalledWith(false);
        }
    );
});
