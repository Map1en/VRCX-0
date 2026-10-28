// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { handleSidebarRowArrowNavigation } from './sidebarRowArrowNavigation';

function SidebarList({ portal = false }: { portal?: boolean }) {
    return (
        <div role="presentation" onKeyDown={handleSidebarRowArrowNavigation}>
            <div data-sidebar-row="">
                <button type="button">Alice</button>
            </div>
            <div data-sidebar-row="">
                <span>Online</span>
            </div>
            <div data-sidebar-row="">
                <div role="button" tabIndex={0}>
                    Room
                    <button type="button">Group</button>
                </div>
            </div>
            <div data-sidebar-row="">
                <button type="button">Bob</button>
                {portal
                    ? createPortal(
                          <button type="button">Menu item</button>,
                          document.body
                      )
                    : null}
            </div>
        </div>
    );
}

describe('handleSidebarRowArrowNavigation', () => {
    afterEach(() => {
        cleanup();
    });

    it('moves focus to the next and previous focusable row, skipping rows without controls', () => {
        render(<SidebarList />);
        const alice = screen.getByRole('button', { name: 'Alice' });
        const room = screen.getByRole('button', { name: /Room/ });
        alice.focus();

        fireEvent.keyDown(alice, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(room);

        fireEvent.keyDown(room, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(alice);
    });

    it('moves from a nested control to the next row', () => {
        render(<SidebarList />);
        const group = screen.getByRole('button', { name: 'Group' });
        group.focus();

        fireEvent.keyDown(group, { key: 'ArrowDown' });

        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Bob' })
        );
    });

    it('leaves the key alone at the list edge and with modifiers', () => {
        render(<SidebarList />);
        const alice = screen.getByRole('button', { name: 'Alice' });
        alice.focus();

        expect(fireEvent.keyDown(alice, { key: 'ArrowUp' })).toBe(true);
        expect(
            fireEvent.keyDown(alice, { key: 'ArrowDown', shiftKey: true })
        ).toBe(true);
        expect(document.activeElement).toBe(alice);
    });

    it('ignores key events bubbling from portaled content', () => {
        render(<SidebarList portal />);
        const menuItem = screen.getByRole('button', { name: 'Menu item' });
        menuItem.focus();

        fireEvent.keyDown(menuItem, { key: 'ArrowUp' });

        expect(document.activeElement).toBe(menuItem);
    });
});
