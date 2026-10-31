// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useImagePasteShortcut } from './useImagePasteShortcut';

function PasteHarness({
    enabled = true,
    onPaste,
    children
}: {
    enabled?: boolean;
    onPaste(): void;
    children?: ReactNode;
}) {
    const ref = useImagePasteShortcut<HTMLDivElement>({ enabled, onPaste });
    return (
        <div ref={ref} className="vrcx-0-page-scaffold">
            <button type="button">page action</button>
            {children}
        </div>
    );
}

function pasteEvent() {
    return new Event('paste', { bubbles: true, cancelable: true });
}

function pasteKeyEvent(options: KeyboardEventInit = {}) {
    return new KeyboardEvent('keydown', {
        key: 'v',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        ...options
    });
}

describe('image paste shortcut', () => {
    beforeEach(() => {
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
            function (this: HTMLElement) {
                const rects = this.closest('[hidden]')
                    ? []
                    : [new DOMRect(0, 0, 100, 30)];
                return Object.assign(rects, {
                    item: (index: number) => rects[index] ?? null
                });
            }
        );
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('requests image paste for a paste outside text entry', () => {
        const onPaste = vi.fn();
        render(<PasteHarness onPaste={onPaste} />);
        const event = pasteEvent();
        fireEvent(document.body, event);
        expect(onPaste).toHaveBeenCalledOnce();
        expect(event.defaultPrevented).toBe(true);
    });

    it.each([{ ctrlKey: true }, { ctrlKey: false, metaKey: true }])(
        'requests image paste from the primary modifier shortcut: %o',
        (options) => {
            const onPaste = vi.fn();
            render(<PasteHarness onPaste={onPaste} />);
            const event = pasteKeyEvent(options);
            fireEvent(document.body, event);
            expect(onPaste).toHaveBeenCalledOnce();
            expect(event.defaultPrevented).toBe(true);
        }
    );

    it.each([
        { ctrlKey: false },
        { key: 'c' },
        { shiftKey: true },
        { altKey: true },
        { repeat: true },
        { isComposing: true }
    ])('leaves other keyboard actions alone: %o', (options) => {
        const onPaste = vi.fn();
        render(<PasteHarness onPaste={onPaste} />);
        const event = pasteKeyEvent(options);
        fireEvent(document.body, event);
        expect(event.defaultPrevented).toBe(false);
        expect(onPaste).not.toHaveBeenCalled();
    });

    it('uses the current upload callback and stops after disable or unmount', () => {
        const firstPaste = vi.fn();
        const nextPaste = vi.fn();
        const { rerender, unmount } = render(
            <PasteHarness onPaste={firstPaste} />
        );
        fireEvent(window, pasteEvent());
        rerender(<PasteHarness onPaste={nextPaste} />);
        fireEvent(window, pasteEvent());
        expect(firstPaste).toHaveBeenCalledOnce();
        expect(nextPaste).toHaveBeenCalledOnce();

        rerender(<PasteHarness enabled={false} onPaste={nextPaste} />);
        const disabledEvent = pasteEvent();
        fireEvent(window, disabledEvent);
        expect(disabledEvent.defaultPrevented).toBe(false);
        rerender(<PasteHarness onPaste={nextPaste} />);
        unmount();
        const unmountedEvent = pasteEvent();
        fireEvent(window, unmountedEvent);
        expect(unmountedEvent.defaultPrevented).toBe(false);
        expect(nextPaste).toHaveBeenCalledOnce();
    });

    it.each([
        { kind: 'input', control: <input aria-label="control" /> },
        { kind: 'textarea', control: <textarea aria-label="control" /> },
        { kind: 'select', control: <select aria-label="control" /> },
        {
            kind: 'contenteditable',
            control: (
                <div
                    aria-label="control"
                    contentEditable
                    suppressContentEditableWarning
                    tabIndex={0}
                />
            )
        },
        {
            kind: 'textbox',
            control: <div aria-label="control" role="textbox" tabIndex={0} />
        }
    ])(
        'preserves normal paste with focus inside $kind',
        ({ control: controlElement }) => {
            const onPaste = vi.fn();
            render(
                <PasteHarness onPaste={onPaste}>{controlElement}</PasteHarness>
            );
            const control = screen.getByLabelText('control');
            control.focus();
            for (const target of [control, window]) {
                for (const event of [pasteEvent(), pasteKeyEvent()]) {
                    fireEvent(target, event);
                    expect(event.defaultPrevented).toBe(false);
                }
            }
            expect(onPaste).not.toHaveBeenCalled();
        }
    );

    it('preserves paste from a nested editable target without focus', () => {
        const onPaste = vi.fn();
        render(
            <PasteHarness onPaste={onPaste}>
                <div contentEditable suppressContentEditableWarning>
                    <span>editable text</span>
                </div>
            </PasteHarness>
        );
        const event = pasteEvent();
        fireEvent(screen.getByText('editable text'), event);
        expect(event.defaultPrevented).toBe(false);
        expect(onPaste).not.toHaveBeenCalled();
    });

    it('pastes with focus inside the page and ignores focus outside it', () => {
        const onPaste = vi.fn();
        render(
            <>
                <PasteHarness onPaste={onPaste} />
                <button type="button">side panel action</button>
            </>
        );

        screen.getByRole('button', { name: 'page action' }).focus();
        fireEvent(window, pasteEvent());
        expect(onPaste).toHaveBeenCalledOnce();

        screen.getByRole('button', { name: 'side panel action' }).focus();
        const outsideEvent = pasteEvent();
        fireEvent(window, outsideEvent);
        expect(outsideEvent.defaultPrevented).toBe(false);
        expect(onPaste).toHaveBeenCalledOnce();
    });

    it('ignores paste while the page is hidden', () => {
        const onPaste = vi.fn();
        render(
            <div hidden>
                <PasteHarness onPaste={onPaste} />
            </div>
        );
        const event = pasteEvent();
        fireEvent(window, event);
        expect(event.defaultPrevented).toBe(false);
        expect(onPaste).not.toHaveBeenCalled();
    });

    it.each([
        { role: 'dialog' },
        { role: 'alertdialog' },
        { 'data-slot': 'popover-content' }
    ])('leaves paste alone while an overlay is open: %o', (attributes) => {
        const onPaste = vi.fn();
        render(
            <>
                <PasteHarness onPaste={onPaste} />
                <div {...attributes}>
                    <button type="button">overlay action</button>
                </div>
            </>
        );
        const event = pasteEvent();
        fireEvent(window, event);
        expect(event.defaultPrevented).toBe(false);
        expect(onPaste).not.toHaveBeenCalled();
    });

    it('respects pastes already handled by another control', () => {
        const onPaste = vi.fn();
        render(<PasteHarness onPaste={onPaste} />);
        const event = pasteEvent();
        event.preventDefault();
        fireEvent(window, event);
        expect(onPaste).not.toHaveBeenCalled();
    });
});
