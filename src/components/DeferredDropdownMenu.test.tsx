// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    DropdownMenuContent,
    DropdownMenuItem
} from '@/ui/shadcn/dropdown-menu';

import { DeferredDropdownMenu } from './DeferredDropdownMenu';

function renderMenu(onTriggerClick = vi.fn(), onSelect = vi.fn()) {
    render(
        <DeferredDropdownMenu
            label="Actions"
            trigger={
                <button type="button" onClick={onTriggerClick}>
                    More
                </button>
            }
        >
            <DropdownMenuContent>
                <DropdownMenuItem onClick={onSelect}>Wear</DropdownMenuItem>
            </DropdownMenuContent>
        </DeferredDropdownMenu>
    );
}

describe('DeferredDropdownMenu', () => {
    afterEach(cleanup);

    it('opens the menu on the first click of the placeholder trigger', async () => {
        const onTriggerClick = vi.fn();
        const onSelect = vi.fn();
        renderMenu(onTriggerClick, onSelect);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(
            screen
                .getByRole('button', { name: 'Actions' })
                .getAttribute('aria-haspopup')
        ).toBe('menu');

        fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

        expect(onTriggerClick).toHaveBeenCalledTimes(1);
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Wear' }));
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('keeps the same trigger node when hovering after the menu opens', async () => {
        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
        await screen.findByRole('menu');
        const openedTrigger = screen.getByRole('button', { name: 'Actions' });

        fireEvent.pointerMove(openedTrigger, { pointerType: 'mouse' });
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(openedTrigger.isConnected).toBe(true);
        expect(screen.getByRole('button', { name: 'Actions' })).toBe(
            openedTrigger
        );
    });

    it('closes the menu when the mounted trigger is clicked again', async () => {
        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
        await screen.findByRole('menu');

        fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    });
});
