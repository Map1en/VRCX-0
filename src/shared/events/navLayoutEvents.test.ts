// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    NAV_CUSTOMIZE_REQUESTED_EVENT,
    NAV_LAYOUT_UPDATED_EVENT,
    NAV_SHORTCUT_REQUESTED_EVENT,
    publishNavCustomizeRequested,
    publishNavLayoutUpdated,
    publishNavShortcutRequested
} from './navLayoutEvents';

describe('navLayoutEvents', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('notifies every mounted nav menu to reload after a layout is saved, so all app windows stay in sync', () => {
        const primaryWindowMenu = vi.fn();
        const secondaryWindowMenu = vi.fn();
        window.addEventListener(NAV_LAYOUT_UPDATED_EVENT, primaryWindowMenu);
        window.addEventListener(NAV_LAYOUT_UPDATED_EVENT, secondaryWindowMenu);

        publishNavLayoutUpdated();

        expect(primaryWindowMenu).toHaveBeenCalledTimes(1);
        expect(secondaryWindowMenu).toHaveBeenCalledTimes(1);

        window.removeEventListener(NAV_LAYOUT_UPDATED_EVENT, primaryWindowMenu);
        window.removeEventListener(
            NAV_LAYOUT_UPDATED_EVENT,
            secondaryWindowMenu
        );
    });

    it('opens the customize-navigation dialog when requested from the menu bar or the native macOS menu', () => {
        const openCustomizeDialog = vi.fn();
        window.addEventListener(
            NAV_CUSTOMIZE_REQUESTED_EVENT,
            openCustomizeDialog
        );

        publishNavCustomizeRequested();

        expect(openCustomizeDialog).toHaveBeenCalledTimes(1);

        window.removeEventListener(
            NAV_CUSTOMIZE_REQUESTED_EVENT,
            openCustomizeDialog
        );
    });

    it('keeps saving a layout and requesting the customize dialog independent, so saving never pops the dialog open by accident', () => {
        const navMenuReloadHandler = vi.fn();
        const customizeDialogOpenHandler = vi.fn();
        window.addEventListener(NAV_LAYOUT_UPDATED_EVENT, navMenuReloadHandler);
        window.addEventListener(
            NAV_CUSTOMIZE_REQUESTED_EVENT,
            customizeDialogOpenHandler
        );

        publishNavLayoutUpdated();
        expect(customizeDialogOpenHandler).not.toHaveBeenCalled();

        publishNavCustomizeRequested();
        expect(navMenuReloadHandler).toHaveBeenCalledTimes(1);

        window.removeEventListener(
            NAV_LAYOUT_UPDATED_EVENT,
            navMenuReloadHandler
        );
        window.removeEventListener(
            NAV_CUSTOMIZE_REQUESTED_EVENT,
            customizeDialogOpenHandler
        );
    });

    it('publishes only valid one-based navigation shortcut positions', () => {
        const positions: number[] = [];
        const handleShortcut = (event: Event) => {
            if (
                event instanceof CustomEvent &&
                typeof event.detail === 'number'
            ) {
                positions.push(event.detail);
            }
        };
        window.addEventListener(NAV_SHORTCUT_REQUESTED_EVENT, handleShortcut);

        publishNavShortcutRequested(1);
        publishNavShortcutRequested(9);
        publishNavShortcutRequested(0);
        publishNavShortcutRequested(10);

        expect(positions).toEqual([1, 9]);

        window.removeEventListener(
            NAV_SHORTCUT_REQUESTED_EVENT,
            handleShortcut
        );
    });
});
