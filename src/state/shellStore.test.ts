// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { useShellStore } from './shellStore';

const storedValues = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
        clear: () => storedValues.clear(),
        getItem: (key: string) => storedValues.get(key) ?? null,
        removeItem: (key: string) => storedValues.delete(key),
        setItem: (key: string, value: string) => {
            storedValues.set(key, value);
        }
    }
});

describe('shellStore notified menus', () => {
    it('keeps notified menus unchanged when removing a menu that is not notified', () => {
        useShellStore.setState({ notifiedMenus: ['friend-log'] });
        const notifiedMenus = useShellStore.getState().notifiedMenus;

        useShellStore.getState().removeNotify('feed');

        expect(useShellStore.getState().notifiedMenus).toBe(notifiedMenus);
    });
});

describe('shellStore settings navigation state', () => {
    it('persists the selected window display mode', () => {
        useShellStore.getState().setWindowDisplayMode('sidebar');

        expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
        expect(window.localStorage.getItem('VRCX_0_WindowDisplayMode')).toBe(
            'sidebar'
        );

        useShellStore.getState().setWindowDisplayMode('normal');
    });
});
