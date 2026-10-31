// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    dispatchGlobalShortcut,
    registerShortcutHandler
} from './shortcutDispatcher';

let isMacHost = false;
const disposers: (() => void)[] = [];

function listener(event: KeyboardEvent) {
    dispatchGlobalShortcut(event, isMacHost);
}

function register(...args: Parameters<typeof registerShortcutHandler>) {
    disposers.push(registerShortcutHandler(...args));
}

function press(
    init: KeyboardEventInit & { keyCode?: number },
    target: EventTarget = window
) {
    const { keyCode, ...eventInit } = init;
    const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...eventInit
    });
    if (keyCode !== undefined) {
        Object.defineProperty(event, 'keyCode', { value: keyCode });
    }
    target.dispatchEvent(event);
    return event;
}

function withInput(run: (input: HTMLInputElement) => void) {
    const input = document.createElement('input');
    document.body.append(input);
    try {
        run(input);
    } finally {
        input.remove();
    }
}

beforeEach(() => {
    isMacHost = false;
    window.addEventListener('keydown', listener);
});

afterEach(() => {
    window.removeEventListener('keydown', listener);
    disposers.splice(0).forEach((dispose) => dispose());
});

describe('dispatchGlobalShortcut', () => {
    it('skips every shortcut while an IME composition is active', () => {
        const quickSearch = vi.fn();
        register('quick-search', quickSearch);

        const composing = press({ ctrlKey: true, key: 'k', isComposing: true });
        const processKey = press({ ctrlKey: true, key: 'k', keyCode: 229 });
        const navComposing = press({
            ctrlKey: true,
            key: '1',
            isComposing: true
        });

        expect(quickSearch).not.toHaveBeenCalled();
        expect(composing.defaultPrevented).toBe(false);
        expect(processKey.defaultPrevented).toBe(false);
        expect(navComposing.defaultPrevented).toBe(false);
    });

    it('runs text-entry shortcuts inside inputs and blocks the others there', () => {
        const quickSearch = vi.fn();
        const settings = vi.fn();
        register('quick-search', quickSearch);
        register('settings', settings);

        withInput((input) => {
            const searchEvent = press({ ctrlKey: true, key: 'k' }, input);
            const settingsEvent = press({ ctrlKey: true, key: ',' }, input);

            expect(searchEvent.defaultPrevented).toBe(true);
            expect(settingsEvent.defaultPrevented).toBe(false);
        });
        expect(quickSearch).toHaveBeenCalledOnce();
        expect(settings).not.toHaveBeenCalled();

        press({ ctrlKey: true, key: ',' });
        expect(settings).toHaveBeenCalledOnce();
    });

    it('swallows navigation and print chords in inputs without running them', () => {
        const navigate = vi.fn();
        register('nav-position', navigate);

        withInput((input) => {
            expect(
                press({ ctrlKey: true, key: '3' }, input).defaultPrevented
            ).toBe(true);
            expect(
                press({ ctrlKey: true, key: 'p' }, input).defaultPrevented
            ).toBe(true);
        });
        expect(
            press({ ctrlKey: true, key: '3', repeat: true }).defaultPrevented
        ).toBe(true);
        expect(navigate).not.toHaveBeenCalled();

        press({ ctrlKey: true, key: '3' });
        expect(navigate).toHaveBeenCalledOnce();
    });

    it('leaves events another handler already consumed alone', () => {
        const toggleHelp = vi.fn();
        const navigate = vi.fn();
        register('keyboard-shortcuts', toggleHelp);
        register('nav-position', navigate);
        const consume = (event: KeyboardEvent) => event.preventDefault();
        window.addEventListener('keydown', consume, { capture: true });

        press({ ctrlKey: true, key: '/' });
        press({ ctrlKey: true, key: '2' });

        window.removeEventListener('keydown', consume, { capture: true });
        expect(toggleHelp).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('maps Mod to Command on macOS and to Control or Meta elsewhere', () => {
        const quickSearch = vi.fn();
        const collapseNav = vi.fn();
        register('quick-search', quickSearch);
        register('collapse-nav', collapseNav);

        press({ ctrlKey: true, key: 'k' });
        press({ metaKey: true, key: 'k' });
        press({ ctrlKey: true, key: 'b' });
        expect(quickSearch).toHaveBeenCalledTimes(2);
        expect(collapseNav).toHaveBeenCalledOnce();

        isMacHost = true;
        const macControl = press({ ctrlKey: true, key: 'k' });
        press({ ctrlKey: true, key: 'b' });
        press({ metaKey: true, key: 'k' });
        press({ metaKey: true, key: 'b' });

        expect(macControl.defaultPrevented).toBe(false);
        expect(quickSearch).toHaveBeenCalledTimes(3);
        expect(collapseNav).toHaveBeenCalledTimes(2);
    });

    it('matches Shift and Alt as each shortcut declares them', () => {
        const collapseNav = vi.fn();
        const friendsSidebar = vi.fn();
        const themeSafeMode = vi.fn();
        register('collapse-nav', collapseNav);
        register('friends-sidebar', friendsSidebar);
        register('theme-safe-mode', themeSafeMode);

        press({ ctrlKey: true, shiftKey: true, key: 'B' });
        press({ ctrlKey: true, altKey: true, key: 'b' });
        press({ ctrlKey: true, shiftKey: true, key: 'T' });
        press({ ctrlKey: true, altKey: true, shiftKey: true, key: 'T' });

        expect(friendsSidebar).toHaveBeenCalledOnce();
        expect(collapseNav).toHaveBeenCalledOnce();
        expect(themeSafeMode).toHaveBeenCalledOnce();
    });

    it('does not consume a chord whose handler is not registered', () => {
        expect(press({ ctrlKey: true, key: 'k' }).defaultPrevented).toBe(false);
    });

    it('calls the most recent handler and falls back after it unregisters', () => {
        const first = vi.fn();
        const second = vi.fn();
        register('direct-access', first);
        const disposeSecond = registerShortcutHandler('direct-access', second);

        press({ ctrlKey: true, key: 'd' });
        disposeSecond();
        press({ ctrlKey: true, key: 'd' });

        expect(second).toHaveBeenCalledOnce();
        expect(first).toHaveBeenCalledOnce();
    });
});
